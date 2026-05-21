/**
 * TournamentManager.onTournamentComplete から呼ばれるフック。
 * RESULT（と将来は RANKING）の TweetDraft を PENDING で upsert する。
 *
 * fire-and-forget で呼ばれる前提なので、内部例外は console.error のみ出して
 * 上位に伝播させない。
 */
import { prisma } from '../../config/database.js';
import { Sentry, sentryEnabled } from '../../config/sentry.js';
import { TweetKind, TweetStatus } from './types.js';

export async function enqueueResultAndRanking(tournamentId: string): Promise<void> {
  const now = new Date();
  try {
    await prisma.tweetDraft.upsert({
      where: { kind_tournamentId: { kind: TweetKind.RESULT, tournamentId } },
      create: {
        kind: TweetKind.RESULT,
        tournamentId,
        scheduledFor: now,
        status: TweetStatus.PENDING,
      },
      update: {}, // 既存ならノータッチ（手動 DISCARD したものを勝手に復活させない）
    });
    console.log(`[TweetEnqueue] enqueued RESULT draft for tournament=${tournamentId}`);
  } catch (err) {
    console.error(`[TweetEnqueue] failed to enqueue RESULT for ${tournamentId}:`, err);
    if (sentryEnabled) {
      Sentry.withScope((scope) => {
        scope.setTag('source', 'tweetEnqueue');
        scope.setContext('tournament', { id: tournamentId });
        Sentry.captureException(err);
      });
    }
  }
  // RANKING は P3 で実装。enqueue 自体は同じパターンになる予定。
}
