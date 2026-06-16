/**
 * TweetDraft の polling ループ。
 *
 * 60 秒ごとに 4 つのことをする:
 *  1. reclaimStuckDrafts: クラッシュ等で GENERATING/POSTING のまま固まった行を回収
 *  2. tickFinishedTournaments: COMPLETED で RESULT ドラフト未作成のトナメを enqueue
 *  3. tickUpcomingTournaments: 24h 以内に始まる WAITING で ANNOUNCE 未作成のトナメを enqueue
 *  4. runDuePendingGenerations: PENDING → GENERATING → DRAFT/FAILED を進める
 *
 * TournamentManager 側にフックを差し込まず、DB を polling することで
 * ドメインへの侵襲を避けている。START / PROGRESS は P5 で追加予定。
 *
 * 既存 rankingBadgeScheduler.ts の setInterval パターンを踏襲。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { Sentry, sentryEnabled } from '../../config/sentry.js';
import { env } from '../../config/env.js';
import { fetchUpcomingTournaments } from './data/announceData.js';
import { enqueueAnnounce, enqueueResultAndRanking } from './enqueue.js';
import { generate } from './generator.js';
import { TweetKind, TweetStatus } from './types.js';

const CHECK_INTERVAL_MS = 60_000;
const MAX_BATCH = 5;
/** 過去 N 時間以内に完了したトナメだけを検知対象にする（ずっと古いものは拾わない） */
const FINISHED_LOOKBACK_HOURS = 24;
/**
 * GENERATING/POSTING のまま updatedAt がこの時間より古い行は「クラッシュで取り残された」とみなす。
 * 生成（数秒）・投稿（数秒）の実時間より十分大きく取り、処理中の行を誤って奪わないようにする。
 */
const STUCK_THRESHOLD_MS = 5 * 60_000;

/**
 * プロセスのクラッシュ等で中間状態のまま取り残された行を回収する。
 * - GENERATING: LLM 呼び出しのみで外部副作用が無いため、PENDING に戻して自動再試行させる。
 * - POSTING: X へ送信済みかどうか判定できないため、自動再投稿はせず FAILED にして人手確認に回す
 *   （重複投稿を避ける。管理画面で X を確認のうえ再投稿できる）。
 */
export async function reclaimStuckDrafts(): Promise<void> {
  const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const regen = await prisma.tweetDraft.updateMany({
    where: { status: TweetStatus.GENERATING, updatedAt: { lt: threshold } },
    data: { status: TweetStatus.PENDING },
  });
  if (regen.count > 0) {
    console.warn(`[TweetScheduler] reclaimed ${regen.count} stuck GENERATING draft(s) -> PENDING`);
  }

  const stuckPost = await prisma.tweetDraft.updateMany({
    where: { status: TweetStatus.POSTING, updatedAt: { lt: threshold } },
    data: {
      status: TweetStatus.FAILED,
      errorMessage: 'posting がタイムアウトしました。X に投稿済みでないか確認してから再投稿してください。',
    },
  });
  if (stuckPost.count > 0) {
    console.warn(`[TweetScheduler] reclaimed ${stuckPost.count} stuck POSTING draft(s) -> FAILED`);
  }
}

/**
 * COMPLETED で RESULT ドラフトがまだ無いトナメを見つけて enqueue する。
 * @@unique([kind, tournamentId]) のおかげで多重 enqueue は upsert で吸収。
 */
export async function tickFinishedTournaments(): Promise<void> {
  const since = new Date(Date.now() - FINISHED_LOOKBACK_HOURS * 60 * 60 * 1000);
  const finished = await prisma.tournament.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { gte: since },
      tweetDrafts: { none: { kind: TweetKind.RESULT } },
    },
    select: { id: true },
    take: MAX_BATCH,
  });
  for (const t of finished) {
    await enqueueResultAndRanking(t.id);
  }
}

/**
 * 24時間以内に開始予定の WAITING トナメで ANNOUNCE ドラフトがまだ無いものを enqueue する。
 */
export async function tickUpcomingTournaments(): Promise<void> {
  const upcoming = await fetchUpcomingTournaments(prisma, MAX_BATCH);
  for (const t of upcoming) {
    if (!t.scheduledStartTime) continue;
    await enqueueAnnounce(t.id, t.scheduledStartTime);
  }
}

/**
 * PENDING な行を見つけて、楽観ロックで GENERATING に遷移させ、
 * LLM を呼んで DRAFT/FAILED にする。同時実行は updateMany の戻り値で防ぐ。
 */
export async function runDuePendingGenerations(): Promise<void> {
  const due = await prisma.tweetDraft.findMany({
    where: { status: TweetStatus.PENDING },
    orderBy: { createdAt: 'asc' },
    take: MAX_BATCH,
  });
  for (const d of due) {
    const claim = await prisma.tweetDraft.updateMany({
      where: { id: d.id, status: TweetStatus.PENDING },
      data: { status: TweetStatus.GENERATING },
    });
    if (claim.count === 0) continue; // 他で取られた
    try {
      const fresh = await prisma.tweetDraft.findUniqueOrThrow({ where: { id: d.id } });
      const result = await generate(fresh);
      // 生成中に reclaimStuckDrafts で奪われている可能性があるため、
      // まだ自分が掴んでいる GENERATING のときだけ書き戻す（再生成結果の上書き防止）。
      const written = await prisma.tweetDraft.updateMany({
        where: { id: d.id, status: TweetStatus.GENERATING },
        data: {
          status: TweetStatus.DRAFT,
          generatedText: result.text,
          promptVersion: result.promptVersion,
          promptInputJson: result.promptInputJson as Prisma.InputJsonValue,
          attachedImagePath: result.attachedImagePath ?? null,
          errorMessage: null,
        },
      });
      if (written.count === 0) {
        console.warn(`[TweetScheduler] draft=${d.id} was reclaimed mid-generation; discarding result`);
        continue;
      }
      console.log(`[TweetScheduler] Generated ${d.kind} draft=${d.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.tweetDraft.update({
        where: { id: d.id },
        data: {
          status: TweetStatus.FAILED,
          errorMessage: msg,
          retryCount: { increment: 1 },
        },
      });
      console.error(`[TweetScheduler] Generation failed for draft=${d.id}:`, msg);
      if (sentryEnabled) {
        Sentry.withScope((scope) => {
          scope.setTag('source', 'tweetScheduler');
          scope.setContext('draft', { id: d.id, kind: d.kind });
          Sentry.captureException(err);
        });
      }
    }
  }
}

export function startTweetScheduler(): void {
  if (!env.TWEET_SCHEDULER_ENABLED) {
    console.log('[TweetScheduler] disabled (TWEET_SCHEDULER_ENABLED=false)');
    return;
  }
  const tick = async () => {
    try {
      await reclaimStuckDrafts();
      await tickFinishedTournaments();
      await tickUpcomingTournaments();
      await runDuePendingGenerations();
    } catch (err) {
      console.error('[TweetScheduler] tick error:', err);
      if (sentryEnabled) {
        Sentry.withScope((scope) => {
          scope.setTag('source', 'tweetScheduler');
          Sentry.captureException(err);
        });
      }
    }
  };
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`[TweetScheduler] started (every ${CHECK_INTERVAL_MS / 1000}s)`);
}
