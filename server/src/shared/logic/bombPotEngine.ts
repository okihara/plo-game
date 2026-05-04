// PLO Double Board Bomb Pot エンジン
//
// 仕様詳細: docs/double-board-bomb-pot.md
//
// 通常 PLO との差分:
//   - プリフロップなし。全員 1 BB のアンテを支払い、即フロップから開始
//   - 2つの独立したボード（各 5 枚）を同時に進行
//   - ベッティングは 1 系統（フロップ → ターン → リバー、Pot Limit）
//   - 各 contested side pot を半分ずつ 2 ボードに分け、ボード毎に独立評価

import { GameState, Player, Position, Action, Card } from './types.js';
import { createDeck, shuffleDeck, dealCards } from './deck.js';
import { evaluatePLOHand, compareHands, formatHandName } from './handEvaluator.js';
import {
  assignBlindPostingPositions,
  calculateRake,
  calculateSidePots,
  determineNextAction,
  getActivePlayers,
  getPlayersWhoCanAct,
  getValidActions,
  splitChipsEvenly,
} from './gameEngine.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
const HOLE_CARD_COUNT = 4; // PLO 固定（plo5 は対象外）
const BOARD_COUNT = 2;     // double board 固定

/**
 * Bomb pot 用の初期 GameState を作成
 */
export function createBombPotGameState(playerChips: number = 600): GameState {
  const players: Player[] = [];
  const names = ['You', 'Miko', 'Kento', 'Luna', 'Hiro', 'Tomoka'];
  for (let i = 0; i < 6; i++) {
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
    boards: [[], []],
    pot: 0,
    sidePots: [],
    currentStreet: 'preflop', // startBombPotHand で 'flop' に切り替え
    dealerPosition: 0,
    currentPlayerIndex: 0,
    currentBet: 0,
    minRaise: 0,
    // bomb pot は SB/BB を投稿せず全員アンテのみ。"sb=0 / bb=0 / ante=N" で統一表現。
    smallBlind: 0,
    bigBlind: 0,
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: false,
    winners: [],
    rake: 0,
    variant: 'plo_double_board_bomb',
    ante: 3, // 後で VariantAdapter / TableInstance が blind level の bb 値で上書き
    bringIn: 0,
    betCount: 0,
    maxBetsPerRound: 0,
  };
}

/**
 * Bomb pot ハンドを開始
 *
 *   1. ハンド状態をリセット
 *   2. ボタンを次のチップ保有者へ移動
 *   3. SB/BB ラベルを付与（投稿はしない）
 *   4. 全アクティブプレイヤーから 1 BB のアンテを徴収（不足は all-in）
 *   5. ホール 4 枚を配布
 *   6. 各ボードに 3 枚ずつ配布
 *   7. currentStreet = 'flop'、firstActor = SB（HU は BB）
 */
export function startBombPotHand(state: GameState): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));

  // === ハンド状態リセット ===
  newState.communityCards = [];
  newState.boards = [[], []];
  newState.pot = 0;
  newState.sidePots = [];
  newState.currentBet = 0;
  // bomb pot ではポストフロップの最小ベット = アンテ額（= 1BB 相当）
  newState.minRaise = newState.ante;
  newState.handHistory = [];
  newState.isHandComplete = false;
  newState.winners = [];
  newState.rake = 0;
  newState.lastRaiserIndex = -1;
  newState.lastFullRaiseBet = 0;

  // === プレイヤー状態リセット ===
  newState.players = newState.players.map(p => ({
    ...p,
    holeCards: [],
    currentBet: 0,
    totalBetThisRound: 0,
    folded: p.isSittingOut,
    isAllIn: false,
    hasActed: p.isSittingOut,
  }));

  // デッキ
  newState.deck = shuffleDeck(createDeck());

  // === ディーラーボタン移動 ===
  const nextDealer = getNextPlayerWithChips(newState, newState.dealerPosition);
  if (nextDealer !== -1) {
    newState.dealerPosition = nextDealer;
  }

  const activeCount = getActivePlayerCount(newState);

  // === SB/BB ラベル付与（位置決定のため。投稿はしない）===
  let sbIndex: number;
  let bbIndex: number;
  if (activeCount === 2) {
    // HU: BTN=SB
    sbIndex = newState.dealerPosition;
    const next = getNextPlayerWithChips(newState, sbIndex);
    bbIndex = next === -1 ? sbIndex : next;
  } else {
    sbIndex = getNextPlayerWithChips(newState, newState.dealerPosition);
    bbIndex = getNextPlayerWithChips(newState, sbIndex);
  }
  assignBlindPostingPositions(newState, newState.dealerPosition, sbIndex, bbIndex, activeCount, 6);

  // === アンテ徴収（全員 1 BB 相当、不足は持っているチップ全部）===
  // 標準ポーカーの ante ルール: アンテはベットではないので side pot を作らない。
  // 短スタックがアンテで all-in でも勝てば pot 全額を獲得できるよう、
  // totalBetThisRound には記録せず pot に直接加算する。
  // post-flop で bet/raise した分のみが totalBetThisRound に乗り、そこから
  // 通常通り side pot が形成される。
  const ante = newState.ante;
  for (const p of newState.players) {
    if (p.isSittingOut) continue;
    const paid = Math.min(ante, p.chips);
    p.chips -= paid;
    p.totalBetThisRound = 0;
    p.currentBet = 0;
    if (p.chips === 0) p.isAllIn = true;
    newState.pot += paid;
  }

  // === ホールカード配布 (4 枚 × 6席) ===
  for (let i = 0; i < 6; i++) {
    if (newState.players[i].isSittingOut) continue;
    const { cards, remainingDeck } = dealCards(newState.deck, HOLE_CARD_COUNT);
    newState.players[i].holeCards = cards;
    newState.deck = remainingDeck;
  }

  // === 各ボードにフロップ 3 枚を配布 ===
  for (let b = 0; b < BOARD_COUNT; b++) {
    const { cards, remainingDeck } = dealCards(newState.deck, 3);
    newState.boards![b] = cards;
    newState.deck = remainingDeck;
  }
  newState.communityCards = newState.boards![0]; // 後方互換ミラー

  newState.currentStreet = 'flop';

  // === 最初に行動するプレイヤー ===
  // ポストフロップ規則と同じ: SB（dealer+1）から時計回り
  // HU は dealer = SB なので dealer+1 = BB が先。一致。
  const firstActor = findFirstActorPostFlop(newState);
  if (firstActor === -1) {
    // 全員 all-in (アンテで破産) → ランアウトしてショーダウン
    return runOutBombPotBoards(newState, 0, 0);
  }
  newState.currentPlayerIndex = firstActor;

  return newState;
}

/**
 * Bomb pot 用の有効アクション（通常 PLO と同一の Pot Limit ロジック）
 */
export const getBombPotValidActions = getValidActions;

/**
 * Bomb pot のアクション適用
 * 通常 PLO と同じプレイヤー状態更新を行い、ストリート遷移時のみ
 * 2 ボード分のカードを配る moveBombPotToNextStreet を呼ぶ。
 */
export function applyBombPotAction(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number = 0,
  rakePercent: number = 0,
  rakeCapBB: number = 0,
): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  const player = newState.players[playerIndex];

  player.hasActed = true;

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

    case 'bet':
    case 'raise': {
      const raiseBy = amount - (newState.currentBet - player.currentBet);
      if (raiseBy > newState.minRaise) {
        newState.minRaise = raiseBy;
      }
      player.chips -= amount;
      player.currentBet += amount;
      player.totalBetThisRound += amount;
      newState.pot += amount;
      newState.currentBet = player.currentBet;
      newState.lastRaiserIndex = playerIndex;
      newState.lastFullRaiseBet = newState.currentBet;
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
        const isFullRaise = raiseBy >= newState.minRaise;
        if (isFullRaise) {
          newState.minRaise = raiseBy;
          newState.lastRaiserIndex = playerIndex;
          for (const p of newState.players) {
            if (p.id !== player.id && !p.folded && !p.isAllIn) {
              p.hasActed = false;
            }
          }
        }
        newState.currentBet = player.currentBet + allInAmount;
        if (isFullRaise) {
          newState.lastFullRaiseBet = newState.currentBet;
        }
      }
      player.currentBet += allInAmount;
      player.totalBetThisRound += allInAmount;
      newState.pot += allInAmount;
      player.chips = 0;
      player.isAllIn = true;
      break;
    }
  }

  newState.handHistory.push({ playerId: playerIndex, action, amount, street: state.currentStreet });

  const next = determineNextAction(newState);
  if (next.moveToNextStreet) {
    return moveBombPotToNextStreet(newState, rakePercent, rakeCapBB);
  } else if (next.nextPlayerIndex !== -1) {
    newState.currentPlayerIndex = next.nextPlayerIndex;
  } else {
    return determineBombPotWinner(newState, rakePercent, rakeCapBB);
  }

  return newState;
}

/**
 * 適用前にストリートが進むかを判定
 */
export function wouldBombPotAdvanceStreet(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number = 0,
): boolean {
  const result = applyBombPotAction(state, playerIndex, action, amount);
  return result.currentStreet !== state.currentStreet;
}

/**
 * 次のストリートへ進める（両ボード共通でカードを 1 枚ずつ追加）
 */
function moveBombPotToNextStreet(
  state: GameState,
  rakePercent: number,
  rakeCapBB: number,
): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));

  for (const p of newState.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }
  newState.currentBet = 0;
  // bomb pot: 最小ベット = アンテ額（= 1BB 相当）
  newState.minRaise = newState.ante;
  newState.lastFullRaiseBet = 0;

  const activePlayers = getActivePlayers(newState);
  if (activePlayers.length === 1) {
    return determineBombPotWinner(newState, rakePercent, rakeCapBB);
  }

  switch (newState.currentStreet) {
    case 'flop':
      newState.currentStreet = 'turn';
      dealOneToEachBoard(newState);
      break;
    case 'turn':
      newState.currentStreet = 'river';
      dealOneToEachBoard(newState);
      break;
    case 'river':
      newState.currentStreet = 'showdown';
      return determineBombPotWinner(newState, rakePercent, rakeCapBB);
    default:
      // 'preflop' からは来ない（startBombPotHand で 'flop' になっている）想定
      throw new Error(`bomb pot: unexpected street transition from ${newState.currentStreet}`);
  }

  // ベット可能プレイヤーが 1 人以下ならランアウト
  const canActPlayers = activePlayers.filter(p => !p.isAllIn);
  if (canActPlayers.length <= 1) {
    return runOutBombPotBoards(newState, rakePercent, rakeCapBB);
  }

  const firstActor = findFirstActorPostFlop(newState);
  newState.currentPlayerIndex = firstActor;
  return newState;
}

/**
 * 残りのカードを両ボードに配り切る（all-in ランアウト）
 */
function runOutBombPotBoards(
  state: GameState,
  rakePercent: number,
  rakeCapBB: number,
): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  while (boardNeedsMore(newState)) {
    dealOneToEachBoard(newState);
  }
  newState.currentStreet = 'showdown';
  return determineBombPotWinner(newState, rakePercent, rakeCapBB);
}

/**
 * 各ボードに 1 枚ずつカードを配る
 */
function dealOneToEachBoard(state: GameState): void {
  if (!state.boards) state.boards = [[], []];
  for (let b = 0; b < BOARD_COUNT; b++) {
    if (state.boards[b].length >= 5) continue;
    const { cards, remainingDeck } = dealCards(state.deck, 1);
    state.boards[b].push(...cards);
    state.deck = remainingDeck;
  }
  state.communityCards = state.boards[0];
}

/** 両ボードが 5 枚に達していなければ true */
function boardNeedsMore(state: GameState): boolean {
  if (!state.boards) return false;
  return state.boards.some(b => b.length < 5);
}

/**
 * 勝者決定
 *
 * 各 contested side pot を 2 ボードに半分割し、ボード毎に PLO 評価で勝者を決める。
 * 半分割の端数（1 チップ）はボード 1 へ。ボード内チョップの端数は最初の勝者へ。
 *
 * winners[] には (playerId × board) ごとに 1 エントリを push（同一プレイヤーが
 * 両ボードで勝った場合は 2 エントリ）。amount はそのボードでの取り分。
 */
export function determineBombPotWinner(
  state: GameState,
  rakePercent: number = 0,
  rakeCapBB: number = 0,
): GameState {
  const newState: GameState = JSON.parse(JSON.stringify(state));
  newState.isHandComplete = true;
  newState.currentStreet = 'showdown';

  const activePlayers = getActivePlayers(newState);

  if (activePlayers.length === 0) {
    console.error('determineBombPotWinner: no active players');
    newState.winners = [];
    newState.rake = 0;
    return newState;
  }

  // 1 人だけ残った → 全ポット獲得（ボード評価なし）
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    let rake = 0;
    if (rakePercent > 0) {
      // bomb pot は bigBlind=0 / ante=N で表現しているため、レーキ cap には ante を使う
      rake = calculateRake(newState.pot, newState.ante, rakePercent, rakeCapBB);
    }
    newState.rake = rake;
    const winAmount = newState.pot - rake;
    winner.chips += winAmount;
    newState.winners = [{ playerId: winner.id, amount: winAmount, handName: '' }];
    return newState;
  }

  // 両ボードを 5 枚にランアウト
  while (boardNeedsMore(newState)) {
    dealOneToEachBoard(newState);
  }

  // === ポット分配の構築 ===
  // アンテは totalBetThisRound に記録していないため、calculateSidePots は
  // ポストフロップで bet/raise した分のサイドポットだけを返す。
  // pot - サイドポット合計 = アンテで集まった分 (= 全 active 対象の主ポット)。
  const postflopSidePots = calculateSidePots(newState.players);
  const contestedPostflopPots = postflopSidePots.filter(p => p.eligiblePlayers.length >= 2);
  const uncontestedPostflopPots = postflopSidePots.filter(p => p.eligiblePlayers.length === 1);

  // post-flop で uncontested になった分（自分一人しか出していない bet）は本人に返却
  for (const pot of uncontestedPostflopPots) {
    const player = newState.players.find(p => p.id === pot.eligiblePlayers[0])!;
    player.chips += pot.amount;
    newState.pot -= pot.amount;
  }

  // pot からポストフロップ contested 分を引いた残りがアンテ主ポット
  const postflopContestedTotal = contestedPostflopPots.reduce((sum, p) => sum + p.amount, 0);
  const antePot = newState.pot - postflopContestedTotal;

  // 分配対象ポット = [アンテ主ポット (全 active 対象), ...各 post-flop contested ポット]
  const contestedPots: { amount: number; eligiblePlayers: number[] }[] = [];
  if (antePot > 0) {
    contestedPots.push({ amount: antePot, eligiblePlayers: activePlayers.map(p => p.id) });
  }
  contestedPots.push(...contestedPostflopPots);

  // レーキ（contested 合計から差し引き）
  const totalContested = contestedPots.reduce((sum, p) => sum + p.amount, 0);
  let rake = 0;
  if (rakePercent > 0 && totalContested > 0) {
    rake = calculateRake(totalContested, newState.ante, rakePercent, rakeCapBB);
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

  // === 各ボードについて、各プレイヤーのハンドを評価 ===
  const handByBoard: Map<number, ReturnType<typeof evaluatePLOHand>>[] = [];
  for (let b = 0; b < BOARD_COUNT; b++) {
    const map = new Map<number, ReturnType<typeof evaluatePLOHand>>();
    for (const player of activePlayers) {
      map.set(player.id, evaluatePLOHand(player.holeCards, newState.boards![b]));
    }
    handByBoard.push(map);
  }

  // === 各 sidepot を 2 ボードに半分割し、ボード毎に勝者決定 ===
  newState.winners = [];
  const chipUnit = newState.chipUnit ?? 1;

  for (const pot of contestedPots) {
    // ボード半分割: 端数 (chipUnit 未満) はボード 1 へ寄せる
    const boardAmounts = splitChipsEvenly(pot.amount, BOARD_COUNT, chipUnit);

    for (let b = 0; b < BOARD_COUNT; b++) {
      const boardPotAmount = boardAmounts[b];
      if (boardPotAmount === 0) continue;

      const eligibleHands = pot.eligiblePlayers
        .filter(id => handByBoard[b].has(id))
        .map(id => ({ playerId: id, hand: handByBoard[b].get(id)! }));

      if (eligibleHands.length === 0) continue;

      eligibleHands.sort((a, b2) => compareHands(b2.hand, a.hand));
      const top = [eligibleHands[0]];
      for (let i = 1; i < eligibleHands.length; i++) {
        if (compareHands(eligibleHands[i].hand, eligibleHands[0].hand) === 0) {
          top.push(eligibleHands[i]);
        } else {
          break;
        }
      }

      // 各勝者へ分配 (端数は最初の勝者へ寄せる)
      const shares = splitChipsEvenly(boardPotAmount, top.length, chipUnit);

      for (let i = 0; i < top.length; i++) {
        const amt = shares[i];
        const player = newState.players.find(p => p.id === top[i].playerId)!;
        player.chips += amt;
        newState.winners.push({
          playerId: top[i].playerId,
          amount: amt,
          handName: `Board ${b + 1}: ${formatHandName(top[i].hand)}`,
        });
      }
    }
  }

  return newState;
}

// ===== 内部ヘルパー =====

function getActivePlayerCount(state: GameState): number {
  return state.players.filter(p => !p.isSittingOut && !p.folded).length;
}

function getNextPlayerWithChips(state: GameState, fromIndex: number): number {
  let index = (fromIndex + 1) % 6;
  for (let c = 0; c < 6; c++) {
    if (!state.players[index].isSittingOut && !state.players[index].folded) {
      return index;
    }
    index = (index + 1) % 6;
  }
  return -1;
}

/**
 * ポストフロップで最初に行動するプレイヤーを返す
 * SB（dealer+1）から時計回りで、folded/all-in でない最初のプレイヤー
 */
function findFirstActorPostFlop(state: GameState): number {
  const sbIndex = (state.dealerPosition + 1) % 6;
  for (let i = 0; i < 6; i++) {
    const idx = (sbIndex + i) % 6;
    const p = state.players[idx];
    if (!p.isSittingOut && !p.folded && !p.isAllIn) {
      return idx;
    }
  }
  return -1;
}
