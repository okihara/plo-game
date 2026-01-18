export type Suit = 'h' | 'd' | 'c' | 's'; // hearts, diamonds, clubs, spades
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'HJ' | 'CO';

export interface Player {
  id: number;
  name: string;
  position: Position;
  chips: number;
  holeCards: Card[];
  currentBet: number;
  totalBetThisRound: number;
  folded: boolean;
  isAllIn: boolean;
  isHuman: boolean;
  hasActed: boolean;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type Action = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface GameAction {
  playerId: number;
  action: Action;
  amount: number;
}

export interface HandRank {
  rank: number; // 1=ハイカード, 2=ワンペア, ... 9=ストレートフラッシュ
  name: string;
  highCards: number[];
}

export interface GameState {
  players: Player[];
  deck: Card[];
  communityCards: Card[];
  pot: number;
  sidePots: { amount: number; eligiblePlayers: number[] }[];
  currentStreet: Street;
  dealerPosition: number;
  currentPlayerIndex: number;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  lastRaiserIndex: number;
  handHistory: GameAction[];
  isHandComplete: boolean;
  winners: { playerId: number; amount: number; handName: string }[];
}
