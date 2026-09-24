/// <reference types="node" />
/**
 * 告知ツイートで触れる「大型大会」（毎日22:00のデイリー以外のトナメ）を本番DBから拾う読み取り専用スクリプト。
 *
 *   cd server && npx tsx scripts/ops/upcoming-specials.ts --prod           # 開催中 + 3日以内
 *   cd server && npx tsx scripts/ops/upcoming-specials.ts --prod --days=7  # 窓を広げる
 *   cd server && npx tsx scripts/ops/upcoming-specials.ts --local --now=2026-09-20T12:05:00+09:00
 *
 * 判定の単一の真実の源泉は `src/modules/tournament/weeklySchedule.ts`。
 * その曜日のプラン（名前・バリアント・基本設定）と**完全に一致する**トナメは「いつものデイリー」として除外し、
 * 残り（名前が違う／バイイン・スタック・定員が大きい）を大型大会の候補として出力する。
 *
 * 出力は1件1行のJSON + 最終行のサマリ（`specials=none` / `specials=N`）。接続文字列は一切出さない。
 */
import type { Tournament } from '@prisma/client';
import { jstParts } from '../../src/shared/timeJst.js';
import {
  DAILY_TOURNAMENT_BASE_CONFIG,
  buildDailyTournamentName,
  planForWeekday,
} from '../../src/modules/tournament/weeklySchedule.js';
import { createContext, type OpsContext } from './lib/context.js';

/** 開催中とみなすステータス（WAITING は開始前なので含めない） */
const ONGOING_STATUSES = ['RUNNING', 'FINAL_TABLE', 'HEADS_UP'] as const;
/** 開始済みトナメを拾うための遡り幅（深夜の実行で前夜の大会を拾えるように） */
const LOOKBACK_MS = 12 * 3_600_000;

type SpecialReason = 'ongoing' | 'name' | 'scale';

interface Special {
  id: string;
  name: string;
  gameVariant: string;
  status: string;
  buyIn: number;
  startingChips: number;
  maxPlayers: number;
  /** 'M/D HH:MM'（JST） */
  startJst: string | null;
  /** 開始までの日数（JST の暦日差。開催中・開始済みは 0） */
  daysUntil: number | null;
  reason: SpecialReason;
}

function argValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

/** その日の曜日プランどおりのデイリーか（名前・バリアント・基本設定がすべて一致） */
function isRegularDaily(t: Tournament): boolean {
  if (!t.scheduledStartTime) return false;
  const jst = jstParts(t.scheduledStartTime);
  const plan = planForWeekday(jst.weekday);
  return (
    t.name === buildDailyTournamentName(plan, jst) &&
    t.gameVariant === plan.gameVariant &&
    t.buyIn === DAILY_TOURNAMENT_BASE_CONFIG.buyIn &&
    t.startingChips === DAILY_TOURNAMENT_BASE_CONFIG.startingChips &&
    t.maxPlayers === DAILY_TOURNAMENT_BASE_CONFIG.maxPlayers
  );
}

/** デイリーより明らかに規模が大きい設定か（賞金・スタック・定員のどれかが上振れ） */
function isBiggerThanDaily(t: Tournament): boolean {
  return (
    t.buyIn > DAILY_TOURNAMENT_BASE_CONFIG.buyIn ||
    t.startingChips > DAILY_TOURNAMENT_BASE_CONFIG.startingChips ||
    t.maxPlayers > DAILY_TOURNAMENT_BASE_CONFIG.maxPlayers
  );
}

function reasonFor(t: Tournament): SpecialReason {
  if ((ONGOING_STATUSES as readonly string[]).includes(t.status)) return 'ongoing';
  return isBiggerThanDaily(t) ? 'scale' : 'name';
}

/** JST の暦日差（開催中・開始済みは 0） */
function daysUntilJst(now: Date, start: Date): number {
  const a = jstParts(now);
  const b = jstParts(start);
  const diff = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.max(0, Math.round(diff / 86_400_000));
}

function formatStartJst(start: Date): string {
  const { month, day, hour, minute } = jstParts(start);
  return `${month}/${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function toSpecial(t: Tournament, now: Date): Special {
  return {
    id: t.id,
    name: t.name,
    gameVariant: t.gameVariant,
    status: t.status,
    buyIn: t.buyIn,
    startingChips: t.startingChips,
    maxPlayers: t.maxPlayers,
    startJst: t.scheduledStartTime ? formatStartJst(t.scheduledStartTime) : null,
    daysUntil: t.scheduledStartTime ? daysUntilJst(now, t.scheduledStartTime) : null,
    reason: reasonFor(t),
  };
}

async function findSpecials(ctx: OpsContext, days: number): Promise<Special[]> {
  const from = new Date(ctx.now.getTime() - LOOKBACK_MS);
  const until = new Date(ctx.now.getTime() + days * 86_400_000);
  const rows = await ctx.prisma.tournament.findMany({
    where: {
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      OR: [
        { scheduledStartTime: { gte: from, lte: until } },
        { status: { in: [...ONGOING_STATUSES] } },
      ],
    },
    orderBy: { scheduledStartTime: 'asc' },
  });
  return rows.filter((t) => !isRegularDaily(t)).map((t) => toSpecial(t, ctx.now));
}

async function main() {
  const days = Number(argValue(process.argv, 'days') ?? 3);
  if (!Number.isFinite(days) || days < 0) throw new Error(`--days の値が不正です: ${days}`);

  const ctx = createContext(process.argv);
  try {
    const specials = await findSpecials(ctx, days);
    for (const s of specials) console.log(JSON.stringify(s));
    ctx.log('specials', specials.length === 0 ? 'specials=none' : `specials=${specials.length}`, {
      days,
    });
  } finally {
    await ctx.prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
