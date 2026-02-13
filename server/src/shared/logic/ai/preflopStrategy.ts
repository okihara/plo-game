import { GameState, Action, Card } from '../types.js';
import { getValidActions } from '../gameEngine.js';
import { getRankValue } from '../deck.js';
import { BotPersonality, OpponentModel } from './types.js';

// 既存のプリフロップ評価をインポート
import { evaluatePreFlopStrength, getPreFlopEvaluation } from '../cpuAI.js';

/**
 * プリフロップの意思決定。
 * パーソナリティによるVPIP/PFR制御、3ベット戦略、サイジング改善。
 */
export function getPreflopDecision(
  state: GameState,
  playerIndex: number,
  personality: BotPersonality,
  positionBonus: number,
  opponentModel?: OpponentModel
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const validActions = getValidActions(state, playerIndex);
  const handStrength = evaluatePreFlopStrength(player.holeCards);
  const evaluation = getPreFlopEvaluation(player.holeCards);
  const effectiveStrength = Math.min(1, handStrength + positionBonus);

  const toCall = state.currentBet - player.currentBet;
  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
  const random = Math.random();

  const facingRaise = state.currentBet > state.bigBlind;
  const facingBigRaise = toCall > state.pot * 0.5;

  // VPIP閾値: パーソナリティに基づいてハンド参加閾値を計算
  // vpip=0.40なら effectiveStrength 0.20以上で参加
  // vpip=0.15なら effectiveStrength 0.55以上で参加
  const vpipThreshold = Math.max(0.10, 0.70 - personality.vpip * 1.3);

  // PFR閾値: レイズする閾値
  const pfrThreshold = vpipThreshold + (personality.vpip - personality.pfr) * 0.8;

  // === プレミアムハンド (effectiveStrength > 0.75) ===
  if (effectiveStrength > 0.75) {
    return playPremium(state, validActions, effectiveStrength, facingRaise, personality);
  }

  // === 3ベット判断 ===
  if (facingRaise && effectiveStrength > pfrThreshold + 0.10) {
    const threeBetDecision = evaluate3Bet(
      state, validActions, effectiveStrength, personality, positionBonus, random
    );
    if (threeBetDecision) return threeBetDecision;
  }

  // === 良いハンド: レイズ or コール ===
  if (effectiveStrength > pfrThreshold) {
    // 大きなレイズに直面 → 慎重
    if (facingBigRaise) {
      if (effectiveStrength > pfrThreshold + 0.10) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }

    // オープンレイズ
    if (!facingRaise && random < personality.pfr / personality.vpip) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction) {
        const raiseSize = getOpenRaiseSize(state, playerIndex, personality);
        const amount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, raiseSize));
        return { action: raiseAction.action, amount };
      }
    }

    // コール
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction && potOdds < effectiveStrength * 0.8) {
      return { action: 'call', amount: callAction.minAmount };
    }
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    if (toCall > 0) return { action: 'fold', amount: 0 };
  }

  // === 参加可能なハンド (vpipThreshold以上) ===
  if (effectiveStrength > vpipThreshold) {
    // レイズには降りる
    if (facingRaise && toCall > state.bigBlind * 3) {
      return { action: 'fold', amount: 0 };
    }

    // チェック
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // 安くコール
    if (potOdds < 0.2 && toCall <= state.bigBlind * 2) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }

    return { action: 'fold', amount: 0 };
  }

  // === 弱いハンド: 基本フォールド ===
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  // スチール: ポジションが良い + ルースなパーソナリティ
  if (!facingRaise && positionBonus >= 0.08 && random < personality.bluffFreq * 0.5) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      return { action: raiseAction.action, amount: raiseAction.minAmount };
    }
  }

  return { action: 'fold', amount: 0 };
}

/**
 * プレミアムハンドのプレイ。
 */
function playPremium(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  effectiveStrength: number,
  facingRaise: boolean,
  personality: BotPersonality
): { action: Action; amount: number } {
  const random = Math.random();
  const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');

  if (raiseAction) {
    // レイズ頻度: personality依存 (TAG: 90%, LP: 70%)
    const raiseFreq = 0.70 + personality.aggression * 0.20;
    if (random < raiseFreq) {
      let raiseSize: number;
      if (facingRaise) {
        // 3ベット: ポットの2.5-3.5倍
        raiseSize = Math.floor(state.pot * (2.5 + personality.aggression * 0.5));
      } else {
        // オープン: ポットの2-3倍
        raiseSize = Math.floor(state.pot * (2.0 + personality.aggression * 0.5));
      }
      const amount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, raiseSize));
      return { action: raiseAction.action, amount };
    }
  }

  // コール（トラップ）
  const callAction = validActions.find(a => a.action === 'call');
  if (callAction) return { action: 'call', amount: callAction.minAmount };
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

/**
 * 3ベット判断。
 * ポジションと相手タイプに応じた3ベット（ブラフ3ベット含む）。
 */
function evaluate3Bet(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  effectiveStrength: number,
  personality: BotPersonality,
  positionBonus: number,
  random: number
): { action: Action; amount: number } | null {
  const raiseAction = validActions.find(a => a.action === 'raise');
  if (!raiseAction) return null;

  let threeBetChance = personality.threeBetFreq;

  // ポジションが良いと3ベット頻度UP
  if (positionBonus >= 0.08) threeBetChance += 0.03;

  // 強いほど3ベット率UP
  if (effectiveStrength > 0.70) threeBetChance += 0.05;

  if (random >= threeBetChance) return null;

  // 3ベットサイズ: ポットの3-4倍
  const raiseSize = Math.floor(state.pot * (3.0 + personality.aggression * 0.5));
  const amount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, raiseSize));
  return { action: 'raise', amount };
}

/**
 * オープンレイズサイズ。
 * ポジションとリンパー数に応じて変動。
 */
function getOpenRaiseSize(
  state: GameState,
  playerIndex: number,
  personality: BotPersonality
): number {
  const player = state.players[playerIndex];
  const hasPosition = ['BTN', 'CO'].includes(player.position);

  // リンパー数（BB以上を既にベットしている人数）
  const limpers = state.players.filter(p =>
    !p.folded && p.currentBet >= state.bigBlind && p.currentBet <= state.bigBlind && p.id !== playerIndex
  ).length;

  // ベースサイズ
  let baseMultiplier = hasPosition ? 2.5 : 3.0;

  // リンパーごとに +1BB
  baseMultiplier += limpers * 1.0;

  // パーソナリティ補正
  baseMultiplier += (personality.aggression - 0.7) * 0.5;

  return Math.floor(state.bigBlind * baseMultiplier);
}
