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
  // PLOハンド評価 - 記事に基づく3つの主要要素:
  // 1. Nuttiness（ナッツ性）: ナッツを作れる可能性
  // 2. Connectedness（連結性）: カードの繋がり具合
  // 3. Suitedness（スート性）: フラッシュドローの価値

  const values = holeCards.map(c => getRankValue(c.rank));
  const suits = holeCards.map(c => c.suit);
  const ranks = holeCards.map(c => c.rank);

  // ランクとスーツのカウント
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

  // スーテッドネスの判定
  const isDoubleSuited = suitCountValues.filter(c => c === 2).length === 2;
  const isSingleSuited = !isDoubleSuited && suitCountValues.some(c => c === 2);
  const tripleOrMoreSuited = suitCountValues.some(c => c >= 3);
  const isRainbow = suitCountValues.every(c => c === 1);

  // ペア情報
  const pairRanks = Array.from(rankCounts.entries()).filter(([_, count]) => count >= 2);
  let pairRank: string | null = null;
  for (const [rank] of pairRanks) {
    const pairValue = getRankValue(rank);
    if (!pairRank || pairValue > getRankValue(pairRank[0] as Rank)) {
      pairRank = rank + rank;
    }
  }

  // Aスーテッドの判定（重要: ナッツフラッシュ+ブラフ価値）
  const hasAce = ranks.includes('A');
  let hasAceSuited = false;
  let aceHighFlushDrawCount = 0;
  if (hasAce) {
    for (const [, cards] of suitToCards.entries()) {
      if (cards.some(c => c.rank === 'A') && cards.length >= 2) {
        hasAceSuited = true;
        aceHighFlushDrawCount++;
      }
    }
  }

  // === 1. ナッティネス (0-0.45) ===
  // PLOでは平均的なショーダウンハンドがホールデムより強い
  // ナッツを作れるハンドを高く評価
  let nuttiness = 0;

  // ハイペア評価（AA > KK > QQ > JJ）
  const hasAA = rankCounts.get('A') === 2;
  const hasKK = rankCounts.get('K') === 2;
  const hasQQ = rankCounts.get('Q') === 2;
  const hasJJ = rankCounts.get('J') === 2;

  if (hasAA) {
    nuttiness += 0.25; // AAはPLOで最もナッティなペア
  } else if (hasKK) {
    nuttiness += 0.18;
  } else if (hasQQ) {
    nuttiness += 0.14;
  } else if (hasJJ) {
    nuttiness += 0.10;
  } else if (pairRanks.length > 0) {
    // その他のペア
    const highestPairValue = Math.max(...pairRanks.map(([r]) => getRankValue(r)));
    nuttiness += (highestPairValue / 14) * 0.08;
  }

  // Aスーテッド: ナッツフラッシュドロー + ブラフ時にAを持つ価値
  // 記事: "having an Ace in a certain suit has additional merit"
  if (aceHighFlushDrawCount >= 2) {
    nuttiness += 0.12; // 2つのナッツフラッシュドロー
  } else if (aceHighFlushDrawCount === 1) {
    nuttiness += 0.08;
  }

  // ハイカード平均値（ナッツストレートの可能性）
  const avgValue = values.reduce((a, b) => a + b, 0) / 4;
  nuttiness += Math.max(0, (avgValue - 8) / 14 * 0.08);

  // === 2. コネクティビティ (0-0.35) ===
  // 記事: "KQJT, JT98 or even JT87 realize their postflop equity exceptionally efficiently"
  let connectivity = 0;

  // ランダウン判定（連続4枚: KQJT, JT98など）
  const isRundown = uniqueValues.length === 4 && span === 3;
  if (isRundown) {
    // ハイランダウン（AKQJ, KQJT）は特に強い
    const minValue = uniqueValues[0];
    if (minValue >= 10) {
      connectivity += 0.30; // ブロードウェイランダウン
    } else if (minValue >= 7) {
      connectivity += 0.25; // ミドルランダウン
    } else {
      connectivity += 0.18; // ローランダウン
    }
  } else {
    // ラップ可能性（4枚中3枚以上が連続または近い）
    let gapScore = 0;
    for (let i = 0; i < uniqueValues.length - 1; i++) {
      const gap = uniqueValues[i + 1] - uniqueValues[i];
      if (gap === 1) gapScore += 3;      // 連続
      else if (gap === 2) gapScore += 2; // 1ギャップ
      else if (gap === 3) gapScore += 1; // 2ギャップ
    }
    connectivity += (gapScore / 9) * 0.20;
  }

  // ラップドロー可能性（密なハンド）
  const hasWrap = span <= 4 && uniqueValues.length >= 3;
  if (hasWrap && !isRundown) {
    connectivity += 0.08;
  }

  // ダングラー（孤立したカード）のペナルティ
  // 記事: "Dangler is a card that does not connect (like 5 in KQJ5)"
  let hasDangler = false;
  if (uniqueValues.length === 4) {
    const gaps = [];
    for (let i = 0; i < 3; i++) {
      gaps.push(uniqueValues[i + 1] - uniqueValues[i]);
    }
    const maxGap = Math.max(...gaps);
    const maxGapIndex = gaps.indexOf(maxGap);

    // 端のカードが大きく離れている場合のみダングラー
    if (maxGap >= 5 && (maxGapIndex === 0 || maxGapIndex === 2)) {
      hasDangler = true;
      connectivity -= 0.12; // ダングラーペナルティ強化
    } else if (maxGap >= 4) {
      hasDangler = true;
      connectivity -= 0.06;
    }
  }

  // === 3. スーテッドネス (0-0.25) ===
  // 記事: "What's even better than connected Omaha hands? Double suited hands"
  let suitedness = 0;

  if (isDoubleSuited) {
    suitedness += 0.20;
    // ダブルスーテッドでAスーテッドなら追加ボーナス
    if (hasAceSuited) {
      suitedness += 0.05;
    }
  } else if (isSingleSuited) {
    suitedness += 0.10;
    // シングルスーテッドでAスーテッドなら追加ボーナス
    if (hasAceSuited) {
      suitedness += 0.03;
    }
  }

  // 記事: "having more cards in the same suit cuts the number of your outs"
  if (tripleOrMoreSuited) {
    suitedness -= 0.08; // ペナルティ強化
  }

  // レインボーは弱い（フルリングでは厳しい）
  if (isRainbow) {
    suitedness -= 0.05;
  }

  // === 特別なプレミアムハンドパターン ===
  // 記事に基づくトップハンド評価
  let bonus = 0;

  // AAKKds - 最強ハンド（67% vs all hands）
  if (hasAA && hasKK && isDoubleSuited) {
    bonus += 0.15;
  }
  // AAJTds - 2番目に強い（AAKKdsに対して48%）
  else if (hasAA && ranks.includes('J') && ranks.includes('T') && isDoubleSuited) {
    bonus += 0.12;
  }
  // KKQQds - 強いダブルペア
  else if (hasKK && hasQQ && isDoubleSuited) {
    bonus += 0.10;
  }
  // AAxx ダブルスーテッド
  else if (hasAA && isDoubleSuited) {
    bonus += 0.08;
  }

  // ダブルペア（例: KKQQ, JJTT）
  if (pairRanks.length === 2) {
    const pairValues = pairRanks.map(([r]) => getRankValue(r));
    const avgPairValue = (pairValues[0] + pairValues[1]) / 2;
    bonus += 0.03 + (avgPairValue / 14) * 0.04;
  }

  // ランダウン + ダブルスーテッド
  if (isRundown && isDoubleSuited) {
    bonus += 0.08;
  }

  // 合計スコア（最大1.0）
  const totalScore = nuttiness + connectivity + suitedness + bonus;
  const score = Math.min(1, Math.max(0, totalScore));

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
