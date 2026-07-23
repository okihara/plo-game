// ゲーム進行コア
//
// ハンド開始 → アクション適用 → 次アクター決定 → ストリート進行 → ショーダウン
// の骨組みはここに 1 本だけ存在する。バリアント差分は VariantDescriptor 経由で
// 注入される（descriptor.ts / variants/ を参照）。

import { GameState, Player, Action, GameVariant, Street, isDrawStreet } from '../types.js';
import { createDeck, shuffleDeck, dealCards } from '../deck.js';
import {
  MAX_PLAYERS,
  DEFAULT_PLAYER_NAMES,
  getActivePlayers,
  getPlayersWhoCanAct,
  getActivePlayerCount,
  getNextActivePlayer,
  getNextSeatInHand,
} from './players.js';
import { calculateSidePots, calculateRake, settleUncontestedPots, deductRakeProportionally, SidePot } from './pots.js';
import { VariantDescriptor, ValidAction } from './descriptor.js';
import { POSITIONS } from '../types.js';

function deepClone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

// =========================================================================
//  State Creation
// =========================================================================

/** 6席分のプレイヤー配列 + 全バリアント共通の初期フィールドを持つ GameState を作る */
export function buildBaseGameState(overrides: {
  playerChips: number;
  currentStreet: Street;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  variant: GameVariant;
  ante?: number;
  bringIn?: number;
  maxBetsPerRound?: number;
  extra?: Partial<GameState>;
}): GameState {
  const players: Player[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    players.push({
      id: i,
      name: DEFAULT_PLAYER_NAMES[i],
      position: POSITIONS[i],
      chips: overrides.playerChips,
      holeCards: [],
      currentBet: 0,         // 現在のストリートでの累計ベット額
      totalBetThisRound: 0,  // このハンド全体での累計ベット額
      folded: false,
      isAllIn: false,
      hasActed: false,       // このストリートでアクション済みか
      isSittingOut: false,
    });
  }

  return {
    players,
    deck: [],
    communityCards: [],
    pot: 0,
    sidePots: [],
    currentStreet: overrides.currentStreet,
    dealerPosition: 0,
    currentPlayerIndex: 0,
    currentBet: 0,
    minRaise: overrides.minRaise,
    smallBlind: overrides.smallBlind,
    bigBlind: overrides.bigBlind,
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: false,
    winners: [],
    rake: 0,
    variant: overrides.variant,
    ante: overrides.ante ?? 0,
    bringIn: overrides.bringIn ?? 0,
    betCount: 0,
    maxBetsPerRound: overrides.maxBetsPerRound ?? 0,
    ...overrides.extra,
  };
}

// =========================================================================
//  Hand Start
// =========================================================================

/**
 * 新しいハンドを開始する。
 * 共通リセット → デッキシャッフル → ボタン移動までを行い、
 * 強制ベット・配牌・最初のアクター決定は descriptor.setup に委譲する。
 */
export function startHandCore(state: GameState, d: VariantDescriptor): GameState {
  const newState = { ...state };

  // === ハンド状態のリセット（全バリアント共通分） ===
  newState.communityCards = [];
  newState.pot = 0;
  newState.sidePots = [];
  newState.handHistory = [];
  newState.isHandComplete = false;
  newState.winners = [];
  newState.rake = 0;
  newState.lastRaiserIndex = -1;
  newState.lastFullRaiseBet = 0;
  d.resetHand(newState);

  // === プレイヤー状態のリセット ===
  newState.players = newState.players.map(p => ({
    ...p,
    holeCards: [],
    currentBet: 0,
    totalBetThisRound: 0,
    folded: p.isSittingOut,     // 空席は最初からfolded
    isAllIn: false,
    hasActed: p.isSittingOut,   // 空席はアクション不要
  }));

  // デッキをシャッフル
  newState.deck = shuffleDeck(createDeck());

  // === ディーラーボタンを移動 ===
  // ハンド参加席へ（空席・破産プレイヤーはスキップ）
  const nextDealer = getNextSeatInHand(newState, newState.dealerPosition);
  if (nextDealer !== -1) {
    newState.dealerPosition = nextDealer;
  }

  return d.setup(newState);
}

// --- setup 用の共通部品 -------------------------------------------------

/** SB/BB の席を決定する（Heads-up は BTN=SB の特殊ルール） */
export function findBlindSeats(state: GameState, activeCount: number): { sbIndex: number; bbIndex: number } {
  if (activeCount === 2) {
    let sbIndex = getNextSeatInHand(state, state.dealerPosition - 1);
    if (sbIndex === -1) sbIndex = state.dealerPosition;
    return { sbIndex, bbIndex: getNextSeatInHand(state, sbIndex) };
  }
  const sbIndex = getNextSeatInHand(state, state.dealerPosition);
  return { sbIndex, bbIndex: getNextSeatInHand(state, sbIndex) };
}

/** ブラインドを投稿する（チップが足りない場合はオールイン）。実際に投稿した額を返す */
export function postBlind(state: GameState, seatIndex: number, amount: number): number {
  const p = state.players[seatIndex];
  p.currentBet = Math.min(amount, p.chips);
  p.totalBetThisRound = p.currentBet;
  p.chips -= p.currentBet;
  if (p.chips === 0) p.isAllIn = true;
  return p.currentBet;
}

/** 全参加プレイヤーにホールカードを配る */
export function dealHoleCardsToAll(state: GameState, count: number): void {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (state.players[i].isSittingOut) continue;
    const { cards, remainingDeck } = dealCards(state.deck, count);
    state.players[i].holeCards = cards;
    state.deck = remainingDeck;
  }
}

/** プリフロップの最初のアクター（Heads-up は SB=BTN、通常は UTG） */
export function preflopFirstActor(state: GameState, activeCount: number, sbIndex: number, bbIndex: number): number {
  return activeCount === 2 ? sbIndex : getNextActivePlayer(state, bbIndex);
}

export { getActivePlayerCount };

// =========================================================================
//  Valid Actions
// =========================================================================

export function getValidActionsCore(state: GameState, playerIndex: number, d: VariantDescriptor): ValidAction[] {
  const player = state.players[playerIndex];
  if (player.folded) return [];
  // ドローフェーズ: オールインでもカード交換が可能
  if (d.drawPhase && isDrawStreet(state.currentStreet)) {
    return [{ action: 'draw', minAmount: 0, maxAmount: 5 }];
  }
  if (player.isAllIn) return [];
  return d.betting.getActions(state, playerIndex);
}

// =========================================================================
//  Apply Action
// =========================================================================

export function applyActionCore(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number,
  d: VariantDescriptor,
  rakePercent: number = 0,
  rakeCapBB: number = 0,
  discardIndices?: number[],
): GameState {
  // 状態をディープコピー（イミュータブルな更新）
  const newState = deepClone(state);
  const player = newState.players[playerIndex];

  player.hasActed = true;  // このストリートでアクション済みフラグ

  if (action === 'draw' && d.drawPhase) {
    return d.drawPhase.apply(newState, playerIndex, discardIndices ?? [], d);
  }

  switch (action) {
    case 'fold':
      player.folded = true;
      break;

    case 'check':
      // 何もしない（ベット額0でパス）
      break;

    case 'call': {
      if (!d.betting.applyCallOverride?.(newState, playerIndex)) {
        // 現在のベット額に合わせる
        const toCall = Math.min(newState.currentBet - player.currentBet, player.chips);
        player.chips -= toCall;
        player.currentBet += toCall;
        player.totalBetThisRound += toCall;
        newState.pot += toCall;
        if (player.chips === 0) player.isAllIn = true;
      }
      break;
    }

    case 'bet':
    case 'raise':
      d.betting.applyBetRaise(newState, playerIndex, action, amount);
      break;

    case 'allin': {
      // 残りチップ全額をベット
      const allInAmount = player.chips;
      const newTotal = player.currentBet + allInAmount;
      if (newTotal > newState.currentBet) {
        // オールインがレイズになる場合: フルレイズなら他プレイヤーに再アクション権
        const raiseBy = newTotal - newState.currentBet;
        const isFullRaise = raiseBy >= d.betting.fullRaiseThreshold(newState);
        if (isFullRaise) {
          d.betting.onAllInFullRaise(newState, playerIndex, raiseBy);
        }
        newState.currentBet = newTotal;
        // フルレイズ時のみ lastFullRaiseBet を更新（非フルレイズでは既アクション済みプレイヤーにリレイズ権なし）
        if (isFullRaise && d.betting.allInFullRaiseSetsLastFullRaiseBet) {
          newState.lastFullRaiseBet = newTotal;
        }
      }
      player.currentBet = newTotal;
      player.totalBetThisRound += allInAmount;
      newState.pot += allInAmount;
      player.chips = 0;
      player.isAllIn = true;
      break;
    }
  }

  // アクション履歴に記録
  newState.handHistory.push({ playerId: playerIndex, action, amount, street: state.currentStreet });

  // === 次のアクションを決定 ===
  const nextResult = determineNextActionCore(newState);
  if (nextResult.moveToNextStreet) {
    return moveToNextStreetCore(newState, d, rakePercent, rakeCapBB);
  } else if (nextResult.nextPlayerIndex !== -1) {
    newState.currentPlayerIndex = nextResult.nextPlayerIndex;
  } else {
    // ハンド終了（1人だけ残った等）
    return determineWinnerCore(newState, d, rakePercent, rakeCapBB);
  }

  return newState;
}

/**
 * アクションを適用した結果、次のストリートに進むかどうかを判定する（immutable）
 */
export function wouldAdvanceStreetCore(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number,
  d: VariantDescriptor,
  discardIndices?: number[],
): boolean {
  const resultState = applyActionCore(state, playerIndex, action, amount, d, 0, 0, discardIndices);
  return resultState.currentStreet !== state.currentStreet;
}

// =========================================================================
//  Next Action Determination
// =========================================================================

/**
 * 次にアクションすべきプレイヤーを決定する
 * @returns nextPlayerIndex: 次のプレイヤー（-1なら終了）, moveToNextStreet: 次のストリートに進むか
 */
export function determineNextActionCore(state: GameState): { nextPlayerIndex: number; moveToNextStreet: boolean } {
  const activePlayers = getActivePlayers(state);

  // 1人しか残っていない → ハンド終了
  if (activePlayers.length === 1) {
    return { nextPlayerIndex: -1, moveToNextStreet: false };
  }

  const playersWhoCanAct = getPlayersWhoCanAct(state);

  // アクション可能なプレイヤーがいない（全員オールインかフォールド）
  // → 次のストリートへ（ボードをランアウト）
  if (playersWhoCanAct.length === 0) {
    return { nextPlayerIndex: -1, moveToNextStreet: true };
  }

  // ベッティングラウンド終了条件:
  // 1. 全員がアクション済み
  // 2. 全員のベット額が揃っている（またはオールイン）
  const allActed = playersWhoCanAct.every(p => p.hasActed);
  const allBetsEqual = playersWhoCanAct.every(p => p.currentBet === state.currentBet || p.isAllIn);

  if (allActed && allBetsEqual) {
    return { nextPlayerIndex: -1, moveToNextStreet: true };
  }

  // 次のアクション待ちプレイヤーを探す
  let index = (state.currentPlayerIndex + 1) % MAX_PLAYERS;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[index];
    // アクションが必要なプレイヤー: フォールドしておらず、オールインでもなく、
    // まだアクションしていないか、ベット額が足りていない
    if (!p.folded && !p.isAllIn && !p.isSittingOut && (!p.hasActed || p.currentBet < state.currentBet)) {
      return { nextPlayerIndex: index, moveToNextStreet: false };
    }
    index = (index + 1) % MAX_PLAYERS;
  }

  // 全員アクション完了 → 次のストリートへ
  return { nextPlayerIndex: -1, moveToNextStreet: true };
}

// =========================================================================
//  Street Progression
// =========================================================================

/**
 * 次のストリートへ進む
 */
export function moveToNextStreetCore(state: GameState, d: VariantDescriptor, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  const newState = deepClone(state);

  // ストリート間でベット状態をリセット
  for (const p of newState.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }
  newState.currentBet = 0;
  newState.lastFullRaiseBet = 0;
  newState.betCount = 0;
  const minRaiseBefore = d.betting.minRaiseBeforeAdvance?.(newState);
  if (minRaiseBefore !== undefined) {
    newState.minRaise = minRaiseBefore;
  }

  const activePlayers = getActivePlayers(newState);
  if (activePlayers.length === 1) {
    // 1人だけなら勝者決定
    return determineWinnerCore(newState, d, rakePercent, rakeCapBB);
  }

  const nextStreet = d.flow.nextStreet(newState);
  if (nextStreet === 'showdown') {
    newState.currentStreet = 'showdown';
    return determineWinnerCore(newState, d, rakePercent, rakeCapBB);
  }

  newState.currentStreet = nextStreet;
  d.flow.onEnterStreet(newState);
  newState.minRaise = d.betting.minRaiseForStreet(newState);

  // ドローフェーズはオールインでもカード交換を行うためスキップしない
  const isDrawPhaseStreet = d.drawPhase !== undefined && isDrawStreet(nextStreet);
  if (!isDrawPhaseStreet) {
    // アクション可能なプレイヤーが1人以下ならベッティング不要
    const canActPlayers = activePlayers.filter(p => !p.isAllIn);
    if (canActPlayers.length <= 1) {
      return handleBettingImpossible(newState, d, rakePercent, rakeCapBB);
    }
  }

  const firstActor = d.flow.firstToAct(newState);
  if (firstActor === -1) {
    return handleBettingImpossible(newState, d, rakePercent, rakeCapBB);
  }

  newState.currentPlayerIndex = firstActor;
  return newState;
}

function handleBettingImpossible(state: GameState, d: VariantDescriptor, rakePercent: number, rakeCapBB: number): GameState {
  if (d.flow.whenBettingImpossible === 'skipStreet') {
    return moveToNextStreetCore(state, d, rakePercent, rakeCapBB);
  }
  return runOutAndFinish(state, d, rakePercent, rakeCapBB);
}

/**
 * 残りのカードを配りきってショーダウンへ（全員オールイン時など）
 */
export function runOutAndFinish(state: GameState, d: VariantDescriptor, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  const newState = deepClone(state);
  if (d.flow.runOutDealsBeforeShowdown) {
    d.flow.runOut(newState);
  }
  newState.currentStreet = 'showdown';
  return determineWinnerCore(newState, d, rakePercent, rakeCapBB);
}

// =========================================================================
//  Winner Determination
// =========================================================================

/** サイドポット計算 + uncontested 返却の標準ポット構築 */
export function standardBuildPots(state: GameState): SidePot[] {
  const allPots = calculateSidePots(state.players);
  return settleUncontestedPots(state, allPots);
}

/**
 * 勝者を決定し、ポットを分配する
 * サイドポットを考慮して、各ポットごとに勝者を決定する
 */
export function determineWinnerCore(state: GameState, d: VariantDescriptor, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  const newState = deepClone(state);
  // ノーフロップ・ノードロップ判定用に元のストリートを保存
  const originalStreet = state.currentStreet;
  newState.isHandComplete = true;
  newState.currentStreet = 'showdown';

  const activePlayers = getActivePlayers(newState);

  // アクティブプレイヤーがいない場合（異常ケース）
  if (activePlayers.length === 0) {
    console.error('determineWinner: No active players found');
    newState.winners = [];
    newState.rake = 0;
    return newState;
  }

  // 1人だけ残っている場合 → その人が無条件で勝者
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    // ノーフロップ・ノードロップ: 最初のストリートで終わったハンドはレーキなし
    let rake = 0;
    const noDrop = d.showdown.noDropStreet;
    if ((noDrop === null || originalStreet !== noDrop) && rakePercent > 0) {
      rake = calculateRake(newState.pot, d.showdown.rakeCapBase(newState), rakePercent, rakeCapBB);
    }
    newState.rake = rake;
    const winAmount = newState.pot - rake;
    winner.chips += winAmount;
    newState.winners = [{ playerId: winner.id, amount: winAmount, handName: '' }];
    return newState;
  }

  // ショーダウンに必要な残りカードを配りきる
  d.flow.runOut(newState);

  // === ポット構築（サイドポット + uncontested 返却） ===
  const contestedPots = d.showdown.buildPots(newState);

  // レーキ計算: contestedポットの合計からレーキを差し引く
  const totalContested = contestedPots.reduce((sum, p) => sum + p.amount, 0);
  let rake = 0;
  if (rakePercent > 0 && totalContested > 0) {
    rake = calculateRake(totalContested, d.showdown.rakeCapBase(newState), rakePercent, rakeCapBB);
  }
  newState.rake = rake;
  deductRakeProportionally(contestedPots, rake, totalContested);

  newState.sidePots = contestedPots;

  // === バリアント固有のショーダウン解決 ===
  const potWinners = d.showdown.resolvePots(newState, activePlayers, contestedPots);

  // === チップ付与 & winners配列構築 ===
  newState.winners = [];
  for (const pw of potWinners) {
    const player = newState.players.find(p => p.id === pw.playerId)!;
    player.chips += pw.amount;
    newState.winners.push({
      playerId: pw.playerId,
      amount: pw.amount,
      handName: pw.handName,
      ...(pw.hiLoType ? { hiLoType: pw.hiLoType } : {}),
    });
  }

  return newState;
}
