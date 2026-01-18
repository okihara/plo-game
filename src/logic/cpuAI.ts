import { GameState, Action, Card, Rank } from './types';
import { getValidActions } from './gameEngine';
import { getRankValue } from './deck';

// シンプルなCPU AI
export function getCPUAction(state: GameState, playerIndex: number): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const validActions = getValidActions(state, playerIndex);

  if (validActions.length === 0) {
    return { action: 'fold', amount: 0 };
  }

  const handStrength = evaluatePreFlopStrength(player.holeCards);
  const streetMultiplier = getStreetMultiplier(state.currentStreet);
  const positionBonus = getPositionBonus(player.position);

  const effectiveStrength = handStrength * streetMultiplier + positionBonus;

  const random = Math.random();
  const toCall = state.currentBet - player.currentBet;
  const potOdds = toCall / (state.pot + toCall);

  // 強いハンド
  if (effectiveStrength > 0.7) {
    // レイズ/ベットを試みる
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction && random > 0.3) {
      const raiseAmount = calculateRaiseAmount(state, raiseAction.minAmount, raiseAction.maxAmount, effectiveStrength);
      return { action: raiseAction.action, amount: raiseAmount };
    }
    // コールまたはチェック
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
  }

  // 中程度のハンド
  if (effectiveStrength > 0.4) {
    // ポットオッズが良ければコール
    if (potOdds < effectiveStrength) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // たまにブラフ
    if (random > 0.85) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction) {
        return { action: raiseAction.action, amount: raiseAction.minAmount };
      }
    }
  }

  // 弱いハンド
  // チェックできればチェック
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  // ポットオッズが非常に良い場合はコール
  if (potOdds < 0.15 && random > 0.5) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction && callAction.minAmount < player.chips * 0.1) {
      return { action: 'call', amount: callAction.minAmount };
    }
  }

  // フォールド
  return { action: 'fold', amount: 0 };
}

// プリフロップ評価の詳細情報
export interface PreFlopEvaluation {
  score: number;           // 総合スコア (0-1)
  hasPair: boolean;        // ペアがあるか
  pairRank: string | null; // ペアのランク (例: "AA", "KK")
  hasAceSuited: boolean;   // Aスーテッドがあるか
  isDoubleSuited: boolean; // ダブルスーテッドか
  isSingleSuited: boolean; // シングルスーテッドか
  isRundown: boolean;      // ランダウン（連続4枚）か
  hasWrap: boolean;        // ラップ可能性（密なハンド）
  hasDangler: boolean;     // ダングラー（孤立カード）があるか
}

export function evaluatePreFlopStrength(holeCards: Card[]): number {
  return getPreFlopEvaluation(holeCards).score;
}

export function getPreFlopEvaluation(holeCards: Card[]): PreFlopEvaluation {
  // PLOハンド評価 - 3つの主要要素: ナッティネス、コネクティビティ、スーテッドネス

  const values = holeCards.map(c => getRankValue(c.rank));
  const suits = holeCards.map(c => c.suit);
  const ranks = holeCards.map(c => c.rank);

  // ランクとスーツのカウント
  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<string, number>();
  for (let i = 0; i < 4; i++) {
    rankCounts.set(ranks[i], (rankCounts.get(ranks[i]) || 0) + 1);
    suitCounts.set(suits[i], (suitCounts.get(suits[i]) || 0) + 1);
  }

  // === 1. ナッティネス (0-0.4) ===
  // ナッツになりやすいハンドを評価
  let nuttiness = 0;

  // ハイペア（AA, KK, QQ, JJ）
  const pairRanks = Array.from(rankCounts.entries()).filter(([_, count]) => count >= 2);
  let pairRank: string | null = null;
  for (const [rank, count] of pairRanks) {
    const pairValue = getRankValue(rank);
    if (count >= 2) {
      // AAは最強、KK, QQ, JJも強い
      nuttiness += (pairValue / 14) * 0.15;
      if (rank === 'A' && count === 2) nuttiness += 0.1; // AAボーナス
      if (!pairRank || pairValue > getRankValue(pairRank[0] as Rank)) {
        pairRank = rank + rank;
      }
    }
  }

  // Aを持っているか（ナッツフラッシュの可能性）
  const hasAce = ranks.includes('A');
  let hasAceSuited = false;
  if (hasAce) {
    // Aが同じスーツの他のカードとペアになっているか
    const aceIndex = ranks.indexOf('A');
    const aceSuit = suits[aceIndex];
    hasAceSuited = suits.filter((s, i) => s === aceSuit && i !== aceIndex).length > 0;
    if (hasAceSuited) nuttiness += 0.08; // ナッツフラッシュドローの可能性
  }

  // ハイカードの平均値
  const avgValue = values.reduce((a, b) => a + b, 0) / 4;
  nuttiness += (avgValue - 7) / 14 * 0.1;

  // === 2. コネクティビティ (0-0.35) ===
  // カード間のつながりを評価
  let connectivity = 0;
  const sortedValues = [...values].sort((a, b) => a - b);
  const uniqueValues = [...new Set(sortedValues)];

  // ギャップを評価（小さいほど良い）
  let totalGap = 0;
  let connections = 0;
  for (let i = 0; i < uniqueValues.length - 1; i++) {
    const gap = uniqueValues[i + 1] - uniqueValues[i];
    if (gap <= 4) {
      // gap 1 = 連続, gap 2 = 1ギャップ, gap 3 = 2ギャップ, gap 4 = 3ギャップ
      connections++;
      totalGap += gap;
    }
  }

  if (connections > 0) {
    // 連続性スコア: 多くのカードが近いほど高い
    const avgGap = totalGap / connections;
    connectivity += (connections / 3) * (1 - (avgGap - 1) / 4) * 0.25;
  }

  // ラップ可能性（KQJT, JT98など）
  const span = uniqueValues[uniqueValues.length - 1] - uniqueValues[0];
  const hasWrap = span <= 4 && uniqueValues.length >= 3;
  if (hasWrap) {
    connectivity += 0.1; // 密なハンドボーナス
  }

  // ダングラー（孤立したカード）のペナルティ
  let hasDangler = false;
  if (uniqueValues.length === 4) {
    const gaps = [];
    for (let i = 0; i < 3; i++) {
      gaps.push(uniqueValues[i + 1] - uniqueValues[i]);
    }
    // 1枚だけ離れている場合（例: KQJ5の5）
    const maxGap = Math.max(...gaps);
    if (maxGap >= 5) {
      hasDangler = true;
      connectivity -= 0.08; // ダングラーペナルティ
    }
  }

  // === 3. スーテッドネス (0-0.25) ===
  let suitedness = 0;
  const suitCountValues = Array.from(suitCounts.values());

  // ダブルスーテッド（2-2）が最強
  const isDoubleSuited = suitCountValues.filter(c => c === 2).length === 2;
  if (isDoubleSuited) {
    suitedness += 0.2;
  } else {
    // シングルスーテッド（2枚同じスーツ）
    const isSingleSuited = suitCountValues.some(c => c === 2);
    if (isSingleSuited) {
      suitedness += 0.1;
    }
  }

  // 3枚以上同じスーツはペナルティ（アウツが減る）
  const tripleOrMoreSuited = suitCountValues.some(c => c >= 3);
  if (tripleOrMoreSuited) {
    suitedness -= 0.05;
  }

  // レインボー（全て異なるスーツ）は弱い
  const isRainbow = suitCountValues.every(c => c === 1);
  if (isRainbow) {
    suitedness -= 0.05;
  }

  // === 特別なハンドパターン ===
  let bonus = 0;

  // AAxx ダブルスーテッド
  if (rankCounts.get('A') === 2 && isDoubleSuited) {
    bonus += 0.1;
  }

  // ランダウン（連続4枚: KQJT, JT98など）
  const isRundown = uniqueValues.length === 4 && span === 3;
  if (isRundown) {
    bonus += 0.08;
  }

  // ペアが2つ（例: KKQQ）
  if (pairRanks.length === 2) {
    bonus += 0.05;
  }

  // 合計スコア
  const totalScore = nuttiness + connectivity + suitedness + bonus;
  const score = Math.min(1, Math.max(0, totalScore));

  const isSingleSuited = !isDoubleSuited && suitCountValues.some(c => c === 2);

  return {
    score,
    hasPair: pairRanks.length > 0,
    pairRank,
    hasAceSuited,
    isDoubleSuited,
    isSingleSuited,
    isRundown,
    hasWrap,
    hasDangler,
  };
}

function getStreetMultiplier(street: string): number {
  switch (street) {
    case 'preflop': return 0.8;
    case 'flop': return 0.9;
    case 'turn': return 1.0;
    case 'river': return 1.1;
    default: return 1.0;
  }
}

function getPositionBonus(position: string): number {
  switch (position) {
    case 'BTN': return 0.1;
    case 'CO': return 0.08;
    case 'HJ': return 0.05;
    case 'UTG': return 0;
    case 'BB': return -0.05;
    case 'SB': return -0.05;
    default: return 0;
  }
}

function calculateRaiseAmount(
  state: GameState,
  minAmount: number,
  maxAmount: number,
  strength: number
): number {
  // ポットサイズを基準にレイズ額を決定
  const potSizeRaise = state.pot * (0.5 + strength * 0.5);
  const targetAmount = Math.max(minAmount, Math.min(maxAmount, potSizeRaise));

  // 少しランダム性を加える
  const variance = (Math.random() - 0.5) * 0.2;
  const finalAmount = targetAmount * (1 + variance);

  return Math.round(Math.max(minAmount, Math.min(maxAmount, finalAmount)));
}
