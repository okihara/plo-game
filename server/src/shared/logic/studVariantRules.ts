import { GameState, Card } from './types.js';

export interface ShowdownPlayer {
  id: number;
  holeCards: Card[];
}

export interface ShowdownPot {
  amount: number;
  eligiblePlayers: number[];
}

export interface PotWinner {
  playerId: number;
  amount: number;
  handName: string;
  hiLoType?: 'high' | 'low' | 'scoop';
}

export interface StudVariantRules {
  /** 3rd street: ブリングインプレイヤーを決定 */
  findBringInPlayer(state: GameState): number;

  /** 4th〜7th street: 最初にアクションするプレイヤーを決定 */
  findFirstToAct(state: GameState): number;

  /** UI表示用: ハンド名を返す */
  describeHand(cards: Card[]): string;

  /** ショーダウン: 各ポットの勝者・分配を決定 */
  resolveShowdown(activePlayers: ShowdownPlayer[], pots: ShowdownPot[]): PotWinner[];
}
