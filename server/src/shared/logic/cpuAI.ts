import { GameState, Action, Card, Rank, Street, GameAction } from './types.js';
import { getValidActions } from './gameEngine.js';
import { getRankValue } from './deck.js';
import { evaluatePLOHand } from './handEvaluator.js';

// 新AIモジュール
import { AIContext, StreetHistory, BotPersonality } from './ai/types.js';
import { getPersonality, DEFAULT_PERSONALITY } from './ai/personalities.js';
import { analyzeBoard } from './ai/boardAnalysis.js';
import { evaluateHandExtended } from './ai/handStrength.js';
import { getPostflopDecision } from './ai/postflopStrategy.js';
import { getPreflopDecision } from './ai/preflopStrategy.js';

// === エントリポイント ===
// 3番目のパラメータはオプショナルで後方互換を維持
export function getCPUAction(
  state: GameState,
  playerIndex: number,
  context?: AIContext
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const validActions = getValidActions(state, playerIndex);

  if (validActions.length === 0) {
    return { action: 'fold', amount: 0 };
  }

  const positionBonus = getPositionBonus(player.position);

  // AIContext がある場合: 新しいAIモジュールを使用
  if (context) {
    const personality = getPersonality(context.botName);
    const handActions = context.handActions ?? state.handHistory;
    const streetHistory = deriveStreetHistory(state, handActions, playerIndex);

    if (state.currentStreet === 'preflop') {
      return getPreflopDecision(state, playerIndex, personality, positionBonus, context.opponentModel);
    }

    const activePlayers = state.players.filter(p => !p.folded && p.chips > 0).length;
    const numOpponents = activePlayers - 1;
    const boardTexture = analyzeBoard(state.communityCards);
    const handEval = evaluateHandExtended(
      player.holeCards, state.communityCards, state.currentStreet, numOpponents, boardTexture
    );

    return getPostflopDecision(
      state, playerIndex, handEval, boardTexture, streetHistory,
      personality, positionBonus, context.opponentModel
    );
  }

  // context がない場合: 既存のレガシーロジック（後方互換）
  return legacyGetCPUAction(state, playerIndex, positionBonus);
}

// === StreetHistory を handHistory から導出 ===
function deriveStreetHistory(
  state: GameState,
  handActions: GameAction[],
  playerIndex: number
): StreetHistory {
  const history: StreetHistory = {
    preflopAggressor: null,
    flopAggressor: null,
    turnAggressor: null,
    wasRaisedPreflop: false,
    numBetsOnFlop: 0,
    numBetsOnTurn: 0,
  };

  // handHistory からストリート変遷を推定
  // コミュニティカード数からストリートを判定できないため、アクション順で推定
  let currentStreet: Street = 'preflop';
  let actionCount = 0;

  for (const action of handActions) {
    if (action.action === 'raise' || action.action === 'bet' || action.action === 'allin') {
      if (currentStreet === 'preflop') {
        history.preflopAggressor = action.playerId;
        history.wasRaisedPreflop = true;
      } else if (currentStreet === 'flop') {
        history.flopAggressor = action.playerId;
        history.numBetsOnFlop++;
      } else if (currentStreet === 'turn') {
        history.turnAggressor = action.playerId;
        history.numBetsOnTurn++;
      }
    }
  }

  // lastRaiserIndex からプリフロップアグレッサーを補完
  if (state.lastRaiserIndex >= 0 && history.preflopAggressor === null) {
    history.preflopAggressor = state.lastRaiserIndex;
    history.wasRaisedPreflop = true;
  }

  return history;
}

// === レガシーロジック（context なしの場合）===

function legacyGetCPUAction(
  state: GameState,
  playerIndex: number,
  positionBonus: number
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const validActions = getValidActions(state, playerIndex);
  const toCall = state.currentBet - player.currentBet;
  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;

  if (state.currentStreet === 'preflop') {
    return legacyGetPreflopAction(state, playerIndex, validActions, positionBonus);
  }

  const handEval = legacyEvaluatePostFlopHand(player.holeCards, state.communityCards);
  const boardTexture = legacyAnalyzeBoardTexture(state.communityCards);
  const aggression = legacyAnalyzeOpponentAggression(state, playerIndex);

  return legacyGetPostFlopAction(state, playerIndex, validActions, handEval, boardTexture, aggression, potOdds, positionBonus);
}

// --- レガシー: ハンド評価情報 ---
interface LegacyHandEvaluation {
  strength: number;
  madeHandRank: number;
  hasFlushDraw: boolean;
  hasStraightDraw: boolean;
  hasWrapDraw: boolean;
  drawStrength: number;
  isNuts: boolean;
  isNearNuts: boolean;
}

interface LegacyBoardTexture {
  isPaired: boolean;
  isTrips: boolean;
  flushPossible: boolean;
  flushDraw: boolean;
  straightPossible: boolean;
  isConnected: boolean;
  isWet: boolean;
  highCard: number;
}

function legacyGetPreflopAction(
  state: GameState,
  playerIndex: number,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  positionBonus: number
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const handStrength = evaluatePreFlopStrength(player.holeCards);
  const effectiveStrength = Math.min(1, handStrength + positionBonus);
  const toCall = state.currentBet - player.currentBet;
  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
  const random = Math.random();
  const facingRaise = state.currentBet > state.bigBlind;
  const facingBigRaise = toCall > state.pot * 0.5;

  if (effectiveStrength > 0.75) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      const raiseSize = facingRaise ? 3 : 2.5;
      const raiseAmount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(state.pot * raiseSize)));
      if (random > 0.15) return { action: raiseAction.action, amount: raiseAmount };
    }
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
  }

  if (effectiveStrength > 0.55) {
    if (facingBigRaise) {
      if (effectiveStrength > 0.65) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }
    if (!facingRaise && random > 0.4) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction) {
        const raiseAmount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.75)));
        return { action: raiseAction.action, amount: raiseAmount };
      }
    }
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction && potOdds < effectiveStrength * 0.8) return { action: 'call', amount: callAction.minAmount };
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
    if (toCall > 0) return { action: 'fold', amount: 0 };
  }

  if (effectiveStrength > 0.35) {
    if (facingRaise && toCall > state.bigBlind * 3) return { action: 'fold', amount: 0 };
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
    if (potOdds < 0.2 && toCall <= state.bigBlind * 2) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
  }

  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };
  if (!facingRaise && positionBonus >= 0.08 && random > 0.92) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) return { action: raiseAction.action, amount: raiseAction.minAmount };
  }
  return { action: 'fold', amount: 0 };
}

function legacyGetPostFlopAction(
  state: GameState,
  playerIndex: number,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: LegacyHandEvaluation,
  boardTexture: LegacyBoardTexture,
  aggression: number,
  potOdds: number,
  positionBonus: number
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const toCall = state.currentBet - player.currentBet;
  const street = state.currentStreet;
  const spr = player.chips / Math.max(1, state.pot);

  if (handEval.isNuts || (handEval.isNearNuts && handEval.madeHandRank >= 5)) {
    return legacyPlayStrongHand(state, validActions, boardTexture, spr);
  }

  if (handEval.madeHandRank >= 3) {
    if (boardTexture.isPaired && handEval.madeHandRank < 7) {
      if (aggression > 0.7 && toCall > state.pot * 0.5) {
        const checkAction = validActions.find(a => a.action === 'check');
        if (checkAction) return { action: 'check', amount: 0 };
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction && potOdds < 0.35) return { action: 'call', amount: callAction.minAmount };
        return { action: 'fold', amount: 0 };
      }
    }
    if (boardTexture.flushPossible && handEval.madeHandRank < 6) {
      if (aggression > 0.6) {
        const checkAction = validActions.find(a => a.action === 'check');
        if (checkAction) return { action: 'check', amount: 0 };
        if (potOdds > 0.3) return { action: 'fold', amount: 0 };
      }
    }
    return legacyPlayMediumHand(state, validActions, handEval, aggression, potOdds);
  }

  if (handEval.hasFlushDraw || handEval.hasStraightDraw || handEval.hasWrapDraw) {
    return legacyPlayDrawHand(state, validActions, handEval, potOdds, street);
  }

  if (handEval.madeHandRank === 2) {
    if (handEval.strength > 0.4) {
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
      if (potOdds < 0.25) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
    }
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  if (legacyShouldBluff(state, playerIndex, boardTexture, aggression, positionBonus)) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      const bluffSize = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.6)));
      return { action: raiseAction.action, amount: bluffSize };
    }
  }

  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };
  if (potOdds < 0.1 && toCall < player.chips * 0.03) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }
  return { action: 'fold', amount: 0 };
}

function legacyPlayStrongHand(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  boardTexture: LegacyBoardTexture,
  _spr: number
): { action: Action; amount: number } {
  const random = Math.random();
  if (boardTexture.isWet) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      const raiseAmount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(state.pot * (0.75 + random * 0.25))));
      return { action: raiseAction.action, amount: raiseAmount };
    }
  }
  if (!boardTexture.isWet && random > 0.65) {
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }
  const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
  if (raiseAction) {
    const raiseAmount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.7)));
    return { action: raiseAction.action, amount: raiseAmount };
  }
  const callAction = validActions.find(a => a.action === 'call');
  if (callAction) return { action: 'call', amount: callAction.minAmount };
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

function legacyPlayMediumHand(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: LegacyHandEvaluation,
  aggression: number,
  potOdds: number
): { action: Action; amount: number } {
  const random = Math.random();
  const toCall = state.currentBet - state.players[state.currentPlayerIndex].currentBet;
  if (aggression < 0.3) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction && random > 0.3) {
      const raiseAmount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.5)));
      return { action: raiseAction.action, amount: raiseAmount };
    }
  }
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };
  if (potOdds < handEval.strength * 0.6) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }
  if (toCall > state.pot * 0.5 && aggression > 0.5) return { action: 'fold', amount: 0 };
  const callAction = validActions.find(a => a.action === 'call');
  if (callAction) return { action: 'call', amount: callAction.minAmount };
  return { action: 'fold', amount: 0 };
}

function legacyPlayDrawHand(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: LegacyHandEvaluation,
  potOdds: number,
  street: Street
): { action: Action; amount: number } {
  const random = Math.random();
  let drawEquity = handEval.drawStrength;
  if (street === 'turn') drawEquity *= 0.5;
  if (street === 'river') drawEquity = 0;

  if (handEval.hasWrapDraw || (handEval.hasFlushDraw && handEval.drawStrength > 0.4)) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction && random > 0.4) {
      const raiseAmount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.6)));
      return { action: raiseAction.action, amount: raiseAmount };
    }
  }
  if (potOdds < drawEquity) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }
  if (handEval.drawStrength > 0.35 && potOdds < drawEquity * 1.5) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

function legacyShouldBluff(
  state: GameState,
  playerIndex: number,
  boardTexture: LegacyBoardTexture,
  aggression: number,
  positionBonus: number
): boolean {
  const random = Math.random();
  const player = state.players[playerIndex];
  if (state.currentBet > 0) return false;
  const hasPosition = positionBonus >= 0.08;
  const passiveOpponents = aggression < 0.3;
  const scaryBoard = boardTexture.isPaired || boardTexture.flushPossible;
  let bluffFrequency = 0.05;
  if (hasPosition) bluffFrequency += 0.08;
  if (passiveOpponents) bluffFrequency += 0.05;
  if (scaryBoard) bluffFrequency += 0.05;
  if (player.chips < state.pot) bluffFrequency *= 0.3;
  return random < bluffFrequency;
}

function legacyEvaluatePostFlopHand(holeCards: Card[], communityCards: Card[]): LegacyHandEvaluation {
  if (communityCards.length < 3) {
    return { strength: evaluatePreFlopStrength(holeCards), madeHandRank: 0, hasFlushDraw: false, hasStraightDraw: false, hasWrapDraw: false, drawStrength: 0, isNuts: false, isNearNuts: false };
  }
  const madeHand = evaluatePLOHand(holeCards, communityCards.length >= 5 ? communityCards : [...communityCards, ...getDummyCards(5 - communityCards.length, [...holeCards, ...communityCards])]);
  const drawInfo = legacyEvaluateDraws(holeCards, communityCards);
  const isNuts = legacyCheckIfNuts(holeCards, communityCards, madeHand.rank);
  const isNearNuts = !isNuts && madeHand.rank >= 5 && madeHand.highCards[0] >= 12;
  let strength = madeHand.rank / 9;
  if (madeHand.highCards.length > 0) strength += (madeHand.highCards[0] - 8) / 60;
  if (communityCards.length < 5) strength += drawInfo.drawStrength * 0.3;
  return { strength: Math.min(1, strength), madeHandRank: madeHand.rank, ...drawInfo, isNuts, isNearNuts };
}

function legacyEvaluateDraws(holeCards: Card[], communityCards: Card[]) {
  const allCards = [...holeCards, ...communityCards];
  let drawStrength = 0;
  const suitCounts: Record<string, { hole: number; comm: number }> = {};
  for (const card of holeCards) { suitCounts[card.suit] = suitCounts[card.suit] || { hole: 0, comm: 0 }; suitCounts[card.suit].hole++; }
  for (const card of communityCards) { suitCounts[card.suit] = suitCounts[card.suit] || { hole: 0, comm: 0 }; suitCounts[card.suit].comm++; }
  let hasFlushDraw = false;
  for (const [suit, counts] of Object.entries(suitCounts)) {
    if (counts.hole >= 2 && counts.hole + counts.comm >= 4) {
      hasFlushDraw = true;
      const holeOfSuit = holeCards.filter(c => c.suit === suit);
      drawStrength += holeOfSuit.some(c => c.rank === 'A') ? 0.4 : 0.25;
      break;
    }
  }
  const values = [...new Set(allCards.map(c => getRankValue(c.rank)))].sort((a, b) => b - a);
  const holeValues = new Set(holeCards.map(c => getRankValue(c.rank)));
  let hasStraightDraw = false; let hasWrapDraw = false;
  for (let high = 14; high >= 5; high--) {
    let count = 0; let holeUsed = 0;
    for (let v = high; v > high - 5; v--) { const checkVal = v === 0 ? 14 : v; if (values.includes(checkVal)) { count++; if (holeValues.has(checkVal)) holeUsed++; } }
    if (count >= 4 && holeUsed >= 2) {
      hasStraightDraw = true;
      const outs = legacyCountStraightOuts(values, holeValues);
      if (outs >= 8) hasWrapDraw = true;
    }
  }
  if (hasStraightDraw) drawStrength += hasWrapDraw ? 0.35 : 0.2;
  return { hasFlushDraw, hasStraightDraw, hasWrapDraw, drawStrength: Math.min(1, drawStrength) };
}

function legacyCountStraightOuts(allValues: number[], holeValues: Set<number>): number {
  let outs = 0; const valuesSet = new Set(allValues);
  for (let card = 2; card <= 14; card++) {
    if (valuesSet.has(card)) continue;
    const testValues = [...allValues, card].sort((a, b) => b - a);
    for (let i = 0; i <= testValues.length - 5; i++) {
      let isConsecutive = true; let holeUsed = 0;
      for (let j = 0; j < 5; j++) { if (j > 0 && testValues[i + j - 1] - testValues[i + j] !== 1) { isConsecutive = false; break; } if (holeValues.has(testValues[i + j])) holeUsed++; }
      if (isConsecutive && holeUsed >= 2) { outs++; break; }
    }
  }
  return outs;
}

function legacyCheckIfNuts(holeCards: Card[], communityCards: Card[], handRank: number): boolean {
  if (handRank === 9 || handRank === 8) return true;
  if (handRank === 7) {
    const boardValues = communityCards.map(c => getRankValue(c.rank));
    const holeValues = holeCards.map(c => getRankValue(c.rank));
    if (holeValues.filter(v => v === Math.max(...boardValues)).length >= 2) return true;
  }
  if (handRank === 6) {
    for (const suit of ['h', 'd', 'c', 's']) {
      const holeOfSuit = holeCards.filter(c => c.suit === suit);
      const boardOfSuit = communityCards.filter(c => c.suit === suit);
      if (holeOfSuit.length >= 2 && boardOfSuit.length >= 3 && holeOfSuit.some(c => c.rank === 'A')) return true;
    }
  }
  return false;
}

function legacyAnalyzeBoardTexture(communityCards: Card[]): LegacyBoardTexture {
  const values = communityCards.map(c => getRankValue(c.rank));
  const suits = communityCards.map(c => c.suit);
  const valueCounts = new Map<number, number>();
  for (const v of values) valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
  const maxCount = Math.max(...valueCounts.values(), 0);
  const suitCounts = new Map<string, number>();
  for (const s of suits) suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
  const maxSuitCount = Math.max(...suitCounts.values(), 0);
  const uniqueValues = [...new Set(values)].sort((a, b) => a - b);
  let isConnected = false; let straightPossible = false;
  if (uniqueValues.length >= 3) {
    let maxConsecutive = 1; let currentConsecutive = 1;
    for (let i = 1; i < uniqueValues.length; i++) { if (uniqueValues[i] - uniqueValues[i - 1] <= 2) { currentConsecutive++; maxConsecutive = Math.max(maxConsecutive, currentConsecutive); } else { currentConsecutive = 1; } }
    isConnected = maxConsecutive >= 3; straightPossible = isConnected;
  }
  return { isPaired: maxCount >= 2, isTrips: maxCount >= 3, flushPossible: maxSuitCount >= 3, flushDraw: maxSuitCount === 2, straightPossible, isConnected, isWet: (maxSuitCount === 2 || maxSuitCount >= 3) || isConnected, highCard: Math.max(...values, 0) };
}

function legacyAnalyzeOpponentAggression(state: GameState, playerIndex: number): number {
  let raises = 0; let actions = 0;
  for (const action of state.handHistory) {
    if (action.playerId !== playerIndex) { actions++; if (action.action === 'raise' || action.action === 'bet' || action.action === 'allin') raises++; }
  }
  return actions === 0 ? 0.3 : raises / actions;
}

function getDummyCards(count: number, usedCards: Card[]): Card[] {
  const used = new Set(usedCards.map(c => `${c.rank}${c.suit}`));
  const result: Card[] = [];
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suits = ['h', 'd', 'c', 's'] as const;
  for (const rank of ranks) { for (const suit of suits) { if (!used.has(`${rank}${suit}`) && result.length < count) result.push({ rank, suit }); } }
  return result;
}

// === プリフロップ評価（エクスポート、新AIからも参照される） ===

export interface PreFlopEvaluation {
  score: number;
  hasPair: boolean;
  pairRank: string | null;
  hasAceSuited: boolean;
  isDoubleSuited: boolean;
  isSingleSuited: boolean;
  isRundown: boolean;
  hasWrap: boolean;
  hasDangler: boolean;
}

export function evaluatePreFlopStrength(holeCards: Card[]): number {
  return getPreFlopEvaluation(holeCards).score;
}

export function getPreFlopEvaluation(holeCards: Card[]): PreFlopEvaluation {
  const values = holeCards.map(c => getRankValue(c.rank));
  const suits = holeCards.map(c => c.suit);
  const ranks = holeCards.map(c => c.rank);

  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<string, number>();
  const suitToCards = new Map<string, Card[]>();
  for (let i = 0; i < 4; i++) {
    rankCounts.set(ranks[i], (rankCounts.get(ranks[i]) || 0) + 1);
    suitCounts.set(suits[i], (suitCounts.get(suits[i]) || 0) + 1);
    if (!suitToCards.has(suits[i])) suitToCards.set(suits[i], []);
    suitToCards.get(suits[i])!.push(holeCards[i]);
  }

  const sortedValues = [...values].sort((a, b) => a - b);
  const uniqueValues = [...new Set(sortedValues)];
  const span = uniqueValues.length > 1 ? uniqueValues[uniqueValues.length - 1] - uniqueValues[0] : 0;
  const suitCountValues = Array.from(suitCounts.values());

  const isDoubleSuited = suitCountValues.filter(c => c === 2).length === 2;
  const isSingleSuited = !isDoubleSuited && suitCountValues.some(c => c === 2);
  const tripleOrMoreSuited = suitCountValues.some(c => c >= 3);
  const isRainbow = suitCountValues.every(c => c === 1);

  const pairRanks = Array.from(rankCounts.entries()).filter(([_, count]) => count >= 2);
  let pairRank: string | null = null;
  for (const [rank] of pairRanks) {
    const pairValue = getRankValue(rank);
    if (!pairRank || pairValue > getRankValue(pairRank[0] as Rank)) pairRank = rank + rank;
  }

  const hasAce = ranks.includes('A');
  let hasAceSuited = false;
  let aceHighFlushDrawCount = 0;
  if (hasAce) {
    for (const [, cards] of suitToCards.entries()) {
      if (cards.some(c => c.rank === 'A') && cards.length >= 2) { hasAceSuited = true; aceHighFlushDrawCount++; }
    }
  }

  let nuttiness = 0;
  const hasAA = rankCounts.get('A') === 2;
  const hasKK = rankCounts.get('K') === 2;
  const hasQQ = rankCounts.get('Q') === 2;
  const hasJJ = rankCounts.get('J') === 2;

  if (hasAA) nuttiness += 0.25;
  else if (hasKK) nuttiness += 0.18;
  else if (hasQQ) nuttiness += 0.14;
  else if (hasJJ) nuttiness += 0.10;
  else if (pairRanks.length > 0) { const highestPairValue = Math.max(...pairRanks.map(([r]) => getRankValue(r))); nuttiness += (highestPairValue / 14) * 0.08; }

  if (aceHighFlushDrawCount >= 2) nuttiness += 0.12;
  else if (aceHighFlushDrawCount === 1) nuttiness += 0.08;

  const avgValue = values.reduce((a, b) => a + b, 0) / 4;
  nuttiness += Math.max(0, (avgValue - 8) / 14 * 0.08);

  let connectivity = 0;
  const isRundown = uniqueValues.length === 4 && span === 3;
  if (isRundown) {
    const minValue = uniqueValues[0];
    if (minValue >= 10) connectivity += 0.30;
    else if (minValue >= 7) connectivity += 0.25;
    else connectivity += 0.18;
  } else {
    let gapScore = 0;
    for (let i = 0; i < uniqueValues.length - 1; i++) {
      const gap = uniqueValues[i + 1] - uniqueValues[i];
      if (gap === 1) gapScore += 3; else if (gap === 2) gapScore += 2; else if (gap === 3) gapScore += 1;
    }
    connectivity += (gapScore / 9) * 0.20;
  }

  const hasWrap = span <= 4 && uniqueValues.length >= 3;
  if (hasWrap && !isRundown) connectivity += 0.08;

  let hasDangler = false;
  if (uniqueValues.length === 4) {
    const gaps = [];
    for (let i = 0; i < 3; i++) gaps.push(uniqueValues[i + 1] - uniqueValues[i]);
    const maxGap = Math.max(...gaps);
    const maxGapIndex = gaps.indexOf(maxGap);
    if (maxGap >= 5 && (maxGapIndex === 0 || maxGapIndex === 2)) { hasDangler = true; connectivity -= 0.12; }
    else if (maxGap >= 4) { hasDangler = true; connectivity -= 0.06; }
  }

  let suitedness = 0;
  if (isDoubleSuited) { suitedness += 0.20; if (hasAceSuited) suitedness += 0.05; }
  else if (isSingleSuited) { suitedness += 0.10; if (hasAceSuited) suitedness += 0.03; }
  if (tripleOrMoreSuited) suitedness -= 0.08;
  if (isRainbow) suitedness -= 0.05;

  let bonus = 0;
  if (hasAA && hasKK && isDoubleSuited) bonus += 0.15;
  else if (hasAA && ranks.includes('J') && ranks.includes('T') && isDoubleSuited) bonus += 0.12;
  else if (hasKK && hasQQ && isDoubleSuited) bonus += 0.10;
  else if (hasAA && isDoubleSuited) bonus += 0.08;
  if (pairRanks.length === 2) { const pairValues = pairRanks.map(([r]) => getRankValue(r)); bonus += 0.03 + ((pairValues[0] + pairValues[1]) / 2 / 14) * 0.04; }
  if (isRundown && isDoubleSuited) bonus += 0.08;

  const score = Math.min(1, Math.max(0, nuttiness + connectivity + suitedness + bonus));
  return { score, hasPair: pairRanks.length > 0, pairRank, hasAceSuited, isDoubleSuited, isSingleSuited, isRundown, hasWrap, hasDangler };
}

function getPositionBonus(position: string): number {
  switch (position) {
    case 'BTN': return 0.1;
    case 'CO': return 0.08;
    case 'HJ': return 0.05;
    case 'UTG': return 0;
    case 'BB': return -0.05;
    case 'SB': return -0.05;
    default: return 0;
  }
}
