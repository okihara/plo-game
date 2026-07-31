// ポストフロップの EV ベース意思決定（新エンジンの中核）。
//
// 旧エンジンとの違い（docs/bot-redesign.md 再設計原則）:
//   1. すべての判断は「対レンジ・エクイティ vs 価格」の EV 比較（サイズを見ないフォールドが構造上できない）
//   2. 相手レンジは monteCarloEquity の重み付きサンプリングで明示的に扱う
//   3. ブラフ割合込みのレンジで EV(コール) を測るため、MDF 近傍の防御頻度が自然に出る
//   4. 乱数はハンド単位シードの softmax 1 箇所のみ（EV 差が大きければブレない）
//   5. サイズ候補は 33/66/100% ポットに離散化し、EV で選ぶ（ハンドクラス→サイズの直結を廃止）

import { GameState, Action, GameAction } from '../../types.js';
import { getValidActions } from '../../gameEngine.js';
import { estimateEquity, OpponentRangeSpec } from './monteCarloEquity.js';
import { mulberry32, handSeed, Rng } from './rng.js';

export interface Decision {
  action: Action;
  amount: number;
}

interface Candidate extends Decision {
  ev: number;
}

const BET_SIZE_CANDIDATES = [0.33, 0.66, 1.0];

/** 相手が (street, ベットサイズ s) のベットに降りる確率の集団事前分布。
 *  当面は控えめな定数。Phase 4 で集団適応（実測フォールド率）に置き換える。 */
function foldEquityPrior(street: string, sizePct: number): number {
  const s = Math.min(1.2, sizePct);
  if (street === 'flop') return Math.min(0.6, 0.30 + 0.12 * s);
  if (street === 'turn') return Math.min(0.6, 0.30 + 0.15 * s);
  return Math.min(0.6, 0.28 + 0.15 * s); // river
}

/** コールされた場合のエクイティ補正: 継続レンジは全体レンジより強い。
 *  ナッツ級 (equity→1) には補正がほぼ効かない形にする。 */
function equityWhenCalled(equity: number, sizePct: number): number {
  return Math.max(0, equity - (1 - equity) * sizePct * 0.5);
}

/** handHistory から各相手のレンジ条件を導出する */
export function buildOpponentSpecs(
  state: GameState,
  playerIndex: number
): { specs: OpponentRangeSpec[]; canFoldCount: number } {
  const specs: OpponentRangeSpec[] = [];
  let canFoldCount = 0;

  // 現ストリートの最後のアグレッサー
  const streetActions = state.handHistory.filter(a => a.street === state.currentStreet);
  let streetAggressor = -1;
  for (const a of streetActions) {
    if (a.action === 'bet' || a.action === 'raise' || a.action === 'allin') {
      streetAggressor = a.playerId;
    }
  }

  for (let i = 0; i < state.players.length; i++) {
    if (i === playerIndex) continue;
    const p = state.players[i];
    if (p.isSittingOut || p.folded) continue;

    const preflopActions = state.handHistory.filter(
      (a: GameAction) => a.street === 'preflop' && a.playerId === i
    );
    let preflopLevel: 0 | 1 | 2 = 0;
    if (preflopActions.some(a => a.action === 'raise' || a.action === 'bet' || a.action === 'allin')) {
      preflopLevel = 2;
    } else if (preflopActions.some(a => a.action === 'call')) {
      preflopLevel = 1;
    }

    specs.push({ preflopLevel, isStreetAggressor: i === streetAggressor });
    if (!p.isAllIn) canFoldCount++;
  }

  return { specs, canFoldCount };
}

/**
 * ポストフロップの意思決定。
 * aggressionMod: パーソナリティ由来の攻撃性補正 (0.0 が基準、±0.1 程度)。
 */
export function decidePostflop(
  state: GameState,
  playerIndex: number,
  aggressionMod: number = 0
): Decision {
  const player = state.players[playerIndex];
  const validActions = getValidActions(state, playerIndex);
  const toCall = Math.max(0, state.currentBet - player.currentBet);
  const pot = Math.max(1, state.pot);
  const street = state.currentStreet;

  const rand: Rng = mulberry32(
    handSeed(player.holeCards, playerIndex, `${street}:${state.communityCards.length}:${state.currentBet}`)
  );

  const { specs, canFoldCount } = buildOpponentSpecs(state, playerIndex);
  if (specs.length === 0) {
    // 相手がいない（異常ケース）
    const check = validActions.find(a => a.action === 'check');
    return check ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
  }

  const equity = estimateEquity(player.holeCards, state.communityCards, specs, rand);

  const candidates: Candidate[] = [];

  // === fold ===
  if (toCall > 0) {
    candidates.push({ action: 'fold', amount: 0, ev: 0 });
  }

  // === check ===
  if (validActions.some(a => a.action === 'check')) {
    candidates.push({ action: 'check', amount: 0, ev: equity * pot });
  }

  // === call ===
  const callOption = validActions.find(a => a.action === 'call');
  if (callOption) {
    const callCost = callOption.minAmount; // オールインコール時は toCall より小さい
    candidates.push({
      action: 'call',
      amount: callCost,
      ev: equity * (pot + callCost) - callCost,
    });
  }

  // === bet / raise（サイズ候補）===
  const betOption = validActions.find(a => a.action === 'bet' || a.action === 'raise');
  const allinOption = validActions.find(a => a.action === 'allin');
  const aggTarget = betOption ?? allinOption;
  if (aggTarget) {
    const potAfterCall = pot + toCall;
    const seen = new Set<number>();
    for (const sizePct of BET_SIZE_CANDIDATES) {
      const rawAdd = Math.round(toCall + sizePct * potAfterCall);
      const add = Math.max(aggTarget.minAmount, Math.min(aggTarget.maxAmount, rawAdd));
      if (seen.has(add)) continue;
      seen.add(add);

      // 実効サイズ（クランプ後）でパラメータを再計算
      const effPct = potAfterCall > 0 ? (add - toCall) / potAfterCall : 0;
      const feOne = foldEquityPrior(street, effPct);
      // 全員降りる確率（フォールド可能な相手のみ）。オールインの相手は降りられない
      const foldAll = canFoldCount > 0 ? Math.pow(feOne, Math.max(1, canFoldCount)) : 0;
      const eqCalled = equityWhenCalled(equity, effPct);
      // コールされた場合: 1 人が我々のレイズ分をコールすると近似
      const raisePart = add - toCall;
      const calledPot = pot + add + raisePart;
      const evCalled = eqCalled * calledPot - add;
      let ev = foldAll * pot + (1 - foldAll) * evCalled;
      ev *= 1 + aggressionMod;
      candidates.push({ action: aggTarget.action, amount: add, ev });
    }
  }

  if (candidates.length === 0) {
    return { action: 'fold', amount: 0 };
  }

  // === softmax 選択（唯一の乱数化ポイント）===
  // 温度はポット比例: EV 差がポットの 8% を超えるとほぼ決め打ちになる
  const temperature = Math.max(1, pot * 0.08);
  const maxEv = Math.max(...candidates.map(c => c.ev));
  const weights = candidates.map(c => Math.exp((c.ev - maxEv) / temperature));
  const totalW = weights.reduce((s, w) => s + w, 0);
  let roll = rand() * totalW;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return { action: candidates[i].action, amount: candidates[i].amount };
  }
  return { action: candidates[candidates.length - 1].action, amount: candidates[candidates.length - 1].amount };
}
