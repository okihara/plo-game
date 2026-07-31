// 本番の Bot AI (旧エンジン ai/) をシミュレータの SimAgent として包む。
// AIContext を渡すことで本番同様に PLOStrategy 経路（personalities 込み）を通す。

import { GameState } from '../../types.js';
import { getCPUAction } from '../../cpuAI.js';
import { SimAgent, AgentDecision } from './types.js';

export function createBotAgent(botName: string): SimAgent {
  return {
    name: botName,
    act(state: GameState, playerIndex: number): AgentDecision {
      const { action, amount } = getCPUAction(state, playerIndex, { botName });
      return { action, amount };
    },
  };
}
