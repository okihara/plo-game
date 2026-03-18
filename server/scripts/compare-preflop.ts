/**
 * 旧ヒューリスティック vs 新エクイティベースのプリフロップスコア比較
 */
import { Card, Rank, Suit } from '@plo/shared';
import { getRankValue } from '@plo/shared';
import { getPreFlopEvaluation as getNewEval } from '../src/shared/logic/preflopEquity.js';

// ===== 旧ヒューリスティック（git history から復元） =====
interface OldPreFlopEvaluation {
  score: number;
  hasPair: boolean;
  pairRank: string | null;
  hasAceSuited: boolean;
  isDoubleSuited: boolean;
  isSingleSuited: boolean;
  isRundown: boolean;
  hasWrap: boolean;
  hasDangler: boolean;
}

function getOldEval(holeCards: Card[]): OldPreFlopEvaluation {
  const validCards = holeCards.filter(c => c && c.rank && c.suit);
  if (validCards.length < 4) {
    return { score: 0, hasPair: false, pairRank: null, hasAceSuited: false, isDoubleSuited: false, isSingleSuited: false, isRundown: false, hasWrap: false, hasDangler: false };
  }
  const values = validCards.map(c => getRankValue(c.rank));
  const suits = validCards.map(c => c.suit);
  const ranks = validCards.map(c => c.rank);

  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<string, number>();
  const suitToCards = new Map<string, Card[]>();
  for (let i = 0; i < 4; i++) {
    rankCounts.set(ranks[i], (rankCounts.get(ranks[i]) || 0) + 1);
    suitCounts.set(suits[i], (suitCounts.get(suits[i]) || 0) + 1);
    if (!suitToCards.has(suits[i])) suitToCards.set(suits[i], []);
    suitToCards.get(suits[i])!.push(holeCards[i]);
  }

  const sortedValues = [...values].sort((a, b) => a - b);
  const uniqueValues = [...new Set(sortedValues)];
  const span = uniqueValues.length > 1 ? uniqueValues[uniqueValues.length - 1] - uniqueValues[0] : 0;
  const suitCountValues = Array.from(suitCounts.values());

  const isDoubleSuited = suitCountValues.filter(c => c === 2).length === 2;
  const isSingleSuited = !isDoubleSuited && suitCountValues.some(c => c === 2);
  const tripleOrMoreSuited = suitCountValues.some(c => c >= 3);
  const isRainbow = suitCountValues.every(c => c === 1);

  const pairRanks = Array.from(rankCounts.entries()).filter(([, count]) => count >= 2);
  let pairRank: string | null = null;
  for (const [rank] of pairRanks) {
    const pairValue = getRankValue(rank);
    if (!pairRank || pairValue > getRankValue(pairRank[0] as Rank)) pairRank = rank + rank;
  }

  const hasAce = ranks.includes('A');
  let hasAceSuited = false;
  let aceHighFlushDrawCount = 0;
  if (hasAce) {
    for (const [, cards] of suitToCards.entries()) {
      if (cards.some(c => c.rank === 'A') && cards.length >= 2) { hasAceSuited = true; aceHighFlushDrawCount++; }
    }
  }

  let nuttiness = 0;
  const hasAA = rankCounts.get('A') === 2;
  const hasKK = rankCounts.get('K') === 2;
  const hasQQ = rankCounts.get('Q') === 2;
  const hasJJ = rankCounts.get('J') === 2;

  if (hasAA) nuttiness += 0.25;
  else if (hasKK) nuttiness += 0.18;
  else if (hasQQ) nuttiness += 0.14;
  else if (hasJJ) nuttiness += 0.10;
  else if (pairRanks.length > 0) { const highestPairValue = Math.max(...pairRanks.map(([r]) => getRankValue(r))); nuttiness += (highestPairValue / 14) * 0.08; }

  if (aceHighFlushDrawCount >= 2) nuttiness += 0.12;
  else if (aceHighFlushDrawCount === 1) nuttiness += 0.08;

  const avgValue = values.reduce((a, b) => a + b, 0) / 4;
  nuttiness += Math.max(0, (avgValue - 8) / 14 * 0.08);

  let connectivity = 0;
  const isRundown = uniqueValues.length === 4 && span === 3;
  if (isRundown) {
    const minValue = uniqueValues[0];
    if (minValue >= 10) connectivity += 0.30;
    else if (minValue >= 7) connectivity += 0.25;
    else connectivity += 0.18;
  } else {
    let gapScore = 0;
    for (let i = 0; i < uniqueValues.length - 1; i++) {
      const gap = uniqueValues[i + 1] - uniqueValues[i];
      if (gap === 1) gapScore += 3; else if (gap === 2) gapScore += 2; else if (gap === 3) gapScore += 1;
    }
    connectivity += (gapScore / 9) * 0.20;
  }

  const hasWrap = span <= 4 && uniqueValues.length >= 3;
  if (hasWrap && !isRundown) connectivity += 0.08;

  let hasDangler = false;
  if (uniqueValues.length === 4) {
    const gaps = [];
    for (let i = 0; i < 3; i++) gaps.push(uniqueValues[i + 1] - uniqueValues[i]);
    const maxGap = Math.max(...gaps);
    const maxGapIndex = gaps.indexOf(maxGap);
    if (maxGap >= 5 && (maxGapIndex === 0 || maxGapIndex === 2)) { hasDangler = true; connectivity -= 0.12; }
    else if (maxGap >= 4) { hasDangler = true; connectivity -= 0.06; }
  }

  let suitedness = 0;
  if (isDoubleSuited) { suitedness += 0.20; if (hasAceSuited) suitedness += 0.05; }
  else if (isSingleSuited) { suitedness += 0.10; if (hasAceSuited) suitedness += 0.03; }
  if (tripleOrMoreSuited) suitedness -= 0.08;
  if (isRainbow) suitedness -= 0.05;

  let bonus = 0;
  if (hasAA && hasKK && isDoubleSuited) bonus += 0.15;
  else if (hasAA && ranks.includes('J') && ranks.includes('T') && isDoubleSuited) bonus += 0.12;
  else if (hasKK && hasQQ && isDoubleSuited) bonus += 0.10;
  else if (hasAA && isDoubleSuited) bonus += 0.08;
  if (pairRanks.length === 2) { const pairValues = pairRanks.map(([r]) => getRankValue(r)); bonus += 0.03 + ((pairValues[0] + pairValues[1]) / 2 / 14) * 0.04; }
  if (isRundown && isDoubleSuited) bonus += 0.08;

  const score = Math.min(1, Math.max(0, nuttiness + connectivity + suitedness + bonus));
  return { score, hasPair: pairRanks.length > 0, pairRank, hasAceSuited, isDoubleSuited, isSingleSuited, isRundown, hasWrap, hasDangler };
}

// ===== 比較するハンド =====
function c(rank: Rank, suit: Suit): Card { return { rank, suit }; }

const testHands: { name: string; cards: Card[] }[] = [
  // プレミアム
  { name: 'AAKKds        ', cards: [c('A','h'), c('A','d'), c('K','h'), c('K','d')] },
  { name: 'AAJTds        ', cards: [c('A','h'), c('A','d'), c('J','h'), c('T','d')] },
  { name: 'AAxx rainbow  ', cards: [c('A','h'), c('A','d'), c('7','c'), c('3','s')] },
  { name: 'KKQQds        ', cards: [c('K','h'), c('K','d'), c('Q','h'), c('Q','d')] },

  // ハイランダウン
  { name: 'KQJTds        ', cards: [c('K','h'), c('Q','d'), c('J','h'), c('T','d')] },
  { name: 'KQJT rainbow  ', cards: [c('K','h'), c('Q','d'), c('J','c'), c('T','s')] },
  { name: 'QJT9ds        ', cards: [c('Q','h'), c('J','d'), c('T','h'), c('9','d')] },
  { name: 'JT98ds        ', cards: [c('J','h'), c('T','d'), c('9','h'), c('8','d')] },

  // ミドルランダウン
  { name: 'T987ds        ', cards: [c('T','h'), c('9','d'), c('8','h'), c('7','d')] },
  { name: '9876ds        ', cards: [c('9','h'), c('8','d'), c('7','h'), c('6','d')] },
  { name: '8765ds        ', cards: [c('8','h'), c('7','d'), c('6','h'), c('5','d')] },

  // ローランダウン
  { name: '5432ds        ', cards: [c('5','h'), c('4','d'), c('3','h'), c('2','d')] },

  // Aスーテッド系
  { name: 'AKQ5 Ass      ', cards: [c('A','h'), c('K','h'), c('Q','d'), c('5','c')] },
  { name: 'AT98ss        ', cards: [c('A','h'), c('T','h'), c('9','d'), c('8','c')] },

  // ダングラー
  { name: 'KQJ3 rainbow  ', cards: [c('K','h'), c('Q','d'), c('J','c'), c('3','s')] },
  { name: 'AAK2 rainbow  ', cards: [c('A','h'), c('A','d'), c('K','c'), c('2','s')] },

  // ウィークハンド
  { name: '7742 rainbow  ', cards: [c('7','h'), c('7','d'), c('4','c'), c('2','s')] },
  { name: 'K952 rainbow  ', cards: [c('K','h'), c('9','d'), c('5','c'), c('2','s')] },
  { name: 'Q832 rainbow  ', cards: [c('Q','h'), c('8','d'), c('3','c'), c('2','s')] },

  // ボーダーライン
  { name: 'QQ76ds        ', cards: [c('Q','h'), c('Q','d'), c('7','h'), c('6','d')] },
  { name: 'JJ98ss        ', cards: [c('J','h'), c('J','d'), c('9','h'), c('8','c')] },
  { name: 'KJ97ds        ', cards: [c('K','h'), c('J','d'), c('9','h'), c('7','d')] },
];

// ===== 出力 =====
console.log('┌──────────────────┬───────┬───────┬────────┬──────────────────────────────┐');
console.log('│ ハンド           │  旧   │  新   │  差分  │ 影響                         │');
console.log('├──────────────────┼───────┼───────┼────────┼──────────────────────────────┤');

for (const { name, cards } of testHands) {
  const oldResult = getOldEval(cards);
  const newResult = getNewEval(cards);
  const diff = newResult.score - oldResult.score;
  const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(2);

  let impact = '';
  // Check threshold crossings
  const thresholds = [
    { val: 0.75, label: 'プレミアム境界' },
    { val: 0.55, label: 'PFR境界(TAG)' },
    { val: 0.40, label: '3bet防御境界' },
    { val: 0.18, label: 'VPIP境界(LAG)' },
  ];
  for (const t of thresholds) {
    if ((oldResult.score >= t.val) !== (newResult.score >= t.val)) {
      const dir = newResult.score >= t.val ? '↑超え' : '↓割れ';
      impact += `${t.label}${dir} `;
    }
  }
  if (!impact && Math.abs(diff) >= 0.10) impact = '大きな変動';
  if (!impact && Math.abs(diff) >= 0.05) impact = '中程度の変動';

  console.log(`│ ${name} │ ${oldResult.score.toFixed(2)}  │ ${newResult.score.toFixed(2)}  │ ${diffStr.padStart(6)} │ ${(impact || '-').padEnd(28)} │`);
}

console.log('└──────────────────┴───────┴───────┴────────┴──────────────────────────────┘');

// 閾値別の判定変化サマリー
console.log('\n--- 閾値別の判定変化 ---');
console.log('(BTNポジション: +0.10, BBポジション: -0.05 を加算した effectiveStrength で判定)\n');

for (const pos of ['BTN', 'BB'] as const) {
  const posBonus = pos === 'BTN' ? 0.10 : -0.05;
  console.log(`【${pos}】`);
  for (const { name, cards } of testHands) {
    const oldScore = getOldEval(cards).score;
    const newScore = getNewEval(cards).score;
    const oldEff = Math.min(1, oldScore + posBonus);
    const newEff = Math.min(1, newScore + posBonus);

    const oldAction = oldEff > 0.75 ? 'PREMIUM' : oldEff > 0.55 ? 'RAISE  ' : oldEff > 0.18 ? 'CALL   ' : 'FOLD   ';
    const newAction = newEff > 0.85 ? 'PREMIUM' : newEff > 0.72 ? 'RAISE  ' : newEff > 0.59 ? 'CALL   ' : 'FOLD   ';

    if (oldAction !== newAction) {
      console.log(`  ${name}: ${oldAction} → ${newAction} (旧=${oldEff.toFixed(2)}, 新=${newEff.toFixed(2)})`);
    }
  }
  console.log();
}
