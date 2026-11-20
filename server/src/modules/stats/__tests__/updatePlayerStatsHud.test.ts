// トナメのハンドは卓内 HUD の項目も TournamentStatsCache に加算する
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../../config/database.js';
import { updatePlayerStats } from '../updateStatsIncremental.js';
import type { GameState } from '../../../shared/logic/types.js';
import type { SeatInfo } from '../../table/types.js';

vi.mock('../../../config/database.js', () => ({
  prisma: {
    tournamentStatsCache: { upsert: vi.fn().mockResolvedValue({}) },
    playerStatsCache: { upsert: vi.fn().mockResolvedValue({ userId: 'x', handsPlayed: 1, winCount: 0 }) },
  },
}));

vi.mock('../../badges/badgeService.js', () => ({
  checkHandCountBadges: vi.fn().mockResolvedValue(undefined),
  checkBadBeatBadges: vi.fn().mockResolvedValue(undefined),
}));

// 3人卓・ディーラー席0: BTN=A がオープン、SB=B と BB=C がフォールド
const seats = [{ odId: 'A' }, { odId: 'B' }, { odId: 'C' }] as SeatInfo[];
const startChips = new Map([[0, 200], [1, 200], [2, 200]]);
const gameState = {
  handHistory: [
    { playerId: 0, action: 'raise', amount: 7, street: 'preflop' },
    { playerId: 1, action: 'fold', amount: 0, street: 'preflop' },
    { playerId: 2, action: 'fold', amount: 0, street: 'preflop' },
  ],
  dealerPosition: 0,
  smallBlind: 1,
  bigBlind: 2,
  winners: [{ playerId: 0, amount: 10 }],
  players: [
    { chips: 203, folded: false, holeCards: [] },
    { chips: 199, folded: true, holeCards: [] },
    { chips: 198, folded: true, holeCards: [] },
  ],
  communityCards: [],
} as unknown as GameState;

const upsertTournament = vi.mocked(prisma.tournamentStatsCache.upsert);
const upsertCash = vi.mocked(prisma.playerStatsCache.upsert);

function argsFor(odId: string) {
  return upsertTournament.mock.calls.map(c => c[0]).find(a => a.where.userId === odId)!;
}

describe('updatePlayerStats の HUD 加算', () => {
  beforeEach(() => {
    upsertTournament.mockClear();
    upsertCash.mockClear();
  });

  it('トナメでは HUD 列を HUD の定義で加算する（新規作成時は値をそのまま入れる）', async () => {
    await updatePlayerStats(gameState, seats, startChips, null, true);

    const a = argsFor('A');
    expect(a.update).toMatchObject({
      hudVpipN: { increment: 1 }, hudVpipD: { increment: 1 },
      hudPfrN: { increment: 1 }, hudStealN: { increment: 1 }, hudStealD: { increment: 1 },
      handsPlayed: { increment: 1 },
    });
    expect(a.create).toMatchObject({ userId: 'A', hudVpipD: 1, hudStealN: 1 });

    // BB は BTN のオープンにフォールド
    expect(argsFor('C').update).toMatchObject({
      hudVpipN: { increment: 0 }, hudBbFoldVsOpenN: { increment: 1 }, hudBbFoldVsOpenD: { increment: 1 },
    });
    expect(upsertCash).not.toHaveBeenCalled();
  });

  it('キャッシュゲームでは HUD 列を持たない PlayerStatsCache だけを更新する', async () => {
    await updatePlayerStats(gameState, seats, startChips, null, false);

    expect(upsertTournament).not.toHaveBeenCalled();
    expect(upsertCash).toHaveBeenCalledTimes(3);
    expect(Object.keys(upsertCash.mock.calls[0][0].update).some(k => k.startsWith('hud'))).toBe(false);
  });
});
