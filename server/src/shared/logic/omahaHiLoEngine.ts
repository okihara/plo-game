// Omaha Hi-Lo (8-or-Better) エンジン
// Fixed Limit: preflop/flop = small bet, turn/river = big bet
// ホールカード4枚、コミュニティカード5枚
// ショーダウン: ハイ/ローでポットをスプリット（8-or-betterクオリファイ）

import { GameState, Player, Position, Action, Street } from './types.js';
import { createDeck, shuffleDeck, dealCards } from './deck.js';
import {
  getActivePlayers,
  getPlayersWhoCanAct,
  calculateSidePots,
  calculateRake,
  assignBlindPostingPositions,
} from './gameEngine.js';
import { evaluateOmahaHiLoHand } from './handEvaluator.js';
import { resolveHiLoShowdown, HiLoPotWinner } from './hiLoSplitPot.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
const MAX_PLAYERS = 6;
const MAX_BETS_PER_ROUND = 4;

// =========================================================================
//  Helpers
// =========================================================================

function getCurrentBetSize(state: GameState): number {
  if (state.currentStreet === 'preflop' || state.currentStreet === 'flop') {
    return state.smallBlind;
  }
  return state.bigBlind;
}

function getNextActivePlayer(state: GameState, fromIndex: number): number {
  let index = (fromIndex + 1) % MAX_PLAYERS;
  for (let count = 0; count < MAX_PLAYERS; count++) {
    if (!state.players[index].isSittingOut && !state.players[index].folded && !state.players[index].isAllIn) {
      return index;
    }
    index = (index + 1) % MAX_PLAYERS;
  }
  return -1;
}

function getActivePlayerCount(state: GameState): number {
  return state.players.filter(p => !p.isSittingOut && !p.folded).length;
}

function getNextPlayerWithChips(state: GameState, fromIndex: number): number {
  let index = (fromIndex + 1) % MAX_PLAYERS;
  for (let count = 0; count < MAX_PLAYERS; count++) {
    if (!state.players[index].isSittingOut && !state.players[index].folded) {
      return index;
    }
    index = (index + 1) % MAX_PLAYERS;
  }
  return -1;
}

// =========================================================================
//  State Creation
// =========================================================================

export function createOmahaHiLoGameState(playerChips: number, smallBet: number, bigBet: number): GameState {
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
    currentStreet: 'preflop',
    dealerPosition: 0,
    currentPlayerIndex: 0,
    currentBet: 0,
    minRaise: smallBet,
    smallBlind: smallBet,
    bigBlind: bigBet,
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: false,
    winners: [],
    rake: 0,
    variant: 'omaha_hilo',
    ante: 0,
    bringIn: 0,
    betCount: 0,
    maxBetsPerRound: MAX_BETS_PER_ROUND,
  };
}

// =========================================================================
//  Hand Start
// =========================================================================

export function startOmahaHiLoHand(state: GameState): GameState {
  const newState = { ...state };
  const sb = newState.smallBlind;

  // リセット
  newState.communityCards = [];
  newState.pot = 0;
  newState.sidePots = [];
  newState.currentStreet = 'preflop';
  newState.currentBet = sb;
  newState.minRaise = sb;
  newState.handHistory = [];
  newState.isHandComplete = false;
  newState.winners = [];
  newState.rake = 0;
  newState.lastRaiserIndex = -1;
  newState.lastFullRaiseBet = 0;
  newState.betCount = 1;

  // プレイヤーリセット
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
  const nextDealer = getNextPlayerWithChips(newState, newState.dealerPosition);
  if (nextDealer !== -1) {
    newState.dealerPosition = nextDealer;
  }

  const activeCount = getActivePlayerCount(newState);

  // ブラインド位置決定
  let sbIndex: number;
  let bbIndex: number;

  if (activeCount === 2) {
    sbIndex = getNextPlayerWithChips(newState, newState.dealerPosition - 1);
    if (sbIndex === -1) sbIndex = newState.dealerPosition;
    bbIndex = getNextPlayerWithChips(newState, sbIndex);
  } else {
    sbIndex = getNextPlayerWithChips(newState, newState.dealerPosition);
    bbIndex = getNextPlayerWithChips(newState, sbIndex);
  }

  assignBlindPostingPositions(newState, newState.dealerPosition, sbIndex, bbIndex, activeCount, MAX_PLAYERS);

  // SBポスト
  const sbAmount = Math.floor(sb / 2);
  newState.players[sbIndex].currentBet = Math.min(sbAmount, newState.players[sbIndex].chips);
  newState.players[sbIndex].totalBetThisRound = newState.players[sbIndex].currentBet;
  newState.players[sbIndex].chips -= newState.players[sbIndex].currentBet;
  if (newState.players[sbIndex].chips === 0) newState.players[sbIndex].isAllIn = true;

  // BBポスト
  newState.players[bbIndex].currentBet = Math.min(sb, newState.players[bbIndex].chips);
  newState.players[bbIndex].totalBetThisRound = newState.players[bbIndex].currentBet;
  newState.players[bbIndex].chips -= newState.players[bbIndex].currentBet;
  if (newState.players[bbIndex].chips === 0) newState.players[bbIndex].isAllIn = true;

  newState.pot = newState.players[sbIndex].currentBet + newState.players[bbIndex].currentBet;
  newState.currentBet = newState.players[bbIndex].currentBet;
  newState.lastFullRaiseBet = newState.currentBet;

  // ホールカード配布 (4枚 — Omahaと同じ)
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (newState.players[i].isSittingOut) continue;
    const { cards, remainingDeck } = dealCards(newState.deck, 4);
    newState.players[i].holeCards = cards;
    newState.deck = remainingDeck;
  }

  // アクション開始位置
  if (activeCount === 2) {
    newState.currentPlayerIndex = sbIndex;
  } else {
    newState.currentPlayerIndex = getNextActivePlayer(newState, bbIndex);
  }
  newState.lastRaiserIndex = bbIndex;

  if (newState.currentPlayerIndex === -1) {
    return runOutBoard(newState);
  }

  return newState;
}

// =========================================================================
//  Valid Actions (同じFixed Limit構造)
// =========================================================================

export function getOmahaHiLoValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  const player = state.players[playerIndex];
  const actions: { action: Action; minAmount: number; maxAmount: number }[] = [];

  if (player.folded || player.isAllIn) return actions;

  const toCall = state.currentBet - player.currentBet;
  const betSize = getCurrentBetSize(state);
  const betsUsed = state.betCount;
  const canRaiseMore = betsUsed < (state.maxBetsPerRound || MAX_BETS_PER_ROUND);

  actions.push({ action: 'fold', minAmount: 0, maxAmount: 0 });

  if (toCall === 0) {
    actions.push({ action: 'check', minAmount: 0, maxAmount: 0 });
    if (canRaiseMore && player.chips > 0) {
      const betAmount = Math.min(betSize, player.chips);
      if (player.chips <= betSize) {
        actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
      } else {
        actions.push({ action: 'bet', minAmount: betAmount, maxAmount: betAmount });
      }
    }
  } else {
    const callAmount = Math.min(toCall, player.chips);
    actions.push({ action: 'call', minAmount: callAmount, maxAmount: callAmount });
    if (canRaiseMore && player.chips > toCall) {
      const raiseAmount = toCall + betSize;
      if (player.chips <= raiseAmount) {
        actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
      } else {
        actions.push({ action: 'raise', minAmount: raiseAmount, maxAmount: raiseAmount });
      }
    }
  }

  return actions;
}

// =========================================================================
//  Apply Action
// =========================================================================

export function applyOmahaHiLoAction(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number = 0,
  rakePercent: number = 0,
  rakeCapBB: number = 0,
): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
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

    case 'bet': {
      player.chips -= amount;
      player.currentBet += amount;
      player.totalBetThisRound += amount;
      newState.pot += amount;
      newState.currentBet = player.currentBet;
      newState.lastRaiserIndex = playerIndex;
      newState.lastFullRaiseBet = newState.currentBet;
      newState.betCount++;
      if (player.chips === 0) player.isAllIn = true;
      for (const p of newState.players) {
        if (p.id !== player.id && !p.folded && !p.isAllIn) p.hasActed = false;
      }
      break;
    }

    case 'raise': {
      player.chips -= amount;
      player.currentBet += amount;
      player.totalBetThisRound += amount;
      newState.pot += amount;
      newState.currentBet = player.currentBet;
      newState.lastRaiserIndex = playerIndex;
      newState.lastFullRaiseBet = newState.currentBet;
      newState.betCount++;
      if (player.chips === 0) player.isAllIn = true;
      for (const p of newState.players) {
        if (p.id !== player.id && !p.folded && !p.isAllIn) p.hasActed = false;
      }
      break;
    }

    case 'allin': {
      const allInAmount = player.chips;
      if (player.currentBet + allInAmount > newState.currentBet) {
        const raiseBy = (player.currentBet + allInAmount) - newState.currentBet;
        const betSize = getCurrentBetSize(newState);
        const isFullRaise = raiseBy >= betSize;
        if (isFullRaise) {
          newState.lastRaiserIndex = playerIndex;
          newState.betCount++;
          for (const p of newState.players) {
            if (p.id !== player.id && !p.folded && !p.isAllIn) p.hasActed = false;
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

  const nextResult = determineNextAction(newState);
  if (nextResult.moveToNextStreet) {
    return moveToNextStreet(newState, rakePercent, rakeCapBB);
  } else if (nextResult.nextPlayerIndex !== -1) {
    newState.currentPlayerIndex = nextResult.nextPlayerIndex;
  } else {
    return determineOmahaHiLoWinner(newState, rakePercent, rakeCapBB);
  }

  return newState;
}

// =========================================================================
//  Next Action Determination
// =========================================================================

function determineNextAction(state: GameState): { nextPlayerIndex: number; moveToNextStreet: boolean } {
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

  let index = (state.currentPlayerIndex + 1) % MAX_PLAYERS;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[index];
    if (!p.folded && !p.isAllIn && (!p.hasActed || p.currentBet < state.currentBet)) {
      return { nextPlayerIndex: index, moveToNextStreet: false };
    }
    index = (index + 1) % MAX_PLAYERS;
  }

  return { nextPlayerIndex: -1, moveToNextStreet: true };
}

// =========================================================================
//  Street Progression
// =========================================================================

function moveToNextStreet(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;

  for (const p of newState.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }
  newState.currentBet = 0;
  newState.minRaise = getCurrentBetSize(newState);
  newState.lastFullRaiseBet = 0;
  newState.betCount = 0;

  const activePlayers = getActivePlayers(newState);
  if (activePlayers.length === 1) {
    return determineOmahaHiLoWinner(newState, rakePercent, rakeCapBB);
  }

  switch (newState.currentStreet) {
    case 'preflop': {
      newState.currentStreet = 'flop';
      const { cards, remainingDeck } = dealCards(newState.deck, 3);
      newState.communityCards = cards;
      newState.deck = remainingDeck;
      newState.minRaise = newState.smallBlind;
      break;
    }
    case 'flop': {
      newState.currentStreet = 'turn';
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
      newState.minRaise = newState.bigBlind;
      break;
    }
    case 'turn': {
      newState.currentStreet = 'river';
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
      newState.minRaise = newState.bigBlind;
      break;
    }
    case 'river': {
      newState.currentStreet = 'showdown';
      return determineOmahaHiLoWinner(newState, rakePercent, rakeCapBB);
    }
  }

  const sbIndex = (newState.dealerPosition + 1) % MAX_PLAYERS;
  let firstActorIndex = -1;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const idx = (sbIndex + i) % MAX_PLAYERS;
    if (!newState.players[idx].folded && !newState.players[idx].isAllIn) {
      firstActorIndex = idx;
      break;
    }
  }

  const canActPlayers = activePlayers.filter(p => !p.isAllIn);
  if (canActPlayers.length <= 1) {
    return runOutBoard(newState, rakePercent, rakeCapBB);
  }

  newState.currentPlayerIndex = firstActorIndex;
  return newState;
}

function runOutBoard(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;

  while (newState.communityCards.length < 5 && newState.deck.length > 0) {
    const { cards, remainingDeck } = dealCards(newState.deck, 1);
    newState.communityCards.push(...cards);
    newState.deck = remainingDeck;
  }

  newState.currentStreet = 'showdown';
  return determineOmahaHiLoWinner(newState, rakePercent, rakeCapBB);
}

// =========================================================================
//  Winner Determination (Hi-Lo Split)
// =========================================================================

export function determineOmahaHiLoWinner(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
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

  // 1人残り → 無条件勝利
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    let rake = 0;
    if (originalStreet !== 'preflop' && rakePercent > 0) {
      rake = calculateRake(newState.pot, newState.bigBlind, rakePercent, rakeCapBB);
    }
    newState.rake = rake;
    const winAmount = newState.pot - rake;
    winner.chips += winAmount;
    newState.winners = [{ playerId: winner.id, amount: winAmount, handName: '' }];
    return newState;
  }

  // コミュニティカードが5枚揃っていない場合はランアウト
  if (newState.communityCards.length < 5) {
    while (newState.communityCards.length < 5 && newState.deck.length > 0) {
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
    }
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

  // Hi-Lo ショーダウン
  const showdownPlayers = activePlayers.map(p => ({ id: p.id, holeCards: p.holeCards }));
  const communityCards = newState.communityCards;

  const potWinners: HiLoPotWinner[] = resolveHiLoShowdown(
    showdownPlayers,
    contestedPots,
    (player) => evaluateOmahaHiLoHand(player.holeCards, communityCards),
  );

  newState.winners = [];
  for (const pw of potWinners) {
    const player = newState.players.find(p => p.id === pw.playerId)!;
    player.chips += pw.amount;
    newState.winners.push({
      playerId: pw.playerId,
      amount: pw.amount,
      handName: pw.handName,
      hiLoType: pw.hiLoType,
    });
  }

  return newState;
}

// =========================================================================
//  Utility Exports
// =========================================================================

export function wouldOmahaHiLoAdvanceStreet(state: GameState, playerIndex: number, action: Action, amount: number = 0): boolean {
  const resultState = applyOmahaHiLoAction(state, playerIndex, action, amount);
  return resultState.currentStreet !== state.currentStreet;
}
