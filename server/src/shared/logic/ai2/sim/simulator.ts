// オフライン対戦シミュレータ。
// gameEngine をそのまま回し、6 席のエージェント（Bot / エクスプロイター）の損益を集計する。
// キャッシュゲームの auto top-up を模して毎ハンド全員のスタックを買い直す。
// レーキは 0（被搾取額を素の戦略差として測るため）。

import { createInitialGameState, startNewHand, applyAction, getValidActions } from '../../gameEngine.js';
import { SimAgent } from './types.js';

export interface MatchOptions {
  /** 席順に 6 エージェント */
  agents: SimAgent[];
  hands: number;
  smallBlind?: number;
  bigBlind?: number;
  /** BB 単位の買い込み量（毎ハンドこの額にリセット） */
  buyInBB?: number;
}

export interface SeatResult {
  name: string;
  profit: number;
  bb100: number;
  /** BB/100 の標準誤差（ハンド間の分散から算出） */
  bb100SE: number;
}

export interface MatchResult {
  hands: number;
  bigBlind: number;
  seats: SeatResult[];
  /** エージェントが不正なアクションを返し check/fold に矯正された回数 */
  invalidActionCount: number;
}

export function runMatch(opts: MatchOptions): MatchResult {
  if (opts.agents.length !== 6) throw new Error('agents は 6 席分必要');
  const sb = opts.smallBlind ?? 10;
  const bb = opts.bigBlind ?? 20;
  const buyIn = bb * (opts.buyInBB ?? 100);

  let state = createInitialGameState(buyIn);
  state.smallBlind = sb;
  state.bigBlind = bb;
  state.minRaise = bb;
  state.variant = 'plo';
  for (let i = 0; i < 6; i++) state.players[i].name = opts.agents[i].name;

  const profit = new Array<number>(6).fill(0);
  const sumSq = new Array<number>(6).fill(0);
  let invalidActionCount = 0;

  for (let h = 0; h < opts.hands; h++) {
    // auto top-up: 毎ハンド全席を buyIn に戻す（ハンド間の独立性を保つ）
    for (const p of state.players) {
      p.chips = buyIn;
      p.isSittingOut = false;
    }
    state = startNewHand(state);

    let guard = 0;
    while (!state.isHandComplete) {
      if (++guard > 300) {
        throw new Error(`hand ${h}: アクションループが 300 回を超過`);
      }
      const idx = state.currentPlayerIndex;
      const decision = opts.agents[idx].act(state, idx);
      let { action, amount } = decision;

      // 妥当性検証: エンジンが許容しないアクションは check → fold に矯正
      const valid = getValidActions(state, idx);
      const matched = valid.find(v => v.action === action);
      if (!matched) {
        invalidActionCount++;
        const fallback = valid.find(v => v.action === 'check') ?? valid.find(v => v.action === 'fold');
        if (!fallback) throw new Error(`hand ${h}: seat ${idx} に有効アクションがない`);
        action = fallback.action;
        amount = 0;
      } else {
        amount = Math.max(matched.minAmount, Math.min(matched.maxAmount, amount));
      }

      state = applyAction(state, idx, action, amount);
    }

    // チップ保存則: レーキ 0 なら総チップは不変のはず（エンジン誤用の検出）
    const total = state.players.reduce((s, p) => s + p.chips, 0);
    if (total !== buyIn * 6) {
      throw new Error(`hand ${h}: チップ保存則違反 (total=${total}, expected=${buyIn * 6})`);
    }

    for (let i = 0; i < 6; i++) {
      const d = state.players[i].chips - buyIn;
      profit[i] += d;
      sumSq[i] += d * d;
    }
  }

  const n = opts.hands;
  const seats: SeatResult[] = opts.agents.map((agent, i) => {
    const mean = profit[i] / n;
    const variance = Math.max(0, sumSq[i] / n - mean * mean);
    const se = Math.sqrt(variance / n);
    return {
      name: agent.name,
      profit: profit[i],
      bb100: (mean / bb) * 100,
      bb100SE: (se / bb) * 100,
    };
  });

  return { hands: n, bigBlind: bb, seats, invalidActionCount };
}
