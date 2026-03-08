/**
 * nutRank 1 (ナッツ) でフォールドしてしまうケースを調査するデバッグスクリプト
 *
 * 使い方: cd server && npx tsx scripts/postflop-nutrank1-debug.ts
 */

import { GameState, Card, Rank, Suit, Street, Player, Action } from '../src/shared/logic/types.js';
import { getPostflopDecision } from '../src/shared/logic/ai/postflopStrategy.js';
import { evaluateHandExtended } from '../src/shared/logic/ai/handStrength.js';
import { analyzeBoard } from '../src/shared/logic/ai/boardAnalysis.js';
import { BOT_PERSONALITIES } from '../src/shared/logic/ai/personalities.js';
import { StreetHistory, BotPersonality, ExtendedHandEval, ExtendedBoardTexture } from '../src/shared/logic/ai/types.js';

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
  const NUM = 50000;
  let nutRank1Total = 0;
  let nutRank1Folds = 0;
  const foldCases: string[] = [];

  // madeHandRank別の集計
  const nutRank1ByMadeRank: Record<number, { total: number; folds: number }> = {};

  for (let i = 0; i < NUM; i++) {
    const deck = shuffle(createFullDeck());
    const holeCards = deck.slice(0, 4);
    const communityCards = deck.slice(4, 9); // リバーのみ（5枚）

    const position = pick([...POSITIONS]);
    const numActive = pick([2, 2, 2, 3, 3, 4]);
    const bigBlind = pick([2, 6, 10]);
    const pot = Math.round(bigBlind * randBetween(2, 30));
    const facingBet = Math.random() < 0.5;
    const currentBet = facingBet ? Math.round(pot * randBetween(0.2, 1.2)) : 0;
    const playerChips = Math.round(bigBlind * randBetween(20, 200));
    const isAggressor = Math.random() < 0.35;

    const personalityNames = Object.keys(BOT_PERSONALITIES);
    const personality = BOT_PERSONALITIES[pick(personalityNames)];

    const boardTexture = analyzeBoard(communityCards);
    const numOpponents = numActive - 1;
    const handEval = evaluateHandExtended(holeCards, communityCards, 'river', numOpponents, boardTexture);

    if (handEval.nutRank !== 1) continue;

    nutRank1Total++;

    // madeHandRank集計初期化
    if (!nutRank1ByMadeRank[handEval.madeHandRank]) {
      nutRank1ByMadeRank[handEval.madeHandRank] = { total: 0, folds: 0 };
    }
    nutRank1ByMadeRank[handEval.madeHandRank].total++;

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
      currentStreet: 'river', dealerPosition: 0, currentPlayerIndex: 0,
      currentBet, minRaise: currentBet > 0 ? currentBet * 2 : bb,
      smallBlind: Math.max(1, Math.round(bb / 2)), bigBlind: bb,
      lastRaiserIndex: isAggressor ? 0 : (currentBet > 0 ? 1 : -1),
      lastFullRaiseBet: currentBet, handHistory: [],
      isHandComplete: false, winners: [], rake: 0,
      variant: 'plo', ante: 0, bringIn: 0, betCount: 0, maxBetsPerRound: 0,
    };

    const streetHistory: StreetHistory = {
      preflopAggressor: isAggressor ? 0 : 1,
      flopAggressor: null, turnAggressor: null,
      wasRaisedPreflop: true, numBetsOnFlop: 0, numBetsOnTurn: 0,
    };

    let result: { action: Action; amount: number };
    try {
      result = getPostflopDecision(state, 0, handEval, boardTexture, streetHistory, personality, getPositionBonus(position));
    } catch { continue; }

    if (result.action === 'fold') {
      nutRank1Folds++;
      nutRank1ByMadeRank[handEval.madeHandRank].folds++;

      if (foldCases.length < 20) {
        const toCall = currentBet;
        const betToPot = toCall / Math.max(1, pot);
        foldCases.push(
          `  ホール: [${holeCards.map(cardStr).join(' ')}]  ボード: [${communityCards.map(cardStr).join(' ')}]\n` +
          `    madeHandRank=${handEval.madeHandRank}(${HAND_RANK_NAMES[handEval.madeHandRank]}) ` +
          `strength=${handEval.strength.toFixed(2)} equity=${handEval.estimatedEquity.toFixed(2)} ` +
          `isNuts=${handEval.isNuts} isNearNuts=${handEval.isNearNuts}\n` +
          `    nutRank=${handEval.nutRank} betterHands=[${(handEval.possibleBetterHands || []).join(', ')}]\n` +
          `    pot=${pot} toCall=${toCall} betToPot=${betToPot.toFixed(2)} chips=${playerChips}\n` +
          `    facingBet=${facingBet} isAggressor=${isAggressor} position=${position}\n` +
          `    board: wet=${boardTexture.isWet} flush=${boardTexture.flushPossible} straight=${boardTexture.straightPossible} paired=${boardTexture.isPaired} monotone=${boardTexture.monotone}\n` +
          `    draws: flush=${handEval.hasFlushDraw} straight=${handEval.hasStraightDraw} wrap=${handEval.hasWrapDraw}`
        );
      }
    }
  }

  console.log(`\n=== nutRank 1 フォールド調査 (${NUM}回中リバーのみ) ===\n`);
  console.log(`nutRank 1 検出数: ${nutRank1Total}`);
  console.log(`フォールド数: ${nutRank1Folds} (${(nutRank1Folds / Math.max(1, nutRank1Total) * 100).toFixed(1)}%)\n`);

  console.log(`--- madeHandRank別の内訳 ---`);
  for (const [rank, data] of Object.entries(nutRank1ByMadeRank).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const r = Number(rank);
    console.log(`  ${HAND_RANK_NAMES[r] || `rank${r}`} (rank=${r}): total=${data.total}, folds=${data.folds} (${(data.folds / Math.max(1, data.total) * 100).toFixed(1)}%)`);
  }

  if (foldCases.length > 0) {
    console.log(`\n--- フォールドした具体例 (最大20件) ---\n`);
    for (const c of foldCases) {
      console.log(c);
      console.log();
    }
  }
}

main();
