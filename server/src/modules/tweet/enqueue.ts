/**
 * scheduler の各 tick から呼ばれる enqueue 関数群。
 * TweetDraft を PENDING で upsert する。
 *
 * @@unique([kind, tournamentId]) + update:{} のおかげで、同一トナメに対する
 * 多重 enqueue は弾かれる（手動 DISCARD したドラフトも勝手に復活しない）。
 */
import { prisma } from '../../config/database.js';
import { Sentry, sentryEnabled } from '../../config/sentry.js';
import { TweetKind, TweetStatus } from './types.js';

async function enqueueKind(kind: TweetKind, tournamentId: string, scheduledFor: Date): Promise<void> {
  try {
    await prisma.tweetDraft.upsert({
      where: { kind_tournamentId: { kind, tournamentId } },
      create: { kind, tournamentId, scheduledFor, status: TweetStatus.PENDING },
      update: {}, // 既存ならノータッチ（手動 DISCARD したものを勝手に復活させない）
    });
    console.log(`[TweetEnqueue] enqueued ${kind} draft for tournament=${tournamentId}`);
  } catch (err) {
    console.error(`[TweetEnqueue] failed to enqueue ${kind} for ${tournamentId}:`, err);
    if (sentryEnabled) {
      Sentry.withScope((scope) => {
        scope.setTag('source', 'tweetEnqueue');
        scope.setContext('tournament', { id: tournamentId, kind });
        Sentry.captureException(err);
      });
    }
  }
}

export async function enqueueResultAndRanking(tournamentId: string): Promise<void> {
  await enqueueKind(TweetKind.RESULT, tournamentId, new Date());
  // RANKING は P3 で実装。enqueue は同じパターンになる予定。
}

/**
 * 開催予定のトナメに対する ANNOUNCE ドラフトを enqueue。
 * scheduledFor はトナメ開始時刻にする（一覧の並び順に使うため）。
 */
export async function enqueueAnnounce(
  tournamentId: string,
  scheduledStartTime: Date,
): Promise<void> {
  await enqueueKind(TweetKind.ANNOUNCE, tournamentId, scheduledStartTime);
}
