import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../../config/database.js';
import { loadPrivateHud, loadTournamentHud } from '../hudLoader.js';
import { hudToCacheFields } from '../hudCacheFields.js';
import { emptyHud } from '../hudStats.js';

vi.mock('../../../config/database.js', () => ({
  prisma: { handHistory: { findMany: vi.fn() }, tournamentStatsCache: { findUnique: vi.fn() } },
}));

const findMany = vi.mocked(prisma.handHistory.findMany);
const findCache = vi.mocked(prisma.tournamentStatsCache.findUnique);

/** 3人卓・ディーラー席0（BTN=席0, SB=席1, BB=席2） */
function hand(actions: { seatIndex: number; odId: string; action: string; amount: number }[], players: { seatPosition: number; userId: string | null }[]) {
  return {
    actions: actions.map(a => ({ ...a, street: 'preflop' })),
    dealerPosition: 0,
    blinds: '1/2',
    players,
  };
}

describe('loadPrivateHud', () => {
  beforeEach(() => findMany.mockReset());

  it('プライベート卓（トナメ外）の、指定時刻より前の本人参加ハンドを読む', async () => {
    findMany.mockResolvedValue([] as never);
    const before = new Date('2026-10-27T00:00:00Z');
    await loadPrivateHud('me', before);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isPrivate: true, tournamentId: null, createdAt: { lt: before }, players: { some: { userId: 'me' } } },
    }));
  });

  it('本人の分だけを全ハンド合算する（ゲストの席はアクションの odId で補う）', async () => {
    findMany.mockResolvedValue([
      // me がオープン、ゲストと bob がフォールド
      hand(
        [
          { seatIndex: 0, odId: 'me', action: 'raise', amount: 7 },
          { seatIndex: 1, odId: 'guest_1', action: 'fold', amount: 0 },
          { seatIndex: 2, odId: 'bob', action: 'fold', amount: 0 },
        ],
        [{ seatPosition: 0, userId: 'me' }, { seatPosition: 1, userId: null }, { seatPosition: 2, userId: 'bob' }],
      ),
      // me は BB でウォーク（me のアクションなし）
      hand(
        [
          { seatIndex: 0, odId: 'bob', action: 'fold', amount: 0 },
          { seatIndex: 1, odId: 'guest_1', action: 'fold', amount: 0 },
        ],
        [{ seatPosition: 0, userId: 'bob' }, { seatPosition: 1, userId: null }, { seatPosition: 2, userId: 'me' }],
      ),
    ] as never);

    const hud = await loadPrivateHud('me', new Date());

    expect(hud).toMatchObject({ hands: 2, vpip: { n: 1, d: 2 }, pfr: { n: 1, d: 2 }, steal: { n: 1, d: 1 } });
  });

  it('該当ハンドがなければ 0 ハンド', async () => {
    findMany.mockResolvedValue([] as never);
    expect((await loadPrivateHud('me', new Date())).hands).toBe(0);
  });
});

describe('loadTournamentHud', () => {
  beforeEach(() => findCache.mockReset());

  it('TournamentStatsCache の HUD 列から読む（ハンド数は VPIP の分母）', async () => {
    findCache.mockResolvedValue({ ...hudToCacheFields({ ...emptyHud(), hands: 12, vpip: { n: 3, d: 12 }, raiseVsBet: { n: 1, d: 4 } }) } as never);
    const hud = await loadTournamentHud('me');

    expect(findCache).toHaveBeenCalledWith({ where: { userId: 'me' } });
    expect(hud).toMatchObject({ hands: 12, vpip: { n: 3, d: 12 }, raiseVsBet: { n: 1, d: 4 }, steal: { n: 0, d: 0 } });
  });

  it('キャッシュがない人は 0 ハンド', async () => {
    findCache.mockResolvedValue(null as never);
    expect((await loadTournamentHud('me')).hands).toBe(0);
  });
});
