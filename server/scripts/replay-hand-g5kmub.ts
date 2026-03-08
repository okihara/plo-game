/**
 * Hand #1394 (g5kmub) を再現して getPostflopDecision の判断を確認
 */
import { GameState, Card, Rank, Suit, Player } from '../src/shared/logic/types.js';
import { getPostflopDecision } from '../src/shared/logic/ai/postflopStrategy.js';
import { evaluateHandExtended } from '../src/shared/logic/ai/handStrength.js';
import { analyzeBoard } from '../src/shared/logic/ai/boardAnalysis.js';
import { getPersonality } from '../src/shared/logic/ai/personalities.js';
import { StreetHistory } from '../src/shared/logic/ai/types.js';

function card(s: string): Card {
  return { rank: s[0] as Rank, suit: s[1] as Suit };
}

// mirei_plo のリバー判断を再現
const holeCards = [card('2c'), card('Tc'), card('4s'), card('Td')];
const communityCards = [card('As'), card('Kd'), card('Jc'), card('8d'), card('7d')];
const personality = getPersonality('mirei_plo');

const boardTexture = analyzeBoard(communityCards);
console.log('=== Board Texture ===');
console.log(`  flushPossible=${boardTexture.flushPossible}, monotone=${boardTexture.monotone}`);
console.log(`  straightPossible=${boardTexture.straightPossible}, isPaired=${boardTexture.isPaired}`);
console.log(`  isWet=${boardTexture.isWet}`);

const handEval = evaluateHandExtended(holeCards, communityCards, 'river', 1, boardTexture);
console.log('\n=== Hand Eval (mirei_plo) ===');
console.log(`  madeHandRank=${handEval.madeHandRank} strength=${handEval.strength.toFixed(3)}`);
console.log(`  estimatedEquity=${handEval.estimatedEquity.toFixed(3)}`);
console.log(`  isNuts=${handEval.isNuts} isNearNuts=${handEval.isNearNuts}`);
console.log(`  nutRank=${handEval.nutRank}`);
console.log(`  hasFlushDraw=${handEval.hasFlushDraw} hasStraightDraw=${handEval.hasStraightDraw}`);
console.log(`  possibleBetterHands=${JSON.stringify(handEval.possibleBetterHands)}`);

// GameState を構築（リバー、mirei_plo=seat4、okkichan3=seat3 がbet 11）
const pot = 37 - 11; // ベット前のポット
const players: Player[] = [];
for (let i = 0; i < 6; i++) {
  const folded = ![3, 4].includes(i);
  players.push({
    id: i, name: `player${i}`, position: (['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] as const)[i],
    chips: i === 4 ? 300 : 300, // mirei_plo
    holeCards: i === 4 ? holeCards : [],
    currentBet: i === 3 ? 11 : 0, // okkichan3 bet 11
    totalBetThisRound: 0, folded, isAllIn: false,
    hasActed: i !== 4, isSittingOut: false,
  });
}

const state: GameState = {
  players, deck: [], communityCards,
  pot: pot + 11, // okkichan3のベット込み
  sidePots: [],
  currentStreet: 'river', dealerPosition: 2, currentPlayerIndex: 4,
  currentBet: 11, minRaise: 22,
  smallBlind: 1, bigBlind: 3,
  lastRaiserIndex: 3, lastFullRaiseBet: 11,
  handHistory: [], isHandComplete: false, winners: [], rake: 0,
  variant: 'plo', ante: 0, bringIn: 0, betCount: 0, maxBetsPerRound: 0,
};

const streetHistory: StreetHistory = {
  preflopAggressor: null, // BBがチェックで回しただけ
  flopAggressor: null,
  turnAggressor: 3, // okkichan3
  wasRaisedPreflop: false,
  numBetsOnFlop: 0,
  numBetsOnTurn: 1,
};

const positionBonus = 0.05; // HJ

console.log('\n=== Decision Context ===');
console.log(`  pot=${state.pot} toCall=${state.currentBet} potOdds=${(11 / (state.pot + 11)).toFixed(3)}`);

// 100回試行して分布を見る
const results: Record<string, number> = {};
for (let i = 0; i < 1000; i++) {
  const result = getPostflopDecision(
    state, 4, handEval, boardTexture, streetHistory, personality, positionBonus
  );
  results[result.action] = (results[result.action] || 0) + 1;
}

console.log('\n=== Decision (1000 trials) ===');
for (const [action, count] of Object.entries(results).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${action}: ${(count / 10).toFixed(1)}%`);
}
