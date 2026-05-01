// PLO5 (5枚ホールカード版オマハ) のプリフロップハンド評価。
// PLO の preflopEquity.json は 4 枚専用で再計算コストが高いため、
// 5 枚から特徴量を抽出する単純な線形スコアで近似する。
// 戻り値は PLO の getPreFlopEvaluation と同形 (PreFlopEvaluation) を返し、
// 既存の preflopStrategy.ts のロジック (AAxx 判定・hasDangler 判定等) を流用できるようにする。
//
// 精度は equity 表ベースの PLO 評価に劣るが、Bot が最弱判定で全フォールドする
// silent fallback を防ぐのが第一目的。Phase 7 の実機ログで継続調整する。

import { Card, Rank } from '../types.js';
import { getRankValue } from '../deck.js';
import { PreFlopEvaluation } from '../preflopEquity.js';

const EMPTY_RESULT: PreFlopEvaluation = {
  score: 0, hasPair: false, pairRank: null, hasAceSuited: false,
  isDoubleSuited: false, isSingleSuited: false, isRundown: false,
  hasWrap: false, hasDangler: false,
};

export function evaluatePreflopPLO5(holeCards: Card[]): PreFlopEvaluation {
  const valid = holeCards.filter(c => c && c.rank && c.suit);
  if (valid.length !== 5) return { ...EMPTY_RESULT };

  const values = valid.map(c => getRankValue(c.rank)).sort((a, b) => b - a);

  // ランク別カウント (ペア検出)
  const rankCounts = new Map<Rank, number>();
  for (const c of valid) rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);

  let pairCount = 0;
  let topPairValue = 0;
  let topPairRank: Rank | null = null;
  for (const [rank, cnt] of rankCounts) {
    if (cnt >= 2) {
      pairCount++;
      const v = getRankValue(rank);
      if (v > topPairValue) { topPairValue = v; topPairRank = rank; }
    }
  }
  const hasPair = pairCount > 0;

  // スーツ別カウント
  const suitCounts = new Map<string, number>();
  for (const c of valid) suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  const sortedSuitCounts = [...suitCounts.values()].sort((a, b) => b - a);
  const maxSuitCount = sortedSuitCounts[0] ?? 0;
  const secondSuitCount = sortedSuitCounts[1] ?? 0;

  const isDoubleSuited = maxSuitCount >= 2 && secondSuitCount >= 2;
  const isSingleSuited = maxSuitCount >= 2 && !isDoubleSuited;

  // A スーテッド (A と同スートのカードが 1 枚以上)
  const hasAceSuited = valid.some(
    c => c.rank === 'A' && (suitCounts.get(c.suit) ?? 0) >= 2
  );

  // コネクテッドネス: ユニークなランク値の最大スパン (A=14)
  const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
  // ハイ側 4 枚の span (PLO のラップ判定相当)
  const top4Span = uniqueValues.length >= 4
    ? uniqueValues[0] - uniqueValues[3]
    : Infinity;
  // 全体 span (5 枚のランダウン判定)
  const fullSpan = uniqueValues.length >= 5
    ? uniqueValues[0] - uniqueValues[4]
    : Infinity;

  const isRundown = uniqueValues.length >= 5 && fullSpan <= 5;
  const hasWrap = top4Span <= 4;

  // ダングラー: 隣接ランク差が 4 以上 (A→2 の wheel 部分は除く)
  let hasDangler = false;
  for (let i = 0; i < uniqueValues.length - 1; i++) {
    if (uniqueValues[i] - uniqueValues[i + 1] >= 4) {
      hasDangler = true;
      break;
    }
  }

  // === スコア計算 ===
  // PLO5 は手の組合せ数が増えるためベースラインを PLO より高めに設定
  let score = 0.30;

  // ペア
  if (pairCount >= 1) {
    if (topPairValue >= 13) score += 0.30;       // AA / KK
    else if (topPairValue >= 11) score += 0.18;  // QQ / JJ
    else if (topPairValue >= 9) score += 0.10;   // TT / 99
    else score += 0.05;
  }
  if (pairCount >= 2) score += 0.05;             // ダブルペア

  // スーツ
  if (isDoubleSuited) score += 0.12;
  else if (isSingleSuited) score += 0.06;
  if (hasAceSuited) score += 0.04;

  // コネクテッドネス
  if (isRundown && !hasDangler) score += 0.15;
  else if (isRundown) score += 0.08;
  if (hasWrap && !isRundown) score += 0.05;

  // ハイカード密度 (T 以上)
  const highCardCount = values.filter(v => v >= 10).length;
  score += highCardCount * 0.02;

  // ダングラーペナルティ
  if (hasDangler) score -= 0.05;

  score = Math.max(0, Math.min(1, score));

  return {
    score,
    hasPair,
    pairRank: topPairRank,
    hasAceSuited,
    isDoubleSuited,
    isSingleSuited,
    isRundown,
    hasWrap,
    hasDangler,
  };
}

export function evaluatePreflopStrengthPLO5(holeCards: Card[]): number {
  return evaluatePreflopPLO5(holeCards).score;
}
