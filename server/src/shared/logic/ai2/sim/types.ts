// Bot 再設計 (docs/bot-redesign.md) のオフラインシミュレータ用の型。
// エージェント = 1 席分の意思決定器。Bot AI もエクスプロイターも同じ契約で扱う。

import { GameState, Action } from '../../types.js';

export interface AgentDecision {
  action: Action;
  amount: number;
}

export interface SimAgent {
  readonly name: string;
  /** state.currentPlayerIndex === playerIndex の状態で呼ばれる */
  act(state: GameState, playerIndex: number): AgentDecision;
}
