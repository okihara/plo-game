/**
 * フラッシュ可能ボードでワンペアがコールするケースを調査
 *
 * 使い方: cd server && npx tsx scripts/postflop-flush-onepair-debug.ts
 */

import { GameState, Card, Rank, Suit, Street, Player, Action } from '../src/shared/logic/types.js';
import { getPostflopDecision } from '../src/shared/logic/ai/postflopStrategy.js';
import { evaluateHandExtended } from '../src/shared/logic/ai/handStrength.js';
import { analyzeBoard } from '../src/shared/logic/ai/boardAnalysis.js';
import { BOT_PERSONALITIES } from '../src/shared/logic/ai/personalities.js';
import { StreetHistory, BotPersonality } from '../src/shared/logic/ai/types.js';

const SUITS: Suit[] = ['h', 'd', 'c', 's'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const POSITIONS = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] as const;

const HAND_RANK_NAMES: Record<number, string> = {
  0: 'ハイカード', 1: 'ハイカード', 2: 'ワンペア', 3: 'ツーペア',
  4: 'セット', 5: 'ストレート', 6: 'フラッシュ', 7: 'フルハウス',
  8: 'フォーカード', 9: 'ストフラ',
};

function createFullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function cardStr(c: Card): string { return `${c.rank}${c.suit}`; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randBetween(min: number, max: number): number { return min + Math.random() * (max - min); }
function getPositionBonus(position: string): number {
  switch (position) {
    case 'BTN': return 0.1; case 'CO': return 0.08; case 'HJ': return 0.05;
    case 'UTG': return 0; case 'BB': return -0.05; case 'SB': return -0.05;
    default: return 0;
  }
}

function main() {
  const NUM = 100000;
  let flushBoardOnePairFacingBet = 0;
  let callCount = 0;
  let foldCount = 0;
  let raiseCount = 0;
  const callExamples: string[] = [];

  // ストリート別
  const byStreet: Record<string, { total: number; call: number; fold: number; raise: number }> = {};

  // betToPot別
  const byBetSize: Record<string, { total: number; call: number; fold: number }> = {};

  // フラッシュドローの有無
  const byFlushDraw: Record<string, { total: number; call: number; fold: number }> = {};

  for (let i = 0; i < NUM; i++) {
    const deck = shuffle(createFullDeck());
    const street = pick(['flop', 'turn', 'river'] as const);
    const numCommunity = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
    const holeCards = deck.slice(0, 4);
    const communityCards = deck.slice(4, 4 + numCommunity);

    const boardTexture = analyzeBoard(communityCards);
    if (!boardTexture.flushPossible) continue;

    const numActive = pick([2, 2, 2, 3, 3, 4]);
    const numOpponents = numActive - 1;
    const handEval = evaluateHandExtended(holeCards, communityCards, street, numOpponents, boardTexture);
    if (handEval.madeHandRank !== 2) continue; // ワンペアのみ

    // ベットに直面している状況のみ
    const bigBlind = pick([2, 6, 10]);
    const pot = Math.round(bigBlind * randBetween(3, 25));
    const betToPotRatio = randBetween(0.3, 1.0);
    const currentBet = Math.round(pot * betToPotRatio);
    if (currentBet <= 0) continue;

    const playerChips = Math.round(bigBlind * randBetween(30, 150));
    const isAggressor = Math.random() < 0.35;
    const position = pick([...POSITIONS]);
    const personalityNames = Object.keys(BOT_PERSONALITIES);
    const personality = BOT_PERSONALITIES[pick(personalityNames)];

    const players: Player[] = [];
    for (let pi = 0; pi < 6; pi++) {
      const isFolded = pi !== 0 && (pi >= numActive);
      players.push({
        id: pi, name: pi === 0 ? 'Bot' : `Opp${pi}`,
        position: POSITIONS[pi],
        chips: pi === 0 ? playerChips : Math.round(playerChips * randBetween(0.5, 2)),
        holeCards: pi === 0 ? holeCards : [],
        currentBet: pi === 0 ? 0 : (isFolded ? 0 : currentBet),
        totalBetThisRound: 0, folded: isFolded, isAllIn: false,
        hasActed: pi !== 0, isSittingOut: false,
      });
    }
    players[0].position = position;

    const bb = pot > 20 ? Math.round(pot / 10) : 2;
    const state: GameState = {
      players, deck: [], communityCards, pot, sidePots: [],
      currentStreet: street, dealerPosition: 0, currentPlayerIndex: 0,
      currentBet, minRaise: currentBet * 2,
      smallBlind: Math.max(1, Math.round(bb / 2)), bigBlind: bb,
      lastRaiserIndex: isAggressor ? 0 : 1,
      lastFullRaiseBet: currentBet, handHistory: [],
      isHandComplete: false, winners: [], rake: 0,
      variant: 'plo', ante: 0, bringIn: 0, betCount: 0, maxBetsPerRound: 0,
    };

    const streetHistory: StreetHistory = {
      preflopAggressor: isAggressor ? 0 : 1,
      flopAggressor: null, turnAggressor: null,
      wasRaisedPreflop: true,
      numBetsOnFlop: street === 'flop' ? 1 : 0,
      numBetsOnTurn: street === 'turn' ? 1 : 0,
    };

    let result: { action: Action; amount: number };
    try {
      result = getPostflopDecision(state, 0, handEval, boardTexture, streetHistory, personality, getPositionBonus(position));
    } catch { continue; }

    flushBoardOnePairFacingBet++;

    // ストリート別集計
    if (!byStreet[street]) byStreet[street] = { total: 0, call: 0, fold: 0, raise: 0 };
    byStreet[street].total++;

    // betサイズ別
    const actualBetToPot = currentBet / Math.max(1, pot);
    const sizeKey = actualBetToPot < 0.4 ? '< 40%pot' : actualBetToPot < 0.6 ? '40-60%pot' : actualBetToPot < 0.8 ? '60-80%pot' : '80%+pot';
    if (!byBetSize[sizeKey]) byBetSize[sizeKey] = { total: 0, call: 0, fold: 0 };
    byBetSize[sizeKey].total++;

    // フラッシュドロー有無
    const fdKey = handEval.hasFlushDraw ? 'フラッシュドロー有' : 'フラッシュドロー無';
    if (!byFlushDraw[fdKey]) byFlushDraw[fdKey] = { total: 0, call: 0, fold: 0 };
    byFlushDraw[fdKey].total++;

    if (result.action === 'call') {
      callCount++;
      byStreet[street].call++;
      byBetSize[sizeKey].call++;
      byFlushDraw[fdKey].call++;

      if (callExamples.length < 15) {
        callExamples.push(
          `  [${street}] ホール: [${holeCards.map(cardStr).join(' ')}]  ボード: [${communityCards.map(cardStr).join(' ')}]\n` +
          `    strength=${handEval.strength.toFixed(2)} equity=${handEval.estimatedEquity.toFixed(2)} ` +
          `flushDraw=${handEval.hasFlushDraw} straightDraw=${handEval.hasStraightDraw}\n` +
          `    pot=${pot} toCall=${currentBet} betToPot=${actualBetToPot.toFixed(2)} ` +
          `monotone=${boardTexture.monotone}\n` +
          `    isAggressor=${isAggressor} position=${position} personality=${personality.name}`
        );
      }
    } else if (result.action === 'fold') {
      foldCount++;
      byStreet[street].fold++;
      byBetSize[sizeKey].fold++;
      byFlushDraw[fdKey].fold++;
    } else if (result.action === 'raise') {
      raiseCount++;
      byStreet[street].raise++;
    }
  }

  const pct = (n: number, t: number) => t === 0 ? '  -' : `${Math.round(n / t * 100).toString().padStart(3)}%`;

  console.log(`\n=== フラッシュ可能ボード × ワンペア × ベット直面 調査 ===\n`);
  console.log(`該当ケース: ${flushBoardOnePairFacingBet}`);
  console.log(`  fold: ${pct(foldCount, flushBoardOnePairFacingBet)} (${foldCount})`);
  console.log(`  call: ${pct(callCount, flushBoardOnePairFacingBet)} (${callCount})`);
  console.log(`  raise: ${pct(raiseCount, flushBoardOnePairFacingBet)} (${raiseCount})`);

  console.log(`\n--- ストリート別 ---`);
  for (const [st, d] of Object.entries(byStreet).sort()) {
    console.log(`  ${st.padEnd(8)} (n=${String(d.total).padStart(5)})  fold:${pct(d.fold, d.total)} | call:${pct(d.call, d.total)} | raise:${pct(d.raise, d.total)}`);
  }

  console.log(`\n--- ベットサイズ別 ---`);
  for (const [sz, d] of Object.entries(byBetSize)) {
    console.log(`  ${sz.padEnd(12)} (n=${String(d.total).padStart(5)})  fold:${pct(d.fold, d.total)} | call:${pct(d.call, d.total)}`);
  }

  console.log(`\n--- フラッシュドロー有無 ---`);
  for (const [fd, d] of Object.entries(byFlushDraw)) {
    console.log(`  ${fd.padEnd(16)} (n=${String(d.total).padStart(5)})  fold:${pct(d.fold, d.total)} | call:${pct(d.call, d.total)}`);
  }

  if (callExamples.length > 0) {
    console.log(`\n--- コールした具体例 ---\n`);
    for (const ex of callExamples) {
      console.log(ex);
      console.log();
    }
  }
}

main();
