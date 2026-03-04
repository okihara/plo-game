import { GameState, Action } from '../types.js';
import { AIVariantStrategy, AIContext, BotPersonality } from './types.js';
import { deriveStreetHistory, getPositionBonus } from '../cpuAI.js';
import { analyzeBoard } from './boardAnalysis.js';
import { evaluateHandExtended } from './handStrength.js';
import { getPostflopDecision } from './postflopStrategy.js';
import { getPreflopDecision } from './preflopStrategy.js';

export class PLOStrategy implements AIVariantStrategy {
  getAction(
    state: GameState,
    playerIndex: number,
    personality: BotPersonality,
    _positionBonus: number,
    context: AIContext,
  ): { action: Action; amount: number } {
    const player = state.players[playerIndex];
    const positionBonus = getPositionBonus(player.position);
    const handActions = context.handActions ?? state.handHistory;
    const streetHistory = deriveStreetHistory(state, handActions, playerIndex);

    if (state.currentStreet === 'preflop') {
      return getPreflopDecision(state, playerIndex, personality, positionBonus, context.opponentModel);
    }

    const activePlayers = state.players.filter(p => !p.isSittingOut && !p.folded).length;
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
}
