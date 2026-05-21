/**
 * TweetDraft の polling ループ。
 *
 * 60 秒ごとに 2 つのことをする:
 *  1. tickFinishedTournaments: COMPLETED で RESULT ドラフト未作成のトナメを enqueue
 *  2. runDuePendingGenerations: PENDING → GENERATING → DRAFT/FAILED を進める
 *
 * TournamentManager 側にフックを差し込まず、DB を polling することで
 * ドメインへの侵襲を避けている。時刻ベースの enqueue（ANNOUNCE / START
 * / PROGRESS）は P4/P5 で追加予定。
 *
 * 既存 rankingBadgeScheduler.ts の setInterval パターンを踏襲。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { Sentry, sentryEnabled } from '../../config/sentry.js';
import { env } from '../../config/env.js';
import { enqueueResultAndRanking } from './enqueue.js';
import { generate } from './generator.js';
import { TweetKind, TweetStatus } from './types.js';

const CHECK_INTERVAL_MS = 60_000;
const MAX_BATCH = 5;
/** 過去 N 時間以内に完了したトナメだけを検知対象にする（ずっと古いものは拾わない） */
const FINISHED_LOOKBACK_HOURS = 24;

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
      await prisma.tweetDraft.update({
        where: { id: d.id },
        data: {
          status: TweetStatus.DRAFT,
          generatedText: result.text,
          promptVersion: result.promptVersion,
          promptInputJson: result.promptInputJson as Prisma.InputJsonValue,
          errorMessage: null,
        },
      });
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
      await tickFinishedTournaments();
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
