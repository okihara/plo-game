// 卓内 HUD の累計を DB のハンド履歴から集計する（プライベート卓: isPrivate のハンド、トナメ卓: トナメのハンド）

import type { PlayerHudStats } from '@plo/shared';
import type { JsonValue } from '@prisma/client/runtime/library';
import { prisma } from '../../config/database.js';
import { addHud, computeHandHud, emptyHud, type HudAction } from './hudStats.js';

interface StoredHand {
  actions: JsonValue;
  dealerPosition: number;
  blinds: string;
  players: { seatPosition: number; userId: string | null }[];
}

const HAND_SELECT = {
  actions: true,
  dealerPosition: true,
  blinds: true,
  players: { select: { seatPosition: true, userId: true } },
} as const;

/** userId がプライベート卓で遊んだハンドのうち、before より前のものを集計する */
export async function loadPrivateHud(userId: string, before: Date): Promise<PlayerHudStats> {
  const hands = await prisma.handHistory.findMany({
    where: { isPrivate: true, tournamentId: null, createdAt: { lt: before }, players: { some: { userId } } },
    select: HAND_SELECT,
  });
  return sumHud(userId, hands);
}

/**
 * トナメ HUD に使う直近ハンド数の上限。
 * 全件だと最多ユーザー（約1.8万ハンド）で DB 側だけ約22秒・約27MB かかるため絞る
 */
export const TOURNAMENT_HUD_HAND_LIMIT = 1000;

/** userId がトナメで遊んだハンドのうち、before より前の直近 TOURNAMENT_HUD_HAND_LIMIT 件を集計する */
export async function loadTournamentHud(userId: string, before: Date): Promise<PlayerHudStats> {
  const where = { userId, tournamentId: { not: null }, createdAt: { lt: before } };
  // 本体ごと ORDER BY + LIMIT すると全件をヒープから読んでから並べるため（本番で約14秒）、
  // 先に (userId, tournamentId, createdAt) インデックスだけで上限件目の時刻を求め、それ以降だけ本体を読む（約2秒）
  const [cutoff] = await prisma.handHistoryPlayer.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: TOURNAMENT_HUD_HAND_LIMIT - 1,
    take: 1,
    select: { createdAt: true },
  });
  const rows = await prisma.handHistoryPlayer.findMany({
    where: cutoff?.createdAt ? { ...where, createdAt: { lt: before, gte: cutoff.createdAt } } : where,
    select: { handHistory: { select: HAND_SELECT } },
  });
  return sumHud(userId, rows.map(r => r.handHistory));
}

function sumHud(userId: string, hands: StoredHand[]): PlayerHudStats {
  let hud = emptyHud();
  for (const h of hands) {
    const actions = h.actions as unknown as HudAction[];
    const odIdBySeat = new Map(actions.map(a => [a.seatIndex, a.odId]));
    const [smallBlind, bigBlind] = h.blinds.split('/').map(Number);
    const mine = computeHandHud({
      actions,
      dealerPosition: h.dealerPosition,
      players: h.players.map(p => ({
        seatIndex: p.seatPosition,
        odId: p.userId ?? odIdBySeat.get(p.seatPosition) ?? `seat_${p.seatPosition}`,
      })),
      smallBlind,
      bigBlind,
    }).get(userId);
    if (mine) hud = addHud(hud, mine);
  }
  return hud;
}
