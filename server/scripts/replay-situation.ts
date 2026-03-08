/**
 * 特定シチュエーションを繰り返しシミュレートする
 * usage: cd server && npx tsx scripts/replay-situation.ts
 */
import { GameState, Card, Suit, Rank, Player, Action } from '../src/shared/logic/types.js';
import { getPostflopDecision } from '../src/shared/logic/ai/postflopStrategy.js';
import { evaluateHandExtended } from '../src/shared/logic/ai/handStrength.js';
import { analyzeBoard } from '../src/shared/logic/ai/boardAnalysis.js';
import { BOT_PERSONALITIES } from '../src/shared/logic/ai/personalities.js';
import { StreetHistory } from '../src/shared/logic/ai/types.js';

function c(s: string): Card {
  return { rank: s[0] as Rank, suit: s[1] as Suit };
}

const N = 1000;

// === ハンド fttprv の状況 ===
// akane_t2: [7c, 9c, 4h, 4d] on board 7s As Kc 6h 3c
// okkichan3 bet 91 into pot ~91 (pot bet)
// river, heads-up

const holeCards = [c('7c'), c('9c'), c('4h'), c('4d')];
const communityCards = [c('7s'), c('As'), c('Kc'), c('6h'), c('3c')];
const pot = 91;
const currentBet = 91; // pot bet
const playerChips = 200;

const boardTexture = analyzeBoard(communityCards);
const handEval = evaluateHandExtended(holeCards, communityCards, 'river', 1, boardTexture);

console.log('=== シチュエーション ===');
console.log(`ホール: ${holeCards.map(c => c.rank+c.suit).join(' ')}`);
console.log(`ボード: ${communityCards.map(c => c.rank+c.suit).join(' ')}`);
console.log(`ポット: ${pot}  ベット: ${currentBet}  betToPotRatio: ${(currentBet/pot).toFixed(2)}`);
console.log(`\nハンド評価:`);
console.log(`  madeHandRank: ${handEval.madeHandRank} (${['','ハイカード','ワンペア','ツーペア','セット','ストレート','フラッシュ','フルハウス','フォーカード','ストフラ'][handEval.madeHandRank] || '?'})`);
console.log(`  strength: ${handEval.strength.toFixed(3)}`);
console.log(`  nutRank: ${handEval.nutRank}`);
console.log(`  estimatedEquity: ${handEval.estimatedEquity.toFixed(3)}`);
console.log(`\nボードテクスチャ:`);
console.log(`  flushPossible: ${boardTexture.flushPossible}, straightPossible: ${boardTexture.straightPossible}`);
console.log(`  isPaired: ${boardTexture.isPaired}, isWet: ${boardTexture.isWet}`);

// 全パーソナリティでテスト
const personalityNames = Object.keys(BOT_PERSONALITIES);
const results: Record<string, Record<string, number>> = {};
let totalActions: Record<string, number> = {};

for (const pName of personalityNames) {
  const personality = BOT_PERSONALITIES[pName];
  const actions: Record<string, number> = {};

  for (let i = 0; i < N; i++) {
    const players: Player[] = [];
    for (let s = 0; s < 6; s++) {
      players.push({
        id: s, name: s === 4 ? 'Bot' : `Opp${s}`,
        position: ['BTN','SB','BB','UTG','HJ','CO'][s] as any,
        chips: s === 4 ? playerChips : 300,
        holeCards: s === 4 ? holeCards : [],
        currentBet: s === 4 ? 0 : (s === 3 ? currentBet : 0),
        totalBetThisRound: 0,
        folded: s !== 3 && s !== 4, isAllIn: false, hasActed: s !== 4, isSittingOut: false,
      });
    }

    const state: GameState = {
      players, deck: [], communityCards, pot, sidePots: [],
      currentStreet: 'river', dealerPosition: 0, currentPlayerIndex: 4,
      currentBet, minRaise: currentBet * 2, smallBlind: 1, bigBlind: 3,
      lastRaiserIndex: 3, lastFullRaiseBet: currentBet,
      handHistory: [], isHandComplete: false, winners: [], rake: 0,
      variant: 'plo', ante: 0, bringIn: 0, betCount: 0, maxBetsPerRound: 0,
    };

    const streetHistory: StreetHistory = {
      preflopAggressor: 3, flopAggressor: 3, turnAggressor: 3,
      wasRaisedPreflop: true, numBetsOnFlop: 1, numBetsOnTurn: 1,
    };

    try {
      const result = getPostflopDecision(state, 4, handEval, boardTexture, streetHistory, personality, 0.05);
      actions[result.action] = (actions[result.action] || 0) + 1;
      totalActions[result.action] = (totalActions[result.action] || 0) + 1;
    } catch {}
  }
  results[pName] = actions;
}

console.log(`\n=== 結果 (各パーソナリティ ${N}回) ===`);
console.log(`${'パーソナリティ'.padEnd(18)} fold    call    bet/raise`);
console.log('-'.repeat(55));
for (const [name, actions] of Object.entries(results)) {
  const fold = ((actions.fold || 0) / N * 100).toFixed(0).padStart(3) + '%';
  const call = ((actions.call || 0) / N * 100).toFixed(0).padStart(3) + '%';
  const bet = (((actions.bet || 0) + (actions.raise || 0)) / N * 100).toFixed(0).padStart(3) + '%';
  console.log(`${name.padEnd(18)} ${fold}    ${call}    ${bet}`);
}

const totalN = N * personalityNames.length;
console.log('-'.repeat(55));
const foldPct = ((totalActions.fold || 0) / totalN * 100).toFixed(1);
const callPct = ((totalActions.call || 0) / totalN * 100).toFixed(1);
const betPct = (((totalActions.bet || 0) + (totalActions.raise || 0)) / totalN * 100).toFixed(1);
console.log(`${'全体平均'.padEnd(18)} ${foldPct.padStart(3)}%    ${callPct.padStart(3)}%    ${betPct.padStart(3)}%`);
