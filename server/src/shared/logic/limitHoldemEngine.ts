// Limit Hold'em エンジン
// Fixed Limit: preflop/flop = small bet, turn/river = big bet
// ホールカード2枚、コミュニティカード5枚、ベストハンドは7枚から最強5枚

import { GameState, Player, Position, Action, Street } from './types.js';
import { createDeck, shuffleDeck, dealCards } from './deck.js';
import {
  getActivePlayers,
  getPlayersWhoCanAct,
  calculateSidePots,
  calculateRake,
  assignBlindPostingPositions,
} from './gameEngine.js';
import { evaluateHoldemHand, compareHands, formatHandName } from './handEvaluator.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
const MAX_PLAYERS = 6;
const MAX_BETS_PER_ROUND = 4; // bet + 3 raises

// =========================================================================
//  Helpers
// =========================================================================

/** 現在のストリートのベットサイズ (small bet or big bet) */
function getCurrentBetSize(state: GameState): number {
  // preflop & flop = small bet (= smallBlind), turn & river = big bet (= bigBlind)
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

export function createLimitHoldemGameState(playerChips: number, smallBet: number, bigBet: number): GameState {
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
    variant: 'limit_holdem',
    ante: 0,
    bringIn: 0,
    betCount: 0,
    maxBetsPerRound: MAX_BETS_PER_ROUND,
  };
}

// =========================================================================
//  Hand Start
// =========================================================================

export function startLimitHoldemHand(state: GameState): GameState {
  const newState = { ...state };
  const sb = newState.smallBlind;
  const bb = newState.bigBlind;

  // リセット
  newState.communityCards = [];
  newState.pot = 0;
  newState.sidePots = [];
  newState.currentStreet = 'preflop';
  newState.currentBet = sb; // preflop は SB がベッティング単位
  newState.minRaise = sb;
  newState.handHistory = [];
  newState.isHandComplete = false;
  newState.winners = [];
  newState.rake = 0;
  newState.lastRaiserIndex = -1;
  newState.lastFullRaiseBet = 0;
  newState.betCount = 1; // BBの投稿を1ベットとカウント

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

  // SBポスト (= small bet / 2)
  const sbAmount = Math.floor(sb / 2);
  newState.players[sbIndex].currentBet = Math.min(sbAmount, newState.players[sbIndex].chips);
  newState.players[sbIndex].totalBetThisRound = newState.players[sbIndex].currentBet;
  newState.players[sbIndex].chips -= newState.players[sbIndex].currentBet;
  if (newState.players[sbIndex].chips === 0) newState.players[sbIndex].isAllIn = true;

  // BBポスト (= small bet)
  newState.players[bbIndex].currentBet = Math.min(sb, newState.players[bbIndex].chips);
  newState.players[bbIndex].totalBetThisRound = newState.players[bbIndex].currentBet;
  newState.players[bbIndex].chips -= newState.players[bbIndex].currentBet;
  if (newState.players[bbIndex].chips === 0) newState.players[bbIndex].isAllIn = true;

  newState.pot = newState.players[sbIndex].currentBet + newState.players[bbIndex].currentBet;
  newState.currentBet = newState.players[bbIndex].currentBet;
  newState.lastFullRaiseBet = newState.currentBet;

  // ホールカード配布 (2枚)
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (newState.players[i].isSittingOut) continue;
    const { cards, remainingDeck } = dealCards(newState.deck, 2);
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
//  Valid Actions
// =========================================================================

export function getLimitHoldemValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  const player = state.players[playerIndex];
  const actions: { action: Action; minAmount: number; maxAmount: number }[] = [];

  if (player.folded || player.isAllIn) return actions;

  const toCall = state.currentBet - player.currentBet;
  const betSize = getCurrentBetSize(state);
  const betsUsed = state.betCount;
  const canRaiseMore = betsUsed < (state.maxBetsPerRound || MAX_BETS_PER_ROUND);

  // フォールド
  actions.push({ action: 'fold', minAmount: 0, maxAmount: 0 });

  if (toCall === 0) {
    // チェック
    actions.push({ action: 'check', minAmount: 0, maxAmount: 0 });

    // ベット（まだベットカウント上限に達していない場合）
    if (canRaiseMore && player.chips > 0) {
      const betAmount = Math.min(betSize, player.chips);
      if (player.chips <= betSize) {
        actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
      } else {
        actions.push({ action: 'bet', minAmount: betAmount, maxAmount: betAmount });
      }
    }
  } else {
    // コール
    const callAmount = Math.min(toCall, player.chips);
    actions.push({ action: 'call', minAmount: callAmount, maxAmount: callAmount });

    // レイズ（固定額）
    if (canRaiseMore && player.chips > toCall) {
      const raiseAmount = toCall + betSize;
      if (player.chips <= raiseAmount) {
        actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
      } else {
        actions.push({ action: 'raise', minAmount: raiseAmount, maxAmount: raiseAmount });
      }
    } else if (player.chips <= toCall) {
      // コールするとオールイン
      // call で既にカバーしている
    }
  }

  return actions;
}

// =========================================================================
//  Apply Action
// =========================================================================

export function applyLimitHoldemAction(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number = 0,
  rakePercent: number = 0,
  rakeCapBB: number = 0
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
        if (p.id !== player.id && !p.folded && !p.isAllIn) {
          p.hasActed = false;
        }
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
        const betSize = getCurrentBetSize(newState);
        const isFullRaise = raiseBy >= betSize;
        if (isFullRaise) {
          newState.lastRaiserIndex = playerIndex;
          newState.betCount++;
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

  // アクション履歴
  newState.handHistory.push({ playerId: playerIndex, action, amount, street: state.currentStreet });

  // 次のアクション
  const nextResult = determineNextAction(newState);
  if (nextResult.moveToNextStreet) {
    return moveToNextStreet(newState, rakePercent, rakeCapBB);
  } else if (nextResult.nextPlayerIndex !== -1) {
    newState.currentPlayerIndex = nextResult.nextPlayerIndex;
  } else {
    return determineLimitHoldemWinner(newState, rakePercent, rakeCapBB);
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

  // リセット
  for (const p of newState.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }
  newState.currentBet = 0;
  newState.minRaise = getCurrentBetSize(newState);
  newState.lastFullRaiseBet = 0;
  newState.betCount = 0; // 新しいストリートではベットカウントリセット

  const activePlayers = getActivePlayers(newState);
  if (activePlayers.length === 1) {
    return determineLimitHoldemWinner(newState, rakePercent, rakeCapBB);
  }

  // コミュニティカード配布
  switch (newState.currentStreet) {
    case 'preflop': {
      newState.currentStreet = 'flop';
      const { cards, remainingDeck } = dealCards(newState.deck, 3);
      newState.communityCards = cards;
      newState.deck = remainingDeck;
      // flopからはbig betサイズに切り替わらない（flopはまだsmall bet）
      newState.minRaise = newState.smallBlind;
      break;
    }
    case 'flop': {
      newState.currentStreet = 'turn';
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
      // turnからbig bet
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
      return determineLimitHoldemWinner(newState, rakePercent, rakeCapBB);
    }
  }

  // ポストフロップ: SBから最初のアクティブプレイヤー
  const sbIndex = (newState.dealerPosition + 1) % MAX_PLAYERS;
  let firstActorIndex = -1;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const idx = (sbIndex + i) % MAX_PLAYERS;
    if (!newState.players[idx].folded && !newState.players[idx].isAllIn) {
      firstActorIndex = idx;
      break;
    }
  }

  // アクション可能なプレイヤーが1人以下 → ランアウト
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
  return determineLimitHoldemWinner(newState, rakePercent, rakeCapBB);
}

// =========================================================================
//  Winner Determination
// =========================================================================

export function determineLimitHoldemWinner(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
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

  // Hold'em ハンド評価: 7枚から最強5枚
  const playerHandMap = new Map<number, ReturnType<typeof evaluateHoldemHand>>();
  for (const player of activePlayers) {
    playerHandMap.set(player.id, evaluateHoldemHand(player.holeCards, newState.communityCards));
  }

  // 各ポットの勝者決定
  const winnerAmounts = new Map<number, { amount: number; handName: string }>();

  for (const pot of contestedPots) {
    const eligibleHands = pot.eligiblePlayers
      .filter(id => playerHandMap.has(id))
      .map(id => ({ playerId: id, hand: playerHandMap.get(id)! }));

    if (eligibleHands.length === 0) continue;

    eligibleHands.sort((a, b) => compareHands(b.hand, a.hand));

    const potWinners = [eligibleHands[0]];
    for (let i = 1; i < eligibleHands.length; i++) {
      if (compareHands(eligibleHands[i].hand, eligibleHands[0].hand) === 0) {
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
          handName: formatHandName(potWinners[i].hand),
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
//  Utility Exports
// =========================================================================

export function wouldLimitHoldemAdvanceStreet(state: GameState, playerIndex: number, action: Action, amount: number = 0): boolean {
  const resultState = applyLimitHoldemAction(state, playerIndex, action, amount);
  return resultState.currentStreet !== state.currentStreet;
}
