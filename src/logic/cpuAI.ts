import { GameState, Action, Card } from './types';
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

function evaluatePreFlopStrength(holeCards: Card[]): number {
  // PLOのハンド評価（簡易版）
  let score = 0;

  // ペアがあるか
  const ranks = holeCards.map(c => c.rank);
  const rankCounts = new Map<string, number>();
  for (const r of ranks) {
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  }
  const pairs = Array.from(rankCounts.values()).filter(c => c >= 2).length;
  score += pairs * 0.15;

  // 高いカード
  const values = holeCards.map(c => getRankValue(c.rank));
  const avgValue = values.reduce((a, b) => a + b, 0) / 4;
  score += (avgValue - 8) / 14 * 0.3;

  // スーツの連携（ダブルスーテッド）
  const suits = holeCards.map(c => c.suit);
  const suitCounts = new Map<string, number>();
  for (const s of suits) {
    suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
  }
  const suitedCount = Array.from(suitCounts.values()).filter(c => c >= 2).length;
  score += suitedCount * 0.1;

  // コネクト性
  const sortedValues = [...values].sort((a, b) => a - b);
  let connectivity = 0;
  for (let i = 0; i < 3; i++) {
    const gap = sortedValues[i + 1] - sortedValues[i];
    if (gap <= 3) connectivity += (4 - gap) / 3;
  }
  score += connectivity / 3 * 0.2;

  // AAxxは非常に強い
  if (rankCounts.get('A') === 2) {
    score += 0.25;
  }

  return Math.min(1, Math.max(0, score));
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
