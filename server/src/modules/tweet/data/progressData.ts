/**
 * PROGRESS（進行状況）ツイート用のデータ集計。
 *
 * announceData.ts と同じく PrismaClient を引数に取る（ローカル ops からは本番バインドの
 * prisma、将来サーバー側 generator に載せるときはサーバーの prisma を渡せる）。
 *
 * レイトレジ締切はメモリ上の BlindScheduler を参照できないため、DB の
 * scheduledStartTime + blindSchedule から再計算する。ブラインド時計は
 * scheduledStartTime 起点（TournamentInstance.start が startFrom に渡す）なので、
 * 「Lv registrationLevels の終わり」= scheduledStartTime + Σ(Lv1..registrationLevels の duration) が正。
 */
import type { PrismaClient } from '@prisma/client';

interface BlindLevelRow {
  durationMinutes: number;
}

export interface ProgressData {
  tournamentName: string;
  /** 登録数 + リエントリー数の合計 */
  totalEntries: number;
  uniqueRegistrations: number;
  scheduledStartTime: Date;
  lateRegDeadline: Date;
}

/** blindSchedule(Json) と registrationLevels からレイトレジ締切を計算する純関数 */
export function computeLateRegDeadline(
  scheduledStartTime: Date,
  blindSchedule: BlindLevelRow[],
  registrationLevels: number,
): Date {
  const levels = blindSchedule.slice(0, registrationLevels);
  const totalMs = levels.reduce((s, l) => s + l.durationMinutes * 60_000, 0);
  return new Date(scheduledStartTime.getTime() + totalMs);
}

export async function fetchProgressData(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<ProgressData | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      name: true,
      scheduledStartTime: true,
      blindSchedule: true,
      registrationLevels: true,
    },
  });
  if (!tournament || !tournament.scheduledStartTime) return null;

  const registrations = await prisma.tournamentRegistration.findMany({
    where: { tournamentId },
    select: { reentryCount: true },
  });

  const schedule = tournament.blindSchedule as unknown as BlindLevelRow[];
  if (!Array.isArray(schedule) || schedule.length === 0) return null;

  return {
    tournamentName: tournament.name,
    totalEntries:
      registrations.length + registrations.reduce((s, r) => s + r.reentryCount, 0),
    uniqueRegistrations: registrations.length,
    scheduledStartTime: tournament.scheduledStartTime,
    lateRegDeadline: computeLateRegDeadline(
      tournament.scheduledStartTime,
      schedule,
      tournament.registrationLevels,
    ),
  };
}
