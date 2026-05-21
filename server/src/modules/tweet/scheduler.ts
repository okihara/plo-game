/**
 * TweetDraft の生成ループ。
 *
 * 60秒ごとに PENDING → GENERATING → DRAFT/FAILED を進める。
 * 時刻ベースの enqueue（tickAnnounce / tickStart / tickProgress）は
 * P4/P5 で実装予定で、現状は RESULT/RANKING を onTournamentComplete 経由で
 * enqueue した後の生成だけを担当する。
 *
 * 既存 rankingBadgeScheduler.ts の setInterval パターンを踏襲。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { Sentry, sentryEnabled } from '../../config/sentry.js';
import { env } from '../../config/env.js';
import { generate } from './generator.js';
import { TweetStatus } from './types.js';

const CHECK_INTERVAL_MS = 60_000;
const MAX_BATCH = 5;

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
