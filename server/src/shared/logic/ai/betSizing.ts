import { Street } from '../types.js';
import { BetSizingContext, ExtendedBoardTexture, ExtendedHandEval, BotPersonality } from './types.js';

/**
 * 状況に応じた最適ベットサイズを決定する。
 * 返り値はポットに対する倍率 (例: 0.5 = ポットの50%)。
 */
export function decideBetSize(context: BetSizingContext): number {
  const { pot, street, spr, boardTexture, handEval, isAggressor, numOpponents, personality } = context;

  let sizePct: number;

  if (isAggressor && isCbetSituation(street, isAggressor)) {
    sizePct = cbetSize(boardTexture, handEval, numOpponents);
  } else if (handEval.madeHandRank >= 5 || handEval.isNuts || handEval.isNearNuts) {
    sizePct = valueBetSize(boardTexture, handEval, spr);
  } else if (handEval.hasFlushDraw || handEval.hasWrapDraw || handEval.hasStraightDraw) {
    sizePct = semiBluffSize(handEval, boardTexture);
  } else if (handEval.madeHandRank >= 3) {
    sizePct = mediumHandSize(boardTexture, spr);
  } else {
    sizePct = bluffSize(boardTexture);
  }

  // パーソナリティ補正: aggression で ±15% 変動
  const aggressionMod = (personality.aggression - 0.7) * 0.2; // 0.7が基準
  sizePct += aggressionMod;

  // ランダム変動 ±5%（予測困難にする）
  sizePct += (Math.random() - 0.5) * 0.1;

  // クランプ: 最小25%、最大110%（ポットリミットなのでこれ以上は別途制限される）
  sizePct = Math.max(0.25, Math.min(1.1, sizePct));

  return sizePct;
}

/**
 * ベットサイズをポット倍率から実際の金額に変換。
 * validActionsの制約範囲にクランプする。
 */
export function calculateBetAmount(
  sizePct: number,
  pot: number,
  minAmount: number,
  maxAmount: number
): number {
  const rawAmount = Math.floor(pot * sizePct);
  return Math.max(minAmount, Math.min(maxAmount, rawAmount));
}

// === 状況別ベットサイズ ===

function isCbetSituation(street: Street, isAggressor: boolean): boolean {
  return isAggressor && (street === 'flop' || street === 'turn');
}

/**
 * Cベットサイズ
 * ドライボード: 小さめ (33-50%)  ← 安いフォールドエクイティ
 * ウェットボード: 大きめ (60-80%) ← ドローにプレミアムを課す
 */
function cbetSize(
  boardTexture: ExtendedBoardTexture,
  handEval: ExtendedHandEval,
  numOpponents: number
): number {
  let size: number;

  if (boardTexture.isWet) {
    size = 0.65 + Math.random() * 0.15; // 65-80%
  } else {
    size = 0.33 + Math.random() * 0.17; // 33-50%
  }

  // マルチウェイは少し大きめ（プロテクション）
  if (numOpponents >= 2) {
    size += 0.10;
  }

  // 強い手なら大きめ（バリューCベット）
  if (handEval.madeHandRank >= 3) {
    size += 0.05;
  }

  return size;
}

/**
 * バリューベットサイズ
 * ウェットボード: 大きめ (75-100%) ← プロテクション + 最大バリュー
 * ドライボード: 小さめ (50-65%)   ← コールレンジを広げる
 */
function valueBetSize(
  boardTexture: ExtendedBoardTexture,
  handEval: ExtendedHandEval,
  spr: number
): number {
  let size: number;

  if (boardTexture.isWet) {
    size = 0.75 + Math.random() * 0.25; // 75-100%
  } else {
    size = 0.50 + Math.random() * 0.15; // 50-65%
  }

  // ナッツ級は大きめ
  if (handEval.isNuts) {
    size += 0.10;
  }

  // 低SPRでは大きめ（スタックをコミットさせる）
  if (spr < 4) {
    size += 0.15;
  }

  return size;
}

/**
 * セミブラフサイズ (60-85%)
 * フォールドエクイティとドローエクイティの両方を狙う
 */
function semiBluffSize(
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture
): number {
  let size = 0.60 + Math.random() * 0.15; // 60-75%

  // ラップドローなど強いドローは大きめ
  if (handEval.hasWrapDraw || handEval.drawStrength > 0.4) {
    size += 0.10;
  }

  // ウェットボードでは大きめ
  if (boardTexture.isWet) {
    size += 0.05;
  }

  return size;
}

/**
 * ミディアムハンドのサイズ (ポットコントロール)
 * 25-40%: ポットを制御しつつバリューを取る
 */
function mediumHandSize(
  boardTexture: ExtendedBoardTexture,
  spr: number
): number {
  let size = 0.30 + Math.random() * 0.10; // 30-40%

  // ドライボードではさらに小さめ
  if (!boardTexture.isWet) {
    size -= 0.05;
  }

  // 高SPRではポットコントロール重視
  if (spr > 10) {
    size -= 0.05;
  }

  return Math.max(0.25, size);
}

/**
 * ブラフサイズ (50-75%)
 * フォールドエクイティを確保しつつ、リスクを抑える
 */
function bluffSize(boardTexture: ExtendedBoardTexture): number {
  let size = 0.50 + Math.random() * 0.15; // 50-65%

  // 怖いボードではやや大きめ（説得力を持たせる）
  if (boardTexture.flushPossible || boardTexture.isPaired) {
    size += 0.10;
  }

  return size;
}
