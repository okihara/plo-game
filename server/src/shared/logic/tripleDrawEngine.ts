import { GameState, Player, Position, Action, Card, Street, GameVariant } from './types.js';
import { createDeck, shuffleDeck, dealCards } from './deck.js';
import { getActivePlayers, getPlayersWhoCanAct, calculateSidePots, calculateRake } from './gameEngine.js';
import { evaluate27LowHand, compare27LowHands } from './handEvaluator.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
const MAX_PLAYERS = 6;

// =========================================================================
//  Street Helpers
// =========================================================================

export function isDrawStreet(street: Street): boolean {
  return street === 'draw1' || street === 'draw2' || street === 'draw3';
}

export function isBettingStreet(street: Street): boolean {
  return street === 'predraw' || street === 'postdraw1' || street === 'postdraw2' || street === 'final';
}

/** 現在のストリートのベットサイズ (small bet or big bet) */
function getCurrentBetSize(state: GameState): number {
  if (state.currentStreet === 'predraw' || state.currentStreet === 'postdraw1') {
    return state.smallBlind; // small bet
  }
  return state.bigBlind; // big bet
}

function getNextTripleDrawStreet(current: Street): Street {
  const order: Record<string, Street> = {
    predraw: 'draw1',
    draw1: 'postdraw1',
    postdraw1: 'draw2',
    postdraw2: 'draw3',
    draw2: 'postdraw2',
    draw3: 'final',
    final: 'showdown',
  };
  return order[current] || 'showdown';
}

// =========================================================================
//  State Creation
// =========================================================================

export function createTripleDrawGameState(playerChips: number, smallBet: number): GameState {
  const players: Player[] = [];
  const names = ['You', 'Miko', 'Kento', 'Luna', 'Hiro', 'Tomoka'];

  for (let i = 0; i < MAX_PLAYERS; i++) {
    players.push({
      id: i,
      name: names[i],
      position: POSITIONS[i],
      chips: playerChips,
      holeCards: [],
      currentBet: 0,
      totalBetThisRound: 0,
      folded: false,
      isAllIn: false,
      hasActed: false,
      isSittingOut: false,
    });
  }

  return {
    players,
    deck: [],
    communityCards: [],
    pot: 0,
    sidePots: [],
    currentStreet: 'predraw' as Street,
    dealerPosition: 0,
    currentPlayerIndex: 0,
    currentBet: 0,
    minRaise: smallBet,
    smallBlind: smallBet,
    bigBlind: smallBet * 2,
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: false,
    winners: [],
    rake: 0,
    variant: 'tripdraw' as GameVariant,
    ante: 0,
    bringIn: 0,
    betCount: 0,
    maxBetsPerRound: 4,
    discardPile: [],
  };
}

// =========================================================================
//  Start New Hand
// =========================================================================

export function startTripleDrawHand(state: GameState): GameState {
  const newState = { ...state };

  // ハンド状態リセット
  newState.communityCards = [];
  newState.pot = 0;
  newState.sidePots = [];
  newState.currentStreet = 'predraw' as Street;
  newState.handHistory = [];
  newState.isHandComplete = false;
  newState.winners = [];
  newState.rake = 0;
  newState.lastRaiserIndex = -1;
  newState.lastFullRaiseBet = 0;
  newState.betCount = 0;
  newState.discardPile = [];

  // プレイヤー状態リセット
  newState.players = newState.players.map(p => ({
    ...p,
    holeCards: [],
    currentBet: 0,
    totalBetThisRound: 0,
    folded: p.isSittingOut,
    isAllIn: false,
    hasActed: p.isSittingOut,
  }));

  // デッキシャッフル
  newState.deck = shuffleDeck(createDeck());

  // ディーラーボタン移動
  const nextDealer = getNextSeatWithChips(newState, newState.dealerPosition);
  if (nextDealer !== -1) {
    newState.dealerPosition = nextDealer;
  }

  // ポジション名更新
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const posIndex = (i - newState.dealerPosition + MAX_PLAYERS) % MAX_PLAYERS;
    newState.players[i].position = POSITIONS[posIndex];
  }

  const activeCount = getActivePlayerCount(newState);

  // === ブラインド位置決定 ===
  let sbIndex: number;
  let bbIndex: number;

  if (activeCount === 2) {
    // Heads-up: BTN = SB
    sbIndex = getNextSeatWithChips(newState, newState.dealerPosition - 1);
    if (sbIndex === -1) sbIndex = newState.dealerPosition;
    bbIndex = getNextSeatWithChips(newState, sbIndex);
  } else {
    sbIndex = getNextSeatWithChips(newState, newState.dealerPosition);
    bbIndex = getNextSeatWithChips(newState, sbIndex);
  }

  // === ブラインド投稿 ===
  const sbAmount = Math.min(newState.smallBlind, newState.players[sbIndex].chips);
  newState.players[sbIndex].currentBet = sbAmount;
  newState.players[sbIndex].totalBetThisRound = sbAmount;
  newState.players[sbIndex].chips -= sbAmount;
  if (newState.players[sbIndex].chips === 0) newState.players[sbIndex].isAllIn = true;

  const bbAmount = Math.min(newState.bigBlind, newState.players[bbIndex].chips);
  newState.players[bbIndex].currentBet = bbAmount;
  newState.players[bbIndex].totalBetThisRound = bbAmount;
  newState.players[bbIndex].chips -= bbAmount;
  if (newState.players[bbIndex].chips === 0) newState.players[bbIndex].isAllIn = true;

  newState.pot = sbAmount + bbAmount;
  newState.currentBet = newState.bigBlind;
  newState.minRaise = newState.smallBlind;
  newState.lastFullRaiseBet = newState.currentBet;

  // === カード配布: 各プレイヤーに5枚 ===
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (newState.players[i].isSittingOut) continue;
    const { cards, remainingDeck } = dealCards(newState.deck, 5);
    newState.players[i].holeCards = cards;
    newState.deck = remainingDeck;
  }

  // === アクション開始位置 ===
  if (activeCount === 2) {
    newState.currentPlayerIndex = sbIndex;
  } else {
    newState.currentPlayerIndex = getNextActivePlayer(newState, bbIndex);
  }
  newState.lastRaiserIndex = bbIndex;

  if (newState.currentPlayerIndex === -1) {
    return tripleDrawRunOut(newState);
  }

  return newState;
}

// =========================================================================
//  Valid Actions
// =========================================================================

export function getTripleDrawValidActions(
  state: GameState, playerIndex: number
): { action: Action; minAmount: number; maxAmount: number }[] {
  const player = state.players[playerIndex];
  if (player.folded || player.isAllIn) return [];

  // === ドローフェーズ ===
  if (isDrawStreet(state.currentStreet)) {
    return [{ action: 'draw' as Action, minAmount: 0, maxAmount: 5 }];
  }

  // === ベッティングフェーズ ===
  const actions: { action: Action; minAmount: number; maxAmount: number }[] = [];
  const betSize = getCurrentBetSize(state);
  const toCall = state.currentBet - player.currentBet;

  // フォールド
  actions.push({ action: 'fold', minAmount: 0, maxAmount: 0 });

  if (toCall === 0) {
    actions.push({ action: 'check', minAmount: 0, maxAmount: 0 });
  } else {
    const callAmount = Math.min(toCall, player.chips);
    actions.push({ action: 'call', minAmount: callAmount, maxAmount: callAmount });
  }

  // ベット/レイズ (Fixed Limit)
  const canRaise = state.betCount < state.maxBetsPerRound;

  if (canRaise && player.chips > toCall) {
    if (state.currentBet === 0) {
      // ベット
      if (player.chips >= betSize) {
        actions.push({ action: 'bet', minAmount: betSize, maxAmount: betSize });
      } else if (player.chips > 0) {
        actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
      }
    } else {
      // レイズ
      const raiseTotal = state.currentBet + betSize;
      const raiseAmount = raiseTotal - player.currentBet;
      if (player.chips >= raiseAmount) {
        actions.push({ action: 'raise', minAmount: raiseAmount, maxAmount: raiseAmount });
      } else if (player.chips > toCall) {
        actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
      }
    }
  }

  return actions;
}

// =========================================================================
//  Apply Action
// =========================================================================

export function applyTripleDrawAction(
  state: GameState, playerIndex: number, action: Action, amount: number = 0,
  rakePercent: number = 0, rakeCapBB: number = 0, discardIndices?: number[]
): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  const player = newState.players[playerIndex];
  player.hasActed = true;

  if (action === 'draw') {
    return applyDrawAction(newState, playerIndex, discardIndices ?? []);
  }

  // === ベッティングフェーズ ===
  const betSize = getCurrentBetSize(newState);

  switch (action) {
    case 'fold':
      player.folded = true;
      break;

    case 'check':
      break;

    case 'call': {
      const toCall = Math.min(newState.currentBet - player.currentBet, player.chips);
      player.chips -= toCall;
      player.currentBet += toCall;
      player.totalBetThisRound += toCall;
      newState.pot += toCall;
      if (player.chips === 0) player.isAllIn = true;
      break;
    }

    case 'bet': {
      const betAmount = betSize - player.currentBet;
      const actualAmount = Math.min(betAmount, player.chips);
      player.chips -= actualAmount;
      player.currentBet += actualAmount;
      player.totalBetThisRound += actualAmount;
      newState.pot += actualAmount;
      newState.currentBet = player.currentBet;
      newState.lastRaiserIndex = playerIndex;
      newState.betCount++;
      if (player.chips === 0) player.isAllIn = true;
      for (const p of newState.players) {
        if (p.id !== player.id && !p.folded && !p.isAllIn) {
          p.hasActed = false;
        }
      }
      break;
    }

    case 'raise': {
      const raiseTotal = newState.currentBet + betSize;
      const raiseAmount = raiseTotal - player.currentBet;
      const actualAmount = Math.min(raiseAmount, player.chips);
      player.chips -= actualAmount;
      player.currentBet += actualAmount;
      player.totalBetThisRound += actualAmount;
      newState.pot += actualAmount;
      newState.currentBet = player.currentBet;
      newState.lastRaiserIndex = playerIndex;
      newState.betCount++;
      if (player.chips === 0) player.isAllIn = true;
      for (const p of newState.players) {
        if (p.id !== player.id && !p.folded && !p.isAllIn) {
          p.hasActed = false;
        }
      }
      break;
    }

    case 'allin': {
      const allInAmount = player.chips;
      if (player.currentBet + allInAmount > newState.currentBet) {
        const raiseBy = (player.currentBet + allInAmount) - newState.currentBet;
        const isFullRaise = raiseBy >= betSize;
        if (isFullRaise) {
          newState.betCount++;
          newState.lastRaiserIndex = playerIndex;
          for (const p of newState.players) {
            if (p.id !== player.id && !p.folded && !p.isAllIn) {
              p.hasActed = false;
            }
          }
        }
        newState.currentBet = player.currentBet + allInAmount;
      }
      player.currentBet += allInAmount;
      player.totalBetThisRound += allInAmount;
      newState.pot += allInAmount;
      player.chips = 0;
      player.isAllIn = true;
      break;
    }
  }

  // アクション履歴
  newState.handHistory.push({ playerId: playerIndex, action, amount, street: state.currentStreet });

  // 次のアクション決定
  const nextResult = determineBettingNextAction(newState);
  if (nextResult.moveToNextStreet) {
    return moveToNextTripleDrawStreet(newState, rakePercent, rakeCapBB);
  } else if (nextResult.nextPlayerIndex !== -1) {
    newState.currentPlayerIndex = nextResult.nextPlayerIndex;
  } else {
    return determineTripleDrawWinner(newState, rakePercent, rakeCapBB);
  }

  return newState;
}

export function wouldTripleDrawAdvanceStreet(
  state: GameState, playerIndex: number, action: Action, amount: number = 0, discardIndices?: number[]
): boolean {
  const resultState = applyTripleDrawAction(state, playerIndex, action, amount, 0, 0, discardIndices);
  return resultState.currentStreet !== state.currentStreet;
}

// =========================================================================
//  Draw Action
// =========================================================================

function applyDrawAction(state: GameState, playerIndex: number, discardIndices: number[]): GameState {
  const player = state.players[playerIndex];

  // バリデーション: 重複除去、範囲チェック、降順ソート（後ろから削除）
  const uniqueIndices = [...new Set(discardIndices)]
    .filter(i => i >= 0 && i < player.holeCards.length)
    .sort((a, b) => b - a);

  // 捨てるカードをdiscardPileに移動
  const discardedCards: Card[] = [];
  for (const idx of uniqueIndices) {
    discardedCards.push(player.holeCards[idx]);
    player.holeCards.splice(idx, 1);
  }
  if (!state.discardPile) state.discardPile = [];
  state.discardPile.push(...discardedCards);

  // 新しいカードを引く
  const needCards = discardedCards.length;
  if (needCards > 0) {
    if (state.deck.length < needCards) {
      reshuffleDiscardPile(state);
    }
    const drawCount = Math.min(needCards, state.deck.length);
    const { cards, remainingDeck } = dealCards(state.deck, drawCount);
    player.holeCards.push(...cards);
    state.deck = remainingDeck;
  }

  // アクション履歴
  state.handHistory.push({
    playerId: playerIndex,
    action: 'draw' as Action,
    amount: discardedCards.length,
    street: state.currentStreet,
    discardIndices: uniqueIndices.sort((a, b) => a - b),
  });

  // 次のプレイヤー or 次のストリート
  const nextResult = determineDrawNextAction(state);
  if (nextResult.moveToNextStreet) {
    return moveToNextTripleDrawStreet(state, 0, 0);
  } else if (nextResult.nextPlayerIndex !== -1) {
    state.currentPlayerIndex = nextResult.nextPlayerIndex;
  } else {
    return determineTripleDrawWinner(state, 0, 0);
  }

  return state;
}

function reshuffleDiscardPile(state: GameState): void {
  if (!state.discardPile || state.discardPile.length === 0) return;
  const reshuffled = shuffleDeck([...state.discardPile]);
  state.deck = [...state.deck, ...reshuffled];
  state.discardPile = [];
}

// =========================================================================
//  Next Action Determination
// =========================================================================

function determineBettingNextAction(state: GameState): { nextPlayerIndex: number; moveToNextStreet: boolean } {
  const activePlayers = getActivePlayers(state);

  if (activePlayers.length === 1) {
    return { nextPlayerIndex: -1, moveToNextStreet: false };
  }

  const playersWhoCanAct = getPlayersWhoCanAct(state);

  if (playersWhoCanAct.length === 0) {
    return { nextPlayerIndex: -1, moveToNextStreet: true };
  }

  const allActed = playersWhoCanAct.every(p => p.hasActed);
  const allBetsEqual = playersWhoCanAct.every(p => p.currentBet === state.currentBet || p.isAllIn);

  if (allActed && allBetsEqual) {
    return { nextPlayerIndex: -1, moveToNextStreet: true };
  }

  // 次のアクション待ちプレイヤーを探す
  let index = (state.currentPlayerIndex + 1) % MAX_PLAYERS;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[index];
    if (!p.folded && !p.isAllIn && !p.isSittingOut && (!p.hasActed || p.currentBet < state.currentBet)) {
      return { nextPlayerIndex: index, moveToNextStreet: false };
    }
    index = (index + 1) % MAX_PLAYERS;
  }

  return { nextPlayerIndex: -1, moveToNextStreet: true };
}

function determineDrawNextAction(state: GameState): { nextPlayerIndex: number; moveToNextStreet: boolean } {
  const activePlayers = getActivePlayers(state);

  if (activePlayers.length === 1) {
    return { nextPlayerIndex: -1, moveToNextStreet: false };
  }

  // ドロー可能なプレイヤー（フォールド/オールイン/アクション済みを除く）
  let index = (state.currentPlayerIndex + 1) % MAX_PLAYERS;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[index];
    if (!p.folded && !p.isAllIn && !p.isSittingOut && !p.hasActed) {
      return { nextPlayerIndex: index, moveToNextStreet: false };
    }
    index = (index + 1) % MAX_PLAYERS;
  }

  // 全員ドロー済み → 次のストリートへ
  return { nextPlayerIndex: -1, moveToNextStreet: true };
}

// =========================================================================
//  Street Progression
// =========================================================================

function moveToNextTripleDrawStreet(state: GameState, rakePercent: number, rakeCapBB: number): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;

  // ストリート間リセット
  for (const p of newState.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }
  newState.currentBet = 0;
  newState.lastFullRaiseBet = 0;
  newState.betCount = 0;

  const activePlayers = getActivePlayers(newState);
  if (activePlayers.length === 1) {
    return determineTripleDrawWinner(newState, rakePercent, rakeCapBB);
  }

  const nextStreet = getNextTripleDrawStreet(newState.currentStreet);
  if (nextStreet === 'showdown') {
    newState.currentStreet = 'showdown';
    return determineTripleDrawWinner(newState, rakePercent, rakeCapBB);
  }

  newState.currentStreet = nextStreet;
  newState.minRaise = getCurrentBetSize(newState);

  const canActPlayers = activePlayers.filter(p => !p.isAllIn);

  // ドローフェーズでアクション可能なプレイヤーがいない場合スキップ
  if (isDrawStreet(nextStreet) && canActPlayers.length === 0) {
    return moveToNextTripleDrawStreet(newState, rakePercent, rakeCapBB);
  }

  // ベッティングフェーズでアクション可能なプレイヤーが1人以下ならスキップ
  if (isBettingStreet(nextStreet) && canActPlayers.length <= 1) {
    return moveToNextTripleDrawStreet(newState, rakePercent, rakeCapBB);
  }

  // アクション順序: ディーラーの左(SB)から
  const firstActor = findFirstActor(newState);
  if (firstActor === -1) {
    return moveToNextTripleDrawStreet(newState, rakePercent, rakeCapBB);
  }

  newState.currentPlayerIndex = firstActor;
  return newState;
}

/** ディーラーの左（SB側）からアクション可能な最初のプレイヤーを探す */
function findFirstActor(state: GameState): number {
  const sbIndex = (state.dealerPosition + 1) % MAX_PLAYERS;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const idx = (sbIndex + i) % MAX_PLAYERS;
    const p = state.players[idx];
    if (!p.folded && !p.isAllIn && !p.isSittingOut) {
      return idx;
    }
  }
  return -1;
}

// =========================================================================
//  Winner Determination
// =========================================================================

export function determineTripleDrawWinner(
  state: GameState, rakePercent: number = 0, rakeCapBB: number = 0
): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  const originalStreet = state.currentStreet;
  newState.isHandComplete = true;
  newState.currentStreet = 'showdown';

  const activePlayers = getActivePlayers(newState);

  if (activePlayers.length === 0) {
    newState.winners = [];
    newState.rake = 0;
    return newState;
  }

  // 1人だけ → 無条件勝利
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    let rake = 0;
    if (originalStreet !== 'predraw' && rakePercent > 0) {
      rake = calculateRake(newState.pot, newState.bigBlind, rakePercent, rakeCapBB);
    }
    newState.rake = rake;
    const winAmount = newState.pot - rake;
    winner.chips += winAmount;
    newState.winners = [{ playerId: winner.id, amount: winAmount, handName: '' }];
    return newState;
  }

  // サイドポット計算
  const allPots = calculateSidePots(newState.players);
  const contestedPots = allPots.filter(p => p.eligiblePlayers.length >= 2);
  const uncontestedPots = allPots.filter(p => p.eligiblePlayers.length === 1);

  for (const pot of uncontestedPots) {
    const player = newState.players.find(p => p.id === pot.eligiblePlayers[0])!;
    player.chips += pot.amount;
    newState.pot -= pot.amount;
  }

  // レーキ
  const totalContested = contestedPots.reduce((sum, p) => sum + p.amount, 0);
  let rake = 0;
  if (rakePercent > 0 && totalContested > 0) {
    rake = calculateRake(totalContested, newState.bigBlind, rakePercent, rakeCapBB);
  }
  newState.rake = rake;

  if (rake > 0 && totalContested > 0) {
    let rakeRemaining = rake;
    for (const pot of contestedPots) {
      const potRake = Math.floor(rake * pot.amount / totalContested);
      pot.amount -= potRake;
      rakeRemaining -= potRake;
    }
    if (rakeRemaining > 0 && contestedPots.length > 0) {
      contestedPots[contestedPots.length - 1].amount -= rakeRemaining;
    }
  }

  newState.sidePots = contestedPots;

  // 2-7 ローボール評価
  const playerHandMap = new Map<number, ReturnType<typeof evaluate27LowHand>>();
  for (const p of activePlayers) {
    if (p.holeCards.length === 5) {
      playerHandMap.set(p.id, evaluate27LowHand(p.holeCards));
    }
  }

  // 各ポットの勝者決定
  const winnerAmounts = new Map<number, { amount: number; handName: string }>();

  for (const pot of contestedPots) {
    const eligibleHands = pot.eligiblePlayers
      .filter(id => playerHandMap.has(id))
      .map(id => ({ playerId: id, hand: playerHandMap.get(id)! }));

    if (eligibleHands.length === 0) continue;

    // ロー順ソート
    eligibleHands.sort((a, b) => compare27LowHands(a.hand, b.hand));

    // タイ検出
    const potWinners = [eligibleHands[0]];
    for (let i = 1; i < eligibleHands.length; i++) {
      if (compare27LowHands(eligibleHands[i].hand, eligibleHands[0].hand) === 0) {
        potWinners.push(eligibleHands[i]);
      } else {
        break;
      }
    }

    const winAmount = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount % potWinners.length;

    for (let i = 0; i < potWinners.length; i++) {
      const amount = winAmount + (i === 0 ? remainder : 0);
      const existing = winnerAmounts.get(potWinners[i].playerId);
      if (existing) {
        existing.amount += amount;
      } else {
        winnerAmounts.set(potWinners[i].playerId, {
          amount,
          handName: potWinners[i].hand.name,
        });
      }
    }
  }

  newState.winners = [];
  for (const [playerId, { amount, handName }] of winnerAmounts) {
    const player = newState.players.find(p => p.id === playerId)!;
    player.chips += amount;
    newState.winners.push({ playerId, amount, handName });
  }

  return newState;
}

// =========================================================================
//  Run-out (全員オールイン時)
// =========================================================================

function tripleDrawRunOut(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  newState.currentStreet = 'showdown';
  return determineTripleDrawWinner(newState, rakePercent, rakeCapBB);
}

// =========================================================================
//  Helpers
// =========================================================================

function getNextActivePlayer(state: GameState, fromIndex: number): number {
  let index = (fromIndex + 1) % MAX_PLAYERS;
  for (let count = 0; count < MAX_PLAYERS; count++) {
    const p = state.players[index];
    if (!p.isSittingOut && !p.folded && !p.isAllIn) {
      return index;
    }
    index = (index + 1) % MAX_PLAYERS;
  }
  return -1;
}

function getNextSeatWithChips(state: GameState, fromIndex: number): number {
  let index = (fromIndex + 1) % MAX_PLAYERS;
  for (let count = 0; count < MAX_PLAYERS; count++) {
    if (!state.players[index].isSittingOut && !state.players[index].folded) {
      return index;
    }
    index = (index + 1) % MAX_PLAYERS;
  }
  return -1;
}

function getActivePlayerCount(state: GameState): number {
  return state.players.filter(p => !p.isSittingOut && !p.folded).length;
}
