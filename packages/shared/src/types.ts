export type Suit = 'h' | 'd' | 'c' | 's'; // hearts, diamonds, clubs, spades
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
  isUp?: boolean;  // Stud: true=表向き, false=裏向き（PLO: undefined）
}

/** Stud: holeCardsから表向きカードのみ抽出（配布順維持） */
export function getUpCards(cards: Card[]): Card[] {
  return cards.filter(c => c.isUp === true);
}

export type GameVariant = 'plo' | 'stud';

export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'HJ' | 'CO';

export interface Player {
  id: number;
  name: string;
  position: Position;
  chips: number;
  holeCards: Card[];   // PLO: 4枚の私的カード, Stud: 全カード配布順(isUpで表裏区別)
  currentBet: number;
  totalBetThisRound: number;
  folded: boolean;
  isAllIn: boolean;
  hasActed: boolean;
  isSittingOut: boolean;
  avatarId?: number;
  avatarUrl?: string | null;  // Twitter/OAuth profile image URL
  odId?: string;  // Online user ID (for stats lookup)
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
  | 'third' | 'fourth' | 'fifth' | 'sixth' | 'seventh';
export type Action = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface GameAction {
  playerId: number;
  action: Action;
  amount: number;
  street?: Street;
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
  lastFullRaiseBet: number;  // フルレイズが発生した時の currentBet（リオープン判定用）
  handHistory: GameAction[];
  isHandComplete: boolean;
  winners: { playerId: number; amount: number; handName: string }[];
  rake: number;
  // Variant support
  variant: GameVariant;
  ante: number;              // Stud: アンテ額（PLO: 0）
  bringIn: number;           // Stud: ブリングイン額（PLO: 0）
  betCount: number;          // Fixed Limit: 現ストリートのベット回数
  maxBetsPerRound: number;   // Fixed Limit: 最大ベット回数/ストリート（通常4）
}
