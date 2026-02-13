import { Card, Rank, Suit, Street } from '../types.js';
import { getRankValue } from '../deck.js';
import { evaluatePLOHand, compareHands } from '../handEvaluator.js';
import { OutsResult } from './types.js';

const ALL_SUITS: Suit[] = ['h', 'd', 'c', 's'];
const ALL_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/**
 * アウツを正確にカウントする。
 * 残りのデッキから1枚ずつ追加し、ハンドが改善するかを判定。
 * PLOの2+3ルールを厳密に適用する。
 */
export function countOuts(
  holeCards: Card[],
  communityCards: Card[],
  currentHandRank: number
): OutsResult {
  if (communityCards.length >= 5 || communityCards.length < 3) {
    return {
      flushOuts: 0, straightOuts: 0, totalOuts: 0,
      nutOuts: 0, isNutFlushDraw: false, isNutStraightDraw: false,
    };
  }

  const usedCards = new Set([
    ...holeCards.map(c => `${c.rank}${c.suit}`),
    ...communityCards.map(c => `${c.rank}${c.suit}`),
  ]);

  // 5枚フルのコミュニティが必要な場合、ダミーで埋める
  const needCards = 5 - communityCards.length;
  let totalOuts = 0;
  let nutOuts = 0;
  let flushOuts = 0;
  let straightOuts = 0;
  let isNutFlushDraw = false;
  let isNutStraightDraw = false;

  // フラッシュドロー判定用: ホール2枚+コミュニティからのスート数
  const flushDrawSuit = getFlushDrawSuit(holeCards, communityCards);

  // ストレートドロー判定用
  const hasStraightDraw = checkStraightDrawPossible(holeCards, communityCards);

  // 残りカードをスキャン
  for (const rank of ALL_RANKS) {
    for (const suit of ALL_SUITS) {
      const key = `${rank}${suit}`;
      if (usedCards.has(key)) continue;

      const testCard: Card = { rank, suit };
      const testCommunity = [...communityCards, testCard];

      // まだ5枚に足りない場合（フロップ→ターンのアウツ計算）は、
      // 現時点で追加した1枚 + ダミーカードで評価
      let evalCommunity: Card[];
      if (testCommunity.length < 5) {
        evalCommunity = padToFive(testCommunity, usedCards, key);
      } else {
        evalCommunity = testCommunity;
      }

      try {
        const newHand = evaluatePLOHand(holeCards, evalCommunity);

        // ハンドが改善した場合アウツとしてカウント
        if (newHand.rank > currentHandRank) {
          totalOuts++;

          // フラッシュアウツ判定
          if (flushDrawSuit && suit === flushDrawSuit) {
            flushOuts++;
            // ナッツフラッシュドロー: ホールにそのスートのAがある
            if (holeCards.some(c => c.suit === flushDrawSuit && c.rank === 'A')) {
              isNutFlushDraw = true;
            }
          }

          // ストレートアウツ判定（フラッシュアウツでない場合）
          if (!(flushDrawSuit && suit === flushDrawSuit) && hasStraightDraw) {
            straightOuts++;
          }

          // ナッツアウツ: rank 6(フラッシュ)以上に改善
          if (newHand.rank >= 6) {
            nutOuts++;
          }
        }
      } catch {
        // evaluatePLOHand がエラーの場合はスキップ
      }
    }
  }

  // ナッツストレートドロー判定（ストレートアウツの多くが最高ストレートを作る場合）
  if (straightOuts >= 6) {
    isNutStraightDraw = true;
  }

  return {
    flushOuts,
    straightOuts,
    totalOuts,
    nutOuts,
    isNutFlushDraw,
    isNutStraightDraw,
  };
}

/**
 * 2-4ルールでアウツからエクイティを概算。
 * フロップ (残り2枚): outs × 4% - (outs - 8)%  (8アウツ以上の補正)
 * ターン  (残り1枚): outs × 2%
 */
export function outsToEquity(outs: number, street: Street): number {
  if (outs <= 0) return 0;

  let equity: number;
  if (street === 'flop') {
    // フロップ: 2枚残り → outs × 4% (8超は補正)
    equity = outs * 0.04;
    if (outs > 8) {
      equity -= (outs - 8) * 0.01;
    }
  } else if (street === 'turn') {
    // ターン: 1枚残り → outs × 2%
    equity = outs * 0.02;
  } else {
    equity = 0;
  }

  return Math.min(0.65, Math.max(0, equity)); // 最大65%にキャップ
}

/**
 * 総合エクイティを推定。
 * メイドハンドの強さ + ドローエクイティを複合する。
 */
export function estimateHandEquity(
  holeCards: Card[],
  communityCards: Card[],
  madeHandRank: number,
  street: Street,
  numOpponents: number
): number {
  // ベースエクイティ: メイドハンドの強さ
  let baseEquity = madeHandRankToEquity(madeHandRank);

  // ドローエクイティ（リバーではドロー無し）
  let drawEquity = 0;
  if (street !== 'river' && street !== 'showdown') {
    const outs = countOuts(holeCards, communityCards, madeHandRank);
    drawEquity = outsToEquity(outs.totalOuts, street);

    // ナッツドローは額面通り、非ナッツは70%に割引
    const nutRatio = outs.totalOuts > 0 ? outs.nutOuts / outs.totalOuts : 0;
    const discount = 0.7 + nutRatio * 0.3; // 0.7 ~ 1.0
    drawEquity *= discount;
  }

  // メイドハンド + ドローの複合 (重複を避けるため単純加算ではない)
  let equity = baseEquity + drawEquity * (1 - baseEquity);

  // 対戦人数で割引
  if (numOpponents >= 3) {
    equity *= 0.75;
  } else if (numOpponents === 2) {
    equity *= 0.9;
  }

  return Math.min(1, Math.max(0, equity));
}

/**
 * メイドハンドのランクから概算エクイティに変換。
 */
function madeHandRankToEquity(rank: number): number {
  // rank 1=ハイカード, 2=ワンペア, ... 9=ストレートフラッシュ
  const equityMap: Record<number, number> = {
    0: 0.05,   // 未評価
    1: 0.10,   // ハイカード
    2: 0.25,   // ワンペア
    3: 0.50,   // ツーペア
    4: 0.60,   // スリーカード（セット）
    5: 0.70,   // ストレート
    6: 0.78,   // フラッシュ
    7: 0.88,   // フルハウス
    8: 0.95,   // フォーカード
    9: 0.99,   // ストレートフラッシュ
  };
  return equityMap[rank] ?? 0.05;
}

/**
 * フラッシュドローのスートを取得。
 * PLO: ホール2枚 + コミュニティ2枚以上の同スート → フラッシュドロー。
 */
function getFlushDrawSuit(holeCards: Card[], communityCards: Card[]): Suit | null {
  const suitInfo: Record<string, { hole: number; comm: number }> = {};
  for (const c of holeCards) {
    suitInfo[c.suit] = suitInfo[c.suit] || { hole: 0, comm: 0 };
    suitInfo[c.suit].hole++;
  }
  for (const c of communityCards) {
    suitInfo[c.suit] = suitInfo[c.suit] || { hole: 0, comm: 0 };
    suitInfo[c.suit].comm++;
  }

  for (const [suit, info] of Object.entries(suitInfo)) {
    // PLO: ホール2枚以上 + 合計4枚以上（完成は5枚）
    if (info.hole >= 2 && info.hole + info.comm === 4) {
      return suit as Suit;
    }
  }
  return null;
}

/**
 * ストレートドローが可能かチェック（簡易版）。
 */
function checkStraightDrawPossible(holeCards: Card[], communityCards: Card[]): boolean {
  const allValues = [...new Set([
    ...holeCards.map(c => getRankValue(c.rank)),
    ...communityCards.map(c => getRankValue(c.rank)),
  ])].sort((a, b) => a - b);

  const holeValues = new Set(holeCards.map(c => getRankValue(c.rank)));

  // 5連続のウィンドウで4枚揃っているかチェック
  for (let high = 14; high >= 5; high--) {
    let count = 0;
    let holeUsed = 0;
    for (let v = high; v > high - 5; v--) {
      const checkVal = v <= 0 ? v + 14 : v; // Aの低い使い方
      if (allValues.includes(checkVal)) {
        count++;
        if (holeValues.has(checkVal)) holeUsed++;
      }
    }
    if (count >= 4 && holeUsed >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * コミュニティカードを5枚に埋める（評価用ダミー）。
 * 使用済みカードを避けて最も低いランクのカードで埋める。
 */
function padToFive(community: Card[], usedCards: Set<string>, extraUsed: string): Card[] {
  if (community.length >= 5) return community.slice(0, 5);

  const result = [...community];
  const allUsed = new Set(usedCards);
  allUsed.add(extraUsed);
  for (const c of result) {
    allUsed.add(`${c.rank}${c.suit}`);
  }

  for (const rank of ALL_RANKS) {
    for (const suit of ALL_SUITS) {
      const key = `${rank}${suit}`;
      if (!allUsed.has(key) && result.length < 5) {
        result.push({ rank, suit });
        allUsed.add(key);
      }
      if (result.length >= 5) break;
    }
    if (result.length >= 5) break;
  }
  return result;
}
