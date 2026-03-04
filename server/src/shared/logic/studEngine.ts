import { GameState, Player, Position, Action, Card, Suit, Street, getUpCards } from './types.js';
import { createDeck, shuffleDeck, dealCards, getRankValue } from './deck.js';
import { evaluateStudHand, evaluateShowingHand, compareHands } from './handEvaluator.js';
import { getActivePlayers, getPlayersWhoCanAct, calculateSidePots, calculateRake } from './gameEngine.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
const MAX_PLAYERS = 6;

// スートの強さ（ブリングイン判定用: ♣ < ♦ < ♥ < ♠）
const SUIT_VALUE: Record<Suit, number> = { c: 1, d: 2, h: 3, s: 4 };

// =========================================================================
//  State Creation
// =========================================================================

export function createStudGameState(playerChips: number, ante: number, smallBet: number): GameState {
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
    currentStreet: 'third',
    dealerPosition: 0,
    currentPlayerIndex: 0,
    currentBet: 0,
    minRaise: smallBet,
    smallBlind: smallBet,       // Stud: small bet 額
    bigBlind: smallBet * 2,     // Stud: big bet 額
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: false,
    winners: [],
    rake: 0,
    variant: 'stud',
    ante,
    bringIn: Math.ceil(ante / 2) || 1, // ブリングイン = アンテの半額（切り上げ）
    betCount: 0,
    maxBetsPerRound: 4,
  };
}

// =========================================================================
//  Start New Hand
// =========================================================================

export function startStudHand(state: GameState): GameState {
  const newState = { ...state };

  // ハンド状態リセット
  newState.communityCards = [];
  newState.pot = 0;
  newState.sidePots = [];
  newState.currentStreet = 'third';
  newState.handHistory = [];
  newState.isHandComplete = false;
  newState.winners = [];
  newState.rake = 0;
  newState.lastRaiserIndex = -1;
  newState.lastFullRaiseBet = 0;
  newState.betCount = 0;

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

  // === アンテ徴収 ===
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = newState.players[i];
    if (p.isSittingOut) continue;
    const anteAmount = Math.min(newState.ante, p.chips);
    p.chips -= anteAmount;
    p.totalBetThisRound += anteAmount;
    newState.pot += anteAmount;
    if (p.chips === 0) p.isAllIn = true;
  }

  // === カード配布: 裏2枚 + 表1枚（ドアカード）配布順で格納 ===
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (newState.players[i].isSittingOut) continue;
    // 裏カード2枚
    const down = dealCards(newState.deck, 2);
    newState.deck = down.remainingDeck;
    // 表カード1枚（ドアカード）
    const up = dealCards(newState.deck, 1);
    newState.deck = up.remainingDeck;
    // 配布順: [down, down, up]
    newState.players[i].holeCards = [
      ...down.cards.map(c => ({ ...c, isUp: false })),
      ...up.cards.map(c => ({ ...c, isUp: true })),
    ];
  }

  // === ブリングイン: 最低ドアカードのプレイヤー ===
  const bringInPlayer = findLowestDoorCard(newState);
  if (bringInPlayer === -1) return newState;

  const bringInAmount = Math.min(newState.bringIn, newState.players[bringInPlayer].chips);
  newState.players[bringInPlayer].chips -= bringInAmount;
  newState.players[bringInPlayer].currentBet = bringInAmount;
  newState.players[bringInPlayer].totalBetThisRound += bringInAmount;
  newState.pot += bringInAmount;
  newState.currentBet = bringInAmount;
  if (newState.players[bringInPlayer].chips === 0) {
    newState.players[bringInPlayer].isAllIn = true;
  }
  // ブリングインプレイヤーはアクション済みだが、コンプリート/レイズへの再アクション権あり
  newState.players[bringInPlayer].hasActed = true;

  // ブリングインの次のプレイヤーからアクション開始
  newState.currentPlayerIndex = getNextActivePlayer(newState, bringInPlayer);
  newState.lastRaiserIndex = bringInPlayer;

  if (newState.currentPlayerIndex === -1) {
    // 全員オールイン → ランアウト
    return studRunOut(newState);
  }

  return newState;
}

// =========================================================================
//  Valid Actions (Fixed Limit)
// =========================================================================

export function getStudValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  const player = state.players[playerIndex];
  const actions: { action: Action; minAmount: number; maxAmount: number }[] = [];

  if (player.folded || player.isAllIn) return actions;

  const toCall = state.currentBet - player.currentBet;
  const betSize = getCurrentBetSize(state);

  // フォールド
  actions.push({ action: 'fold', minAmount: 0, maxAmount: 0 });

  if (toCall === 0) {
    // チェック
    actions.push({ action: 'check', minAmount: 0, maxAmount: 0 });
  } else {
    // コール
    const callAmount = Math.min(toCall, player.chips);
    actions.push({ action: 'call', minAmount: callAmount, maxAmount: callAmount });
  }

  // ベット/レイズ（Fixed Limit: 固定額、最大4ベット/ストリート）
  const canRaise = state.betCount < state.maxBetsPerRound;

  // 3rd streetのブリングイン後のコンプリート
  const isBringInOnly = state.currentStreet === 'third' && state.betCount === 0 && state.currentBet === state.bringIn;

  if (canRaise && player.chips > toCall) {
    if (state.currentBet === 0 || isBringInOnly) {
      // ベット（またはコンプリート）
      const betAmount = betSize - player.currentBet;
      if (player.chips >= betAmount) {
        actions.push({ action: 'bet', minAmount: betAmount, maxAmount: betAmount });
      } else if (player.chips > toCall) {
        // チップ不足 → オールイン
        actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
      }
    } else {
      // レイズ（固定額の上乗せ）
      const raiseTotal = state.currentBet + betSize;
      const raiseAmount = raiseTotal - player.currentBet;
      if (player.chips >= raiseAmount) {
        actions.push({ action: 'raise', minAmount: raiseAmount, maxAmount: raiseAmount });
      } else if (player.chips > toCall) {
        // チップ不足 → オールイン
        actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
      }
    }
  } else if (player.chips > 0 && player.chips <= toCall) {
    // コールすらできないがチップがある → オールイン
    // (既に call で対応済みだが、chips < toCall の場合を補完)
  }

  return actions;
}

/** 現在のストリートのベットサイズ（small bet or big bet） */
function getCurrentBetSize(state: GameState): number {
  // 3rd/4th street = small bet, 5th/6th/7th = big bet
  if (state.currentStreet === 'third' || state.currentStreet === 'fourth') {
    return state.smallBlind; // smallBlind = small bet
  }
  return state.bigBlind; // bigBlind = big bet
}

// =========================================================================
//  Apply Action
// =========================================================================

export function applyStudAction(
  state: GameState, playerIndex: number, action: Action, amount: number = 0,
  rakePercent: number = 0, rakeCapBB: number = 0
): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  const player = newState.players[playerIndex];
  player.hasActed = true;

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
      // ベットまたはコンプリート
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
      // 他のプレイヤーに再アクション権
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
  const nextResult = determineStudNextAction(newState);
  if (nextResult.moveToNextStreet) {
    return moveToNextStudStreet(newState, rakePercent, rakeCapBB);
  } else if (nextResult.nextPlayerIndex !== -1) {
    newState.currentPlayerIndex = nextResult.nextPlayerIndex;
  } else {
    return determineStudWinner(newState, rakePercent, rakeCapBB);
  }

  return newState;
}

export function wouldStudAdvanceStreet(state: GameState, playerIndex: number, action: Action, amount: number = 0): boolean {
  const resultState = applyStudAction(state, playerIndex, action, amount);
  return resultState.currentStreet !== state.currentStreet;
}

// =========================================================================
//  Next Action / Street Progression
// =========================================================================

function determineStudNextAction(state: GameState): { nextPlayerIndex: number; moveToNextStreet: boolean } {
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

function moveToNextStudStreet(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;

  // ストリート間のリセット
  for (const p of newState.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }
  newState.currentBet = 0;
  newState.lastFullRaiseBet = 0;
  newState.betCount = 0;

  const activePlayers = getActivePlayers(newState);
  if (activePlayers.length === 1) {
    return determineStudWinner(newState, rakePercent, rakeCapBB);
  }

  const nextStreet = getNextStudStreet(newState.currentStreet);
  if (nextStreet === 'showdown') {
    newState.currentStreet = 'showdown';
    return determineStudWinner(newState, rakePercent, rakeCapBB);
  }

  newState.currentStreet = nextStreet;
  newState.minRaise = getCurrentBetSize(newState);

  // === カード配布 ===
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = newState.players[i];
    if (p.isSittingOut || p.folded) continue;

    const { cards, remainingDeck } = dealCards(newState.deck, 1);
    newState.deck = remainingDeck;

    // 4th-6th street: 表カード, 7th street: 裏カード
    const isUp = nextStreet !== 'seventh';
    p.holeCards.push(...cards.map(c => ({ ...c, isUp })));
  }

  // === アクション順序: 最高ショウイングハンドのプレイヤー ===
  const firstActor = findBestShowingHand(newState);
  if (firstActor === -1) {
    // 全員オールイン → ランアウト
    return studRunOut(newState, rakePercent, rakeCapBB);
  }

  const canActPlayers = activePlayers.filter(p => !p.isAllIn);
  if (canActPlayers.length <= 1) {
    return studRunOut(newState, rakePercent, rakeCapBB);
  }

  newState.currentPlayerIndex = firstActor;
  return newState;
}

function getNextStudStreet(current: Street): Street {
  const order: Record<string, Street> = {
    third: 'fourth',
    fourth: 'fifth',
    fifth: 'sixth',
    sixth: 'seventh',
    seventh: 'showdown',
  };
  return order[current] || 'showdown';
}

// =========================================================================
//  Winner Determination
// =========================================================================

export function determineStudWinner(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
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
    if (originalStreet !== 'third' && rakePercent > 0) {
      rake = calculateRake(newState.pot, newState.bigBlind, rakePercent, rakeCapBB);
    }
    newState.rake = rake;
    const winAmount = newState.pot - rake;
    winner.chips += winAmount;
    newState.winners = [{ playerId: winner.id, amount: winAmount, handName: '' }];
    return newState;
  }

  // 残りのカードを配る（7枚未満の場合）
  studDealRemaining(newState);

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

  // === Studハンド評価: 全7枚から最強5枚 ===
  const playerHandMap = new Map<number, ReturnType<typeof evaluateStudHand>>();
  for (const player of activePlayers) {
    playerHandMap.set(player.id, evaluateStudHand(player.holeCards));
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
//  Stud Run-out (全員オールイン時、残りカードを配る)
// =========================================================================

function studRunOut(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  newState.currentStreet = 'showdown';
  // studDealRemaining は determineStudWinner 内で呼ばれるため、ここでは不要
  return determineStudWinner(newState, rakePercent, rakeCapBB);
}

/** アクティブプレイヤーに7枚になるまでカードを配る */
function studDealRemaining(state: GameState): void {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[i];
    if (p.isSittingOut || p.folded) continue;

    if (p.holeCards.length >= 7) continue;

    // 表カードは最大4枚まで（6枚目まで）
    while (getUpCards(p.holeCards).length < 4 && p.holeCards.length < 6 && state.deck.length > 0) {
      const { cards, remainingDeck } = dealCards(state.deck, 1);
      p.holeCards.push(...cards.map(c => ({ ...c, isUp: true })));
      state.deck = remainingDeck;
    }
    // 7枚目は裏カード
    if (p.holeCards.length < 7 && state.deck.length > 0) {
      const { cards, remainingDeck } = dealCards(state.deck, 1);
      p.holeCards.push(...cards.map(c => ({ ...c, isUp: false })));
      state.deck = remainingDeck;
    }
  }
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

/** 最低ドアカード（表カード1枚目）のプレイヤーを見つける */
function findLowestDoorCard(state: GameState): number {
  let lowestIndex = -1;
  let lowestRank = Infinity;
  let lowestSuit = Infinity;

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[i];
    const upCards = getUpCards(p.holeCards);
    if (p.isSittingOut || p.folded || upCards.length === 0) continue;

    const doorCard = upCards[0];
    const rankVal = getRankValue(doorCard.rank);
    const suitVal = SUIT_VALUE[doorCard.suit];

    // 低いランクが優先、同ランクなら低いスート（♣が最低）
    if (rankVal < lowestRank || (rankVal === lowestRank && suitVal < lowestSuit)) {
      lowestRank = rankVal;
      lowestSuit = suitVal;
      lowestIndex = i;
    }
  }

  return lowestIndex;
}

/** 最高ショウイングハンド（表カード全体）のプレイヤーを見つける */
function findBestShowingHand(state: GameState): number {
  let bestIndex = -1;
  let bestHand = { rank: 0, name: '', highCards: [] as number[] };

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[i];
    if (p.isSittingOut || p.folded || p.isAllIn) continue;

    const hand = evaluateShowingHand(getUpCards(p.holeCards));
    if (compareHands(hand, bestHand) > 0) {
      bestHand = hand;
      bestIndex = i;
    }
  }

  return bestIndex;
}
