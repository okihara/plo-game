import type { Card, GameState, Player, Street } from '../../types.js';
import type {
  ExtendedHandEval,
  ExtendedBoardTexture,
  BotPersonality,
  StreetHistory,
} from '../types.js';

/** カード文字列をCardオブジェクトに変換 (例: "Ah" → { rank: 'A', suit: 'h' }) */
export function c(str: string): Card {
  return { rank: str[0] as Card['rank'], suit: str[1] as Card['suit'] };
}

/** ExtendedHandEval のデフォルト値付きファクトリ */
export function makeHandEval(overrides: Partial<ExtendedHandEval> = {}): ExtendedHandEval {
  return {
    strength: 0.3,
    madeHandRank: 2,
    hasFlushDraw: false,
    hasStraightDraw: false,
    hasWrapDraw: false,
    drawStrength: 0,
    isNuts: false,
    isNearNuts: false,
    estimatedEquity: 0.3,
    blockerScore: 0,
    vulnerabilityToDraws: 0,
    ...overrides,
  };
}

/** ExtendedBoardTexture のデフォルト値付きファクトリ */
export function makeBoardTexture(overrides: Partial<ExtendedBoardTexture> = {}): ExtendedBoardTexture {
  return {
    isPaired: false,
    isTrips: false,
    flushPossible: false,
    flushDraw: false,
    straightPossible: false,
    isConnected: false,
    isWet: false,
    highCard: 14,
    monotone: false,
    twoTone: false,
    rainbow: true,
    dynamism: 0.3,
    averageRank: 10,
    hasBroadway: true,
    ...overrides,
  };
}

/** BotPersonality のデフォルト値付きファクトリ（バランス型） */
export function makePersonality(overrides: Partial<BotPersonality> = {}): BotPersonality {
  return {
    name: 'TestBot',
    vpip: 0.28,
    pfr: 0.20,
    threeBetFreq: 0.08,
    cbetFreq: 0.60,
    aggression: 0.75,
    bluffFreq: 0.10,
    slowplayFreq: 0.10,
    foldTo3Bet: 0.55,
    foldToCbet: 0.45,
    foldToRiverBet: 0.55,
    ...overrides,
  };
}

/** StreetHistory のデフォルト値付きファクトリ */
export function makeStreetHistory(overrides: Partial<StreetHistory> = {}): StreetHistory {
  return {
    preflopAggressor: 0,
    flopAggressor: null,
    turnAggressor: null,
    wasRaisedPreflop: true,
    numBetsOnFlop: 0,
    numBetsOnTurn: 0,
    ...overrides,
  };
}

/** プレイヤーのデフォルト値付きファクトリ */
export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 0,
    name: 'Player0',
    position: 'BTN',
    chips: 1000,
    holeCards: [],
    currentBet: 0,
    totalBetThisRound: 0,
    folded: false,
    isAllIn: false,
    hasActed: false,
    isSittingOut: false,
    ...overrides,
  };
}

/** 最小限の GameState ファクトリ */
export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [
      makePlayer({ id: 0, name: 'Hero', position: 'BTN', chips: 1000 }),
      makePlayer({ id: 1, name: 'Villain', position: 'BB', chips: 1000 }),
    ],
    deck: [],
    communityCards: [],
    pot: 100,
    sidePots: [],
    currentStreet: 'flop',
    dealerPosition: 0,
    currentPlayerIndex: 0,
    currentBet: 0,
    minRaise: 10,
    smallBlind: 5,
    bigBlind: 10,
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: false,
    winners: [],
    rake: 0,
    ...overrides,
  };
}
