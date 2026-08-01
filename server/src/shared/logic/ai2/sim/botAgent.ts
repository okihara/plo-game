// 本番の Bot AI (旧エンジン ai/) をシミュレータの SimAgent として包む。
// AIContext を渡すことで本番同様に PLOStrategy 経路（personalities 込み）を通す。

import { GameState } from '../../types.js';
import { getCPUAction, getPositionBonus } from '../../cpuAI.js';
import { getPersonality } from '../../ai/personalities.js';
import { PLOStrategy2 } from '../PLOStrategy2.js';
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

/** 新エンジン (ai2/PLOStrategy2) を使う Bot エージェント */
export function createBotAgentV2(botName: string): SimAgent {
  const strategy = new PLOStrategy2();
  const personality = getPersonality(botName);
  return {
    name: botName,
    act(state: GameState, playerIndex: number): AgentDecision {
      const positionBonus = getPositionBonus(state.players[playerIndex].position);
      return strategy.getAction(state, playerIndex, personality, positionBonus, { botName });
    },
  };
}
