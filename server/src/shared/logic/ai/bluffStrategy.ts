import { GameState, Action, Street, GameAction } from '../types.js';
import {
  ExtendedHandEval,
  ExtendedBoardTexture,
  BlockerAnalysis,
  BotPersonality,
  BluffType,
  StreetHistory,
  OpponentModel,
} from './types.js';
import { bluffBlockerValue } from './blockerAnalysis.js';
import { boardScaryness } from './boardAnalysis.js';

interface BluffDecision {
  shouldBluff: boolean;
  type: BluffType;
  confidence: number; // 0-1: ブラフを実行する確信度
}

/**
 * ブラフすべきかを判断する。
 * 旧ロジックとの主な違い:
 * - currentBet > 0 でもブラフレイズを検討
 * - ブロッカーベースのブラフ
 * - セミブラフの精密化
 * - プローブベット
 * - パーソナリティによるブラフ頻度調整
 */
export function evaluateBluff(
  state: GameState,
  playerIndex: number,
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  streetHistory: StreetHistory,
  personality: BotPersonality,
  positionBonus: number,
  opponentModel?: OpponentModel
): BluffDecision {
  const player = state.players[playerIndex];
  const street = state.currentStreet;
  const toCall = state.currentBet - player.currentBet;
  const hasPosition = positionBonus >= 0.08;
  const activePlayers = state.players.filter(p => !p.isSittingOut && !p.folded).length;

  // リバーで弱い手 + ブロッカーあり → ブロッカーベースブラフ
  if (street === 'river' && handEval.madeHandRank <= 2) {
    return evaluateRiverBluff(state, playerIndex, handEval, boardTexture, personality, hasPosition);
  }

  // セミブラフ: ドローがある場合
  if (handEval.hasFlushDraw || handEval.hasStraightDraw || handEval.hasWrapDraw) {
    return evaluateSemiBluff(state, playerIndex, handEval, boardTexture, personality, hasPosition, street);
  }

  // プローブベット: 相手がCベットをミスした場合
  if (toCall === 0 && streetHistory.preflopAggressor !== null &&
      streetHistory.preflopAggressor !== playerIndex && street === 'flop') {
    return evaluateProbeBet(state, playerIndex, boardTexture, personality, hasPosition, opponentModel);
  }

  // ピュアブラフ: ポジションがあり、ボードが怖い場合
  if (toCall === 0 && handEval.madeHandRank <= 1) {
    return evaluatePureBluff(state, playerIndex, handEval, boardTexture, personality, hasPosition, activePlayers);
  }

  return { shouldBluff: false, type: 'pure_bluff', confidence: 0 };
}

/**
 * リバーブラフ: ブロッカーベースの判断。
 * 自分がナッツハンドをブロックしている場合にブラフする。
 */
function evaluateRiverBluff(
  state: GameState,
  playerIndex: number,
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  personality: BotPersonality,
  hasPosition: boolean
): BluffDecision {
  const player = state.players[playerIndex];
  const toCall = state.currentBet - player.currentBet;

  // すでにベットに直面している場合はブラフレイズの判断
  const isFacingBet = toCall > 0;

  let bluffChance = personality.bluffFreq;

  // ブロッカー価値
  const blockerValue = handEval.blockerScore;
  bluffChance += blockerValue * 0.20; // ブロッカー強 → ブラフ率UP

  // ポジション
  if (hasPosition) bluffChance += 0.08;

  // 怖いボード（フラッシュ完成、ペアボード）はブラフの説得力UP
  const scary = boardScaryness(boardTexture);
  bluffChance += scary * 0.10;

  // ベットに直面している場合はブラフレイズの閾値が高い
  if (isFacingBet) {
    bluffChance *= 0.4; // ブラフレイズは頻度を大幅に下げる

    // スタックが少ない場合はブラフしない
    if (player.chips < state.pot * 0.5) {
      return { shouldBluff: false, type: 'pure_bluff', confidence: 0 };
    }
  }

  const roll = Math.random();
  return {
    shouldBluff: roll < bluffChance,
    type: 'pure_bluff',
    confidence: bluffChance,
  };
}

/**
 * セミブラフ: ドローをベースにした攻撃的プレイ。
 * フォールドエクイティ + ドローエクイティで判断。
 */
function evaluateSemiBluff(
  state: GameState,
  playerIndex: number,
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  personality: BotPersonality,
  hasPosition: boolean,
  street: Street
): BluffDecision {
  const player = state.players[playerIndex];
  const toCall = state.currentBet - player.currentBet;

  // リバーではセミブラフ不可（ドローが引けない）
  if (street === 'river') {
    return { shouldBluff: false, type: 'semi_bluff', confidence: 0 };
  }

  let semiBluffChance = 0;

  // ラップドロー（8アウツ以上）は高頻度でセミブラフ
  if (handEval.hasWrapDraw) {
    semiBluffChance = 0.55 + personality.aggression * 0.15;
  }
  // ナッツフラッシュドロー
  else if (handEval.hasFlushDraw && handEval.drawStrength >= 0.4) {
    semiBluffChance = 0.50 + personality.aggression * 0.12;
  }
  // 通常のフラッシュドロー
  else if (handEval.hasFlushDraw) {
    semiBluffChance = 0.30 + personality.aggression * 0.10;
  }
  // ストレートドロー
  else if (handEval.hasStraightDraw) {
    semiBluffChance = 0.25 + personality.aggression * 0.10;
  }

  // ポジション補正
  if (hasPosition) semiBluffChance += 0.10;

  // 既にベットに直面している場合はセミブラフレイズの閾値UP
  if (toCall > 0) {
    semiBluffChance *= 0.6;
    // ポットに対して大きなベットに直面 → 抑制
    if (toCall > state.pot * 0.5) {
      semiBluffChance *= 0.5;
    }
  }

  // ターンはフロップよりセミブラフ頻度を下げる（残り1枚）
  if (street === 'turn') {
    semiBluffChance *= 0.7;
  }

  const roll = Math.random();
  return {
    shouldBluff: roll < semiBluffChance,
    type: 'semi_bluff',
    confidence: semiBluffChance,
  };
}

/**
 * プローブベット: 相手がCベットをミスした（チェックした）場合。
 * アグレッサーがCベットしなかった → 弱さのシグナル → 攻めるチャンス。
 */
function evaluateProbeBet(
  state: GameState,
  playerIndex: number,
  boardTexture: ExtendedBoardTexture,
  personality: BotPersonality,
  hasPosition: boolean,
  opponentModel?: OpponentModel
): BluffDecision {
  let probeChance = personality.bluffFreq * 1.5; // ベースのブラフ頻度の1.5倍

  // ポジションがあれば有利
  if (hasPosition) probeChance += 0.10;

  // ドライボードではプローブが効きやすい
  if (!boardTexture.isWet) probeChance += 0.08;

  // 怖いボードではプローブの説得力UP
  if (boardTexture.flushPossible || boardTexture.isPaired) {
    probeChance += 0.05;
  }

  // ヘッズアップの方がプローブが効く
  const activePlayers = state.players.filter(p => !p.isSittingOut && !p.folded).length;
  if (activePlayers === 2) probeChance += 0.08;

  const roll = Math.random();
  return {
    shouldBluff: roll < probeChance,
    type: 'probe_bet',
    confidence: probeChance,
  };
}

/**
 * ピュアブラフ: 何もない手でのブラフ。
 * ポジション、ボードテクスチャ、相手の数で判断。
 */
function evaluatePureBluff(
  state: GameState,
  playerIndex: number,
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  personality: BotPersonality,
  hasPosition: boolean,
  activePlayers: number
): BluffDecision {
  const player = state.players[playerIndex];

  let bluffChance = personality.bluffFreq;

  // ポジション
  if (hasPosition) bluffChance += 0.08;

  // ヘッズアップは有利
  if (activePlayers === 2) bluffChance += 0.05;

  // 3人以上は大幅に抑制
  if (activePlayers >= 3) bluffChance *= 0.3;

  // 怖いボード（フラッシュ完成、ペアなど）
  const scary = boardScaryness(boardTexture);
  bluffChance += scary * 0.08;

  // ブロッカー価値
  bluffChance += handEval.blockerScore * 0.10;

  // スタックが少ない場合はブラフしにくい
  if (player.chips < state.pot) bluffChance *= 0.3;

  const roll = Math.random();
  return {
    shouldBluff: roll < bluffChance,
    type: 'pure_bluff',
    confidence: bluffChance,
  };
}

/**
 * ダブル/トリプルバレルすべきかの判断。
 * 前のストリートでベットした後、次のストリートでもベットを続けるか。
 */
export function shouldBarrel(
  street: Street,
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  streetHistory: StreetHistory,
  personality: BotPersonality,
  playerIndex: number
): boolean {
  // 前のストリートでアグレッサーでない場合はバレルしない
  if (street === 'turn' && streetHistory.flopAggressor !== playerIndex) return false;
  if (street === 'river' && streetHistory.turnAggressor !== playerIndex) return false;

  let barrelChance = personality.aggression * 0.3;

  // 手が改善した → バレル
  if (handEval.madeHandRank >= 3) barrelChance += 0.30;
  if (handEval.hasFlushDraw || handEval.hasWrapDraw) barrelChance += 0.20;

  // スケアカード（フラッシュ完成、ストレート完成のカード）はバレルに有利
  if (boardTexture.flushPossible) barrelChance += 0.15;
  if (boardTexture.straightPossible) barrelChance += 0.10;

  // ブロッカーが強い → バレル
  barrelChance += handEval.blockerScore * 0.15;

  // リバーバレルは閾値高め
  if (street === 'river') barrelChance *= 0.6;

  return Math.random() < barrelChance;
}
