// プライベート卓 HUD の累計を DB のハンド履歴（isPrivate）から集計する

import type { PlayerHudStats } from '@plo/shared';
import { prisma } from '../../config/database.js';
import { addHud, computeHandHud, emptyHud, type HudAction } from './hudStats.js';

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
