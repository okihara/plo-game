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

export type GameVariant = 'plo' | 'stud' | 'razz' | 'limit_2-7_triple_draw' | 'no_limit_2-7_single_draw' | 'limit_holdem';

export function isStudFamily(variant: GameVariant): boolean {
  return variant === 'stud' || variant === 'razz';
}

export function isDrawFamily(variant: GameVariant): boolean {
  return variant === 'limit_2-7_triple_draw' || variant === 'no_limit_2-7_single_draw';
}

export function isHoldemFamily(variant: GameVariant): boolean {
  return variant === 'limit_holdem';
}

/** ドローフェーズのストリートかどうか（カードを捨てて引き直す） */
export function isDrawStreet(street: Street): boolean {
  return street === 'draw1' || street === 'draw2' || street === 'draw3';
}

/** ベッティングフェーズのストリートかどうか（Draw系） */
export function isDrawBettingStreet(street: Street): boolean {
  return street === 'predraw' || street === 'postdraw1' || street === 'postdraw2' || street === 'final';
}

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
  isShowdown?: boolean;  // ショウダウン時にカードを表示
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
  | 'third' | 'fourth' | 'fifth' | 'sixth' | 'seventh'
  | 'predraw' | 'draw1' | 'postdraw1' | 'draw2' | 'postdraw2' | 'draw3' | 'final';
export type Action = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin' | 'draw';

export interface GameAction {
  playerId: number;
  action: Action;
  amount: number;
  street?: Street;
  discardIndices?: number[];  // Triple Draw: ドロー時に捨てたカードのインデックス
}

export interface HandRank {
  rank: number; // 1=ハイカード, 2=ワンペア, ... 9=ストレートフラッシュ
  name: string;
  highCards: number[];
}

export interface GameState {
  tableId?: string;       // オンライン: テーブルID（FF移動検知用）
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
  discardPile?: Card[];      // Draw: 捨て札の山（ドロー時のデッキ補充用）
  maxDraws?: number;         // Draw: ドロー回数（1=Single Draw, 3=Triple Draw, デフォルト3）
}
