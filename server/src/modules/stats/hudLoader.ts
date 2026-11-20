// 卓内 HUD の累計を DB から読む
// - プライベート卓: isPrivate のハンド履歴から集計する
// - トナメ卓: TournamentStatsCache の HUD 列（ハンドごとに加算済み）を読む

import type { PlayerHudStats } from '@plo/shared';
import type { JsonValue } from '@prisma/client/runtime/library';
import { prisma } from '../../config/database.js';
import { addHud, computeHandHud, emptyHud, type HudAction, type HudHandInput } from './hudStats.js';
import { hudFromCacheFields } from './hudCacheFields.js';

export interface StoredHand {
  actions: JsonValue;
  dealerPosition: number;
  blinds: string;
  players: { seatPosition: number; userId: string | null }[];
}

/** userId がプライベート卓で遊んだハンドのうち、before より前のものを集計する */
export async function loadPrivateHud(userId: string, before: Date): Promise<PlayerHudStats> {
  const hands = await prisma.handHistory.findMany({
    where: { isPrivate: true, tournamentId: null, createdAt: { lt: before }, players: { some: { userId } } },
    select: {
      actions: true,
      dealerPosition: true,
      blinds: true,
      players: { select: { seatPosition: true, userId: true } },
    },
  });

  let hud = emptyHud();
  for (const h of hands) {
    const mine = computeHandHud(storedHandToHudInput(h)).get(userId);
    if (mine) hud = addHud(hud, mine);
  }
  return hud;
}

/**
 * userId のトナメ HUD の累計を TournamentStatsCache から読む。
 * 読んだ時点までに加算済みのハンドが入り、以降のハンドは TableHudTracker が足す。
 * 読むのはトナメに着席した最初の1回だけで、そのとき本人のハンドは進行していないため二重に数えない
 */
export async function loadTournamentHud(userId: string): Promise<PlayerHudStats> {
  const row = await prisma.tournamentStatsCache.findUnique({ where: { userId } });
  return row ? hudFromCacheFields(row) : emptyHud();
}

/** DB に保存したハンドを HUD 計算の入力にする（ゲストの席はアクションの odId で補う） */
export function storedHandToHudInput(h: StoredHand): HudHandInput {
  const actions = h.actions as unknown as HudAction[];
  const odIdBySeat = new Map(actions.map(a => [a.seatIndex, a.odId]));
  const [smallBlind, bigBlind] = h.blinds.split('/').map(Number);
  return {
    actions,
    dealerPosition: h.dealerPosition,
    players: h.players.map(p => ({
      seatIndex: p.seatPosition,
      odId: p.userId ?? odIdBySeat.get(p.seatPosition) ?? `seat_${p.seatPosition}`,
    })),
    smallBlind,
    bigBlind,
  };
}
