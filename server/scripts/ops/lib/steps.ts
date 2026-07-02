/// <reference types="node" />
/**
 * daily-ops-tick の各ステップ（冪等な状態機械）。
 *
 * 冪等化・二重投稿防止の要は TweetDraft の @@unique([kind, tournamentId])。
 * ローカル発の投稿（START / PROGRESS / RANKING / ANNOUNCE フォールバック）は
 * 「create(status=POSTING) が claim を兼ねる」パターンで排他する。
 * サーバー scheduler の reclaimStuckDrafts が POSTING を5分で FAILED に倒すため、
 * claim 後は同一 tick 内で投稿まで完了させ、FAILED は自動再投稿しない（通知のみ）。
 */
import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { Prisma, TweetKind, TweetStatus, type Tournament, type TweetDraft } from '@prisma/client';
import { jstDate, opsDateParts, type JstParts } from '../../../src/shared/timeJst.js';
import {
  DAILY_START_HOUR_JST,
  DAILY_TOURNAMENT_BASE_CONFIG,
  buildDailyTournamentName,
  planForWeekday,
} from '../../../src/modules/tournament/weeklySchedule.js';
import { fetchAnnounceContext } from '../../../src/modules/tweet/data/announceData.js';
import { fetchProgressData } from '../../../src/modules/tweet/data/progressData.js';
import { resolveAnnounceImagePath } from '../../../src/modules/tweet/announceImage.js';
import { buildAnnounceFallbackText } from '../../../src/modules/tweet/templates/announceFallback.js';
import { buildStartText } from '../../../src/modules/tweet/templates/start.js';
import { buildProgressText } from '../../../src/modules/tweet/templates/progress.js';
import { buildRankingText } from '../../../src/modules/tweet/templates/ranking.js';
import { getCredentialsFromEnv, postTweet } from '../../../src/modules/tweet/twitterClient.js';
import {
  computeRankingDiff,
  fetchSeasonTournaments,
} from '../../../src/modules/season/computeSeasonRanking.js';
import { SERVER_ROOT, type OpsContext, type StepName } from './context.js';
import { notifyOnce } from './notify.js';

const execFileAsync = promisify(execFile);

// 実行窓（JST・営業日基準）
const CREATE_FROM_H = 11;
const CREATE_UNTIL = { h: 21, m: 30 };
const ANNOUNCE_FROM_H = 18;
const ANNOUNCE_FALLBACK_FROM_H = 19;
const START_WINDOW_MS = 45 * 60_000;
const PROGRESS_AFTER_START_MS = 15 * 60_000;
const PROGRESS_BEFORE_DEADLINE_MS = 2 * 60_000;
const RESULT_ENQUEUE_GRACE_MS = 10 * 60_000;
const RANKING_TOP_N = 30;
const RANKING_IMAGE_PATH = '/tmp/rp-ranking.png';

interface TickState {
  bd: JstParts;
  bdKey: string;
  /** 営業日の JST 時刻を UTC Date にする */
  at(hour: number, minute?: number): Date;
  tournament: Tournament | null;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

async function getDraft(
  ctx: OpsContext,
  kind: TweetKind,
  tournamentId: string,
): Promise<TweetDraft | null> {
  return ctx.prisma.tweetDraft.findUnique({
    where: { kind_tournamentId: { kind, tournamentId } },
  });
}

/** create(POSTING) を claim として使う。既存行があれば 'exists'。 */
async function claimNewDraft(
  ctx: OpsContext,
  kind: TweetKind,
  tournamentId: string,
  scheduledFor: Date,
): Promise<'claimed' | 'exists'> {
  try {
    await ctx.prisma.tweetDraft.create({
      data: { kind, tournamentId, scheduledFor, status: TweetStatus.POSTING },
    });
    return 'claimed';
  } catch (e) {
    if (isUniqueViolation(e)) return 'exists';
    throw e;
  }
}

/** 投稿しないことを確定させる行を作る（翌日の誤爆防止・スキップ記録） */
async function markDiscarded(
  ctx: OpsContext,
  kind: TweetKind,
  tournamentId: string,
  scheduledFor: Date,
  reason: string,
): Promise<void> {
  try {
    await ctx.prisma.tweetDraft.create({
      data: {
        kind,
        tournamentId,
        scheduledFor,
        status: TweetStatus.DISCARDED,
        errorMessage: reason,
      },
    });
    ctx.log(kind.toLowerCase(), `discarded: ${reason}`);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}

/**
 * claim 済みの行に対して X へ直接投稿し、結果を書き戻す。
 * 投稿失敗時は FAILED を記録して throw（自動再投稿はしない）。
 */
async function postClaimedDraft(
  ctx: OpsContext,
  kind: TweetKind,
  tournamentId: string,
  text: string,
  options?: { imagePath?: string; promptVersion?: string },
): Promise<void> {
  const where = { kind_tournamentId: { kind, tournamentId } };
  try {
    const imagePath = options?.imagePath;
    const image = imagePath && existsSync(imagePath) ? readFileSync(imagePath) : undefined;
    const { tweetId } = await postTweet(getCredentialsFromEnv(), { text, image });
    await ctx.prisma.tweetDraft.update({
      where,
      data: {
        status: TweetStatus.POSTED,
        generatedText: text,
        promptVersion: options?.promptVersion ?? null,
        attachedImagePath: image ? imagePath : null,
        postedTweetId: tweetId,
        postedAt: new Date(),
        errorMessage: null,
      },
    });
    ctx.log(kind.toLowerCase(), `posted tweetId=${tweetId}`, { hasImage: !!image });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.prisma.tweetDraft.update({
      where,
      data: { status: TweetStatus.FAILED, errorMessage: msg, retryCount: { increment: 1 } },
    });
    throw err;
  }
}

/** 営業日内（JST 00:00〜24:00）に開始予定のトナメを1本に解決する */
async function resolveTodayTournament(ctx: OpsContext, state: Omit<TickState, 'tournament'>): Promise<Tournament | null> {
  const candidates = await ctx.prisma.tournament.findMany({
    where: {
      scheduledStartTime: { gte: state.at(0), lt: state.at(24) },
      status: { not: 'CANCELLED' },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const startAt = state.at(DAILY_START_HOUR_JST).getTime();
  const atDefault = candidates.filter((t) => t.scheduledStartTime!.getTime() === startAt);
  const picked = (atDefault[0] ?? candidates[0]);
  ctx.log('resolve', `本日のトナメ候補が複数あります（${candidates.length}件）。${picked.id} を採用`, {
    candidates: candidates.map((t) => t.id),
  });
  return picked;
}

// ============================================
// Step 1: トナメ作成
// ============================================
async function stepCreate(ctx: OpsContext, state: TickState): Promise<void> {
  if (state.tournament) return;
  if (ctx.now < state.at(CREATE_FROM_H) || ctx.now > state.at(CREATE_UNTIL.h, CREATE_UNTIL.m)) {
    return;
  }

  const plan = planForWeekday(state.bd.weekday);
  const name = buildDailyTournamentName(plan, { month: state.bd.month, day: state.bd.day });
  const scheduledStartTime = state.at(DAILY_START_HOUR_JST);
  const body = {
    ...DAILY_TOURNAMENT_BASE_CONFIG,
    name,
    gameVariant: plan.gameVariant,
    structureId: plan.structureId,
    startCondition: 'scheduled',
    scheduledStartTime: scheduledStartTime.toISOString(),
  };

  if (ctx.dryRun) {
    ctx.log('create', `[dry-run] would create tournament: ${name}`, { body });
    return;
  }

  const res = await ctx.api.post('/api/tournaments', body);
  ctx.log('create', `created tournament ${res.tournamentId}: ${res.name}`);

  // サーバーメモリへの登録確認（一覧の active はメモリ由来）
  const list = await ctx.api.get('/api/tournaments');
  const found = (list.tournaments as { id: string }[]).some((t) => t.id === res.tournamentId);
  if (!found) {
    throw new Error(`作成した ${res.tournamentId} がサーバーのアクティブ一覧に見えません`);
  }
  state.tournament = await ctx.prisma.tournament.findUnique({ where: { id: res.tournamentId } });
}

// ============================================
// Step 2: メモリ存在ウォッチドッグ
// ============================================
async function stepWatchdog(ctx: OpsContext, state: TickState): Promise<void> {
  const t = state.tournament;
  if (!t || t.status !== 'WAITING' || !t.scheduledStartTime) return;
  if (ctx.now >= t.scheduledStartTime) return;

  const list = await ctx.api.get('/api/tournaments');
  const found = (list.tournaments as { id: string }[]).some((x) => x.id === t.id);
  if (!found) {
    await notifyOnce(
      ctx,
      state.bdKey,
      'memory-lost',
      `トナメ ${t.name} がサーバーメモリから消えています（再デプロイ？）。Admin から作り直してください`,
    );
  }
}

// ============================================
// Step 3: ANNOUNCE（サーバー生成 DRAFT の投稿 + フォールバック）
// ============================================
async function stepAnnounce(ctx: OpsContext, state: TickState): Promise<void> {
  const t = state.tournament;
  if (!t || !t.scheduledStartTime) return;
  const from = state.at(ANNOUNCE_FROM_H);
  const until = state.at(CREATE_UNTIL.h, CREATE_UNTIL.m);
  if (ctx.now < from || ctx.now > until || ctx.now >= t.scheduledStartTime) return;

  const draft = await getDraft(ctx, TweetKind.ANNOUNCE, t.id);

  if (draft?.status === TweetStatus.POSTED || draft?.status === TweetStatus.DISCARDED) return;

  if (draft?.status === TweetStatus.DRAFT) {
    if (ctx.dryRun) {
      ctx.log('announce', '[dry-run] would post server-generated draft', { draftId: draft.id });
      return;
    }
    const res = await ctx.api.post(`/api/admin/tweets/${draft.id}/post`);
    if (res.ok) {
      ctx.log('announce', `posted server draft tweetId=${res.tweetId}`);
    } else {
      ctx.log('announce', `post failed: ${res.errorMessage}（19時以降にフォールバック）`);
    }
    return;
  }

  if (!draft) {
    // scheduler が未検知（通常は作成から数分で enqueue されるので異常系）→ 手動 enqueue
    if (ctx.dryRun) {
      ctx.log('announce', '[dry-run] would enqueue ANNOUNCE via /api/admin/tweets/manual');
      return;
    }
    await ctx.api.post('/api/admin/tweets/manual', { kind: 'ANNOUNCE', tournamentId: t.id });
    ctx.log('announce', 'enqueued ANNOUNCE draft（次tickで生成待ち）');
    return;
  }

  // PENDING / GENERATING / FAILED
  if (ctx.now < state.at(ANNOUNCE_FALLBACK_FROM_H)) {
    ctx.log('announce', `waiting for server generation (status=${draft.status})`);
    return;
  }
  if (draft.status === TweetStatus.GENERATING) {
    // 生成中は奪わない（固まっていれば server の reclaim が PENDING に戻す）
    ctx.log('announce', 'still GENERATING; waiting for server reclaim');
    return;
  }

  // 期限超過 → 定型文フォールバックで直接投稿
  const context = await fetchAnnounceContext(ctx.prisma, t.id);
  if (!context) throw new Error(`fetchAnnounceContext failed for ${t.id}`);
  const text = buildAnnounceFallbackText(context, context.specialNote);
  const imagePath = resolveAnnounceImagePath(t.scheduledStartTime, t.gameVariant);

  if (ctx.dryRun) {
    ctx.log('announce', `[dry-run] would post fallback announce:\n${text}`, { imagePath });
    return;
  }

  const claim = await ctx.prisma.tweetDraft.updateMany({
    where: {
      kind: TweetKind.ANNOUNCE,
      tournamentId: t.id,
      status: { in: [TweetStatus.PENDING, TweetStatus.FAILED] },
    },
    data: { status: TweetStatus.POSTING },
  });
  if (claim.count === 0) {
    ctx.log('announce', 'fallback claim lost（他プロセスが処理中）');
    return;
  }
  await postClaimedDraft(ctx, TweetKind.ANNOUNCE, t.id, text, {
    imagePath,
    promptVersion: 'announce-fallback-v1',
  });
  await notifyOnce(ctx, state.bdKey, 'announce-fallback', 'LLM告知が間に合わず定型文で投稿しました');
}

// ============================================
// Step 4: START（定型文の直接投稿）
// ============================================
async function stepStart(ctx: OpsContext, state: TickState): Promise<void> {
  const t = state.tournament;
  if (!t || !t.scheduledStartTime) return;
  if (ctx.now < t.scheduledStartTime) return;

  const existing = await getDraft(ctx, TweetKind.START, t.id);
  if (existing) return;

  if (ctx.now.getTime() > t.scheduledStartTime.getTime() + START_WINDOW_MS) {
    if (ctx.dryRun) {
      ctx.log('start', '[dry-run] window missed; would discard');
      return;
    }
    await markDiscarded(ctx, TweetKind.START, t.id, t.scheduledStartTime, 'start window missed');
    await notifyOnce(ctx, state.bdKey, 'start-missed', 'STARTツイートの投稿窓を逃しました');
    return;
  }

  const data = await fetchProgressData(ctx.prisma, t.id);
  if (!data) throw new Error(`fetchProgressData failed for ${t.id}`);
  const text = buildStartText({
    tournamentName: data.tournamentName,
    lateRegDeadline: data.lateRegDeadline,
  });

  if (ctx.dryRun) {
    ctx.log('start', `[dry-run] would post:\n${text}`);
    return;
  }
  if ((await claimNewDraft(ctx, TweetKind.START, t.id, t.scheduledStartTime)) === 'exists') return;
  await postClaimedDraft(ctx, TweetKind.START, t.id, text);
}

// ============================================
// Step 5: PROGRESS（進行状況＋レイトレジ締切）
// ============================================
async function stepProgress(ctx: OpsContext, state: TickState): Promise<void> {
  const t = state.tournament;
  if (!t || !t.scheduledStartTime) return;
  const from = t.scheduledStartTime.getTime() + PROGRESS_AFTER_START_MS;
  if (ctx.now.getTime() < from) return;

  const existing = await getDraft(ctx, TweetKind.PROGRESS, t.id);
  if (existing) return;

  const data = await fetchProgressData(ctx.prisma, t.id);
  if (!data) throw new Error(`fetchProgressData failed for ${t.id}`);
  const until = data.lateRegDeadline.getTime() - PROGRESS_BEFORE_DEADLINE_MS;

  if (ctx.now.getTime() > until || t.status === 'COMPLETED') {
    ctx.log('progress', 'window missed; discarding');
    if (!ctx.dryRun) {
      await markDiscarded(ctx, TweetKind.PROGRESS, t.id, t.scheduledStartTime, 'progress window missed');
    }
    return;
  }

  if (data.totalEntries < 2) {
    // エントリーがほぼ無い夜に「0エントリー」と晒さない
    ctx.log('progress', `skipped: totalEntries=${data.totalEntries} too few`);
    if (!ctx.dryRun) {
      await markDiscarded(ctx, TweetKind.PROGRESS, t.id, t.scheduledStartTime, `totalEntries=${data.totalEntries} too few`);
    }
    return;
  }

  const text = buildProgressText({
    tournamentName: data.tournamentName,
    totalEntries: data.totalEntries,
    lateRegDeadline: data.lateRegDeadline,
  });

  if (ctx.dryRun) {
    ctx.log('progress', `[dry-run] would post:\n${text}`);
    return;
  }
  if ((await claimNewDraft(ctx, TweetKind.PROGRESS, t.id, t.scheduledStartTime)) === 'exists') return;
  await postClaimedDraft(ctx, TweetKind.PROGRESS, t.id, text);
}

// ============================================
// Step 6: RESULT（サーバー生成 DRAFT の投稿）
// ============================================
async function stepResult(ctx: OpsContext, state: TickState): Promise<void> {
  const t = state.tournament;
  if (!t || t.status !== 'COMPLETED') return;

  const draft = await getDraft(ctx, TweetKind.RESULT, t.id);

  if (draft?.status === TweetStatus.POSTED || draft?.status === TweetStatus.DISCARDED) return;

  if (draft?.status === TweetStatus.DRAFT) {
    if (ctx.dryRun) {
      ctx.log('result', '[dry-run] would post server-generated draft', { draftId: draft.id });
      return;
    }
    const res = await ctx.api.post(`/api/admin/tweets/${draft.id}/post`);
    if (res.ok) {
      ctx.log('result', `posted server draft tweetId=${res.tweetId}`);
    } else {
      await notifyOnce(ctx, state.bdKey, 'result-post-failed', `結果ツイートの投稿に失敗: ${res.errorMessage}`);
    }
    return;
  }

  if (draft?.status === TweetStatus.FAILED) {
    if (draft.retryCount < 2) {
      if (ctx.dryRun) {
        ctx.log('result', '[dry-run] would regenerate failed draft');
        return;
      }
      await ctx.api.post(`/api/admin/tweets/${draft.id}/regenerate`);
      ctx.log('result', `regenerate requested (retryCount=${draft.retryCount})`);
    } else {
      await notifyOnce(ctx, state.bdKey, 'result-failed', '結果ツイートの生成が繰り返し失敗。Admin から確認してください');
    }
    return;
  }

  if (!draft) {
    const completedAt = t.completedAt?.getTime() ?? 0;
    if (ctx.now.getTime() - completedAt < RESULT_ENQUEUE_GRACE_MS) return; // scheduler の検知を待つ
    if (ctx.dryRun) {
      ctx.log('result', '[dry-run] would enqueue RESULT via /api/admin/tweets/manual');
      return;
    }
    await ctx.api.post('/api/admin/tweets/manual', { kind: 'RESULT', tournamentId: t.id });
    ctx.log('result', 'enqueued RESULT draft（次tickで生成待ち）');
    return;
  }

  ctx.log('result', `waiting for server generation (status=${draft.status})`);
}

// ============================================
// Step 7: RANKING（決定的テンプレ＋画像の直接投稿）
// ============================================
async function renderRankingImage(ctx: OpsContext): Promise<string | undefined> {
  const tsxBin = join(SERVER_ROOT, 'node_modules', '.bin', 'tsx');
  const args = [
    'scripts/rank-points-ranking.ts',
    ...(ctx.prod ? ['--prod'] : []),
    `--top=${RANKING_TOP_N}`,
    `--image=${RANKING_IMAGE_PATH}`,
  ];
  try {
    await execFileAsync(tsxBin, args, { cwd: SERVER_ROOT, timeout: 120_000 });
    return existsSync(RANKING_IMAGE_PATH) ? RANKING_IMAGE_PATH : undefined;
  } catch (err) {
    ctx.log('ranking', `image render failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function stepRanking(ctx: OpsContext, state: TickState): Promise<void> {
  const t = state.tournament;
  if (!t || t.status !== 'COMPLETED') return;

  const resultDraft = await getDraft(ctx, TweetKind.RESULT, t.id);
  if (resultDraft?.status !== TweetStatus.POSTED) return; // 結果ポストの後にだけ流す

  const existing = await getDraft(ctx, TweetKind.RANKING, t.id);
  if (existing) {
    if (existing.status === TweetStatus.FAILED) {
      await notifyOnce(ctx, state.bdKey, 'ranking-failed', 'ランキングツイートが失敗しています。ログを確認してください');
    }
    return;
  }

  const tournaments = await fetchSeasonTournaments(ctx.prisma);
  const diff = computeRankingDiff(tournaments, RANKING_TOP_N);

  if (ctx.dryRun) {
    if (!diff) {
      ctx.log('ranking', '[dry-run] diff unavailable（完了トナメ2本未満）; would discard');
    } else {
      ctx.log('ranking', `[dry-run] would post:\n${buildRankingText(diff)}`);
    }
    return;
  }

  if ((await claimNewDraft(ctx, TweetKind.RANKING, t.id, ctx.now)) === 'exists') return;
  const where = { kind_tournamentId: { kind: TweetKind.RANKING, tournamentId: t.id } };

  if (!diff) {
    await ctx.prisma.tweetDraft.update({
      where,
      data: { status: TweetStatus.DISCARDED, errorMessage: 'シーズン完了トナメが2本未満のためスキップ' },
    });
    ctx.log('ranking', 'skipped: season has fewer than 2 completed tournaments');
    return;
  }
  if (diff.latestTournament.id !== t.id) {
    await ctx.prisma.tweetDraft.update({
      where,
      data: {
        status: TweetStatus.FAILED,
        errorMessage: `diff の最新トナメ ${diff.latestTournament.id} が本日の ${t.id} と一致しません`,
      },
    });
    await notifyOnce(ctx, state.bdKey, 'ranking-mismatch', 'ランキング差分の最新トナメが今日のトナメと一致せず中断しました');
    return;
  }

  const text = buildRankingText(diff);
  const imagePath = await renderRankingImage(ctx);
  if (!imagePath) {
    await notifyOnce(ctx, state.bdKey, 'ranking-no-image', 'ランキング画像の生成に失敗したため画像なしで投稿します');
  }
  await postClaimedDraft(ctx, TweetKind.RANKING, t.id, text, {
    imagePath,
    promptVersion: 'ranking-template-v1',
  });
}

// ============================================
// tick 実行
// ============================================
const STEP_FNS: [StepName, (ctx: OpsContext, state: TickState) => Promise<void>][] = [
  ['create', stepCreate],
  ['watchdog', stepWatchdog],
  ['announce', stepAnnounce],
  ['start', stepStart],
  ['progress', stepProgress],
  ['result', stepResult],
  ['ranking', stepRanking],
];

export async function runTick(ctx: OpsContext): Promise<boolean> {
  const bd = opsDateParts(ctx.now);
  const bdKey = `${bd.year}-${String(bd.month).padStart(2, '0')}-${String(bd.day).padStart(2, '0')}`;
  const at = (hour: number, minute = 0) => jstDate(bd.year, bd.month, bd.day, hour, minute);

  const partial: Omit<TickState, 'tournament'> = { bd, bdKey, at };
  const tournament = await resolveTodayTournament(ctx, partial);
  const state: TickState = { ...partial, tournament };

  ctx.log('tick', `businessDay=${bdKey} tournament=${tournament ? `${tournament.id} (${tournament.status})` : 'none'}`, {
    dryRun: ctx.dryRun,
    prod: ctx.prod,
  });

  let ok = true;
  for (const [name, fn] of STEP_FNS) {
    if (!ctx.isStepEnabled(name)) continue;
    try {
      await fn(ctx, state);
    } catch (err) {
      ok = false;
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log(name, `ERROR: ${msg}`);
      await notifyOnce(ctx, bdKey, `error-${name}`, `daily-ops ${name} が失敗: ${msg.slice(0, 120)}`);
    }
  }
  return ok;
}
