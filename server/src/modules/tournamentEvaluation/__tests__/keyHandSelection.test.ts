import { describe, expect, it } from 'vitest';
import type { TournamentHandExport } from '../../history/tournamentHandsForUser.js';
import { computeHandFeatures, formatHandsSummary, selectKeyHands } from '../keyHandSelection.js';

const ME = 0;

type ActionSpec = { seat: number; action: string; amount?: number; street?: string };

function hand(
  handNumber: number,
  opts: {
    actions: ActionSpec[];
    profit?: number;
    pot?: number;
    board?: string[];
    blinds?: string;
  }
): TournamentHandExport {
  return {
    id: `h${handNumber}`,
    handNumber,
    blinds: opts.blinds ?? '50/100',
    communityCards: opts.board ?? [],
    communityCards2: [],
    potSize: opts.pot ?? 150,
    rakeAmount: 0,
    winners: [],
    actions: opts.actions.map(a => ({
      seatIndex: a.seat,
      odName: `p${a.seat}`,
      action: a.action,
      amount: a.amount ?? 0,
      street: a.street ?? 'preflop',
    })),
    dealerPosition: 2,
    createdAt: new Date(2026, 0, 1, 0, handNumber),
    players: [0, 1, 2].map(seat => ({
      userId: seat === ME ? 'me' : `u${seat}`,
      username: `p${seat}`,
      avatarUrl: null,
      seatPosition: seat,
      holeCards: [],
      finalHand: null,
      startChips: 10000,
      profit: seat === ME ? (opts.profit ?? 0) : 0,
      isCurrentUser: seat === ME,
    })),
  };
}

const foldedPreflop = (n: number) =>
  hand(n, { actions: [{ seat: ME, action: 'fold' }], profit: 0 });

describe('computeHandFeatures', () => {
  it('プリフロップのレイズは VPIP かつ PFR、フロップまで残ればフロップ参加', () => {
    const f = computeHandFeatures(
      hand(1, {
        actions: [
          { seat: ME, action: 'raise', amount: 300 },
          { seat: 1, action: 'call', amount: 300 },
          { seat: ME, action: 'bet', amount: 400, street: 'flop' },
          { seat: 1, action: 'fold', street: 'flop' },
        ],
        board: ['Ah', 'Kd', '2c'],
        profit: 700,
        pot: 1400,
      })
    )!;
    expect(f).toMatchObject({ vpip: true, pfr: true, sawFlop: true, allInInvolved: false });
    expect(f.profitBb).toBe(7);
    expect(f.potBb).toBe(14);
  });

  it('自分がフォールドした後のオールインは関与扱いにしない', () => {
    const f = computeHandFeatures(
      hand(1, {
        actions: [
          { seat: ME, action: 'fold' },
          { seat: 1, action: 'allin', amount: 10000 },
        ],
      })
    )!;
    expect(f.allInInvolved).toBe(false);
    expect(f.vpip).toBe(false);
  });

  it('本人が席にいないハンドは null', () => {
    const h = hand(1, { actions: [] });
    h.players = h.players.map(p => ({ ...p, isCurrentUser: false }));
    expect(computeHandFeatures(h)).toBeNull();
  });
});

describe('selectKeyHands', () => {
  it('フォールドだけのハンドは除外し、残りを時系列順で返す', () => {
    const big = hand(2, {
      actions: [
        { seat: ME, action: 'allin', amount: 10000 },
        { seat: 1, action: 'call', amount: 10000 },
      ],
      profit: 10000,
      pot: 20000,
    });
    const small = hand(4, { actions: [{ seat: ME, action: 'call', amount: 100 }], profit: -100 });
    const { selected, summary } = selectKeyHands(
      [foldedPreflop(1), big, foldedPreflop(3), small, foldedPreflop(5)],
      10
    );

    // 最後のハンド（敗退/優勝ハンド）は条件によらず含む
    expect(selected.map(h => h.handNumber)).toEqual([2, 4, 5]);
    expect(summary).toMatchObject({
      totalHands: 5,
      selectedHands: 3,
      vpipHands: 2,
      pfrHands: 1,
      allInHands: 1,
    });
  });

  it('上限を超えるときはスコア上位を残し、最後のハンドのために最下位を外す', () => {
    const hands = [
      hand(1, { actions: [{ seat: ME, action: 'call' }], profit: -5000, pot: 10000 }),
      hand(2, { actions: [{ seat: ME, action: 'call' }], profit: -300, pot: 600 }),
      hand(3, { actions: [{ seat: ME, action: 'call' }], profit: 2000, pot: 4000 }),
      foldedPreflop(4),
    ];
    const { selected, summary } = selectKeyHands(hands, 2);
    expect(selected.map(h => h.handNumber)).toEqual([1, 4]);
    expect(summary.selectedHands).toBe(2);
    // 省いたハンド 2・3 の損益: -3BB + 20BB
    expect(summary.omittedProfitBb).toBeCloseTo(17);
  });

  it('上限なしなら候補外のハンドも含めて全ハンドを返す', () => {
    const hands = [foldedPreflop(1), foldedPreflop(2), foldedPreflop(3)];
    const { selected } = selectKeyHands(hands, Number.POSITIVE_INFINITY);
    expect(selected).toHaveLength(3);
  });

  it('空配列でも落ちない', () => {
    const { selected, summary } = selectKeyHands([]);
    expect(selected).toEqual([]);
    expect(formatHandsSummary(summary)).toContain('全ハンド数: 0');
  });
});
