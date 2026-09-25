import type { TournamentEntryStatus } from '@plo/shared';
import type { TournamentInstance } from './TournamentInstance.js';

type EntryStatusSource = Pick<TournamentInstance, 'getPlayer' | 'canReenter'>;

/**
 * DB の参加記録とメモリ上のプレイヤー状態から、ユーザーの参加状態を一つに決める。
 * 一覧 API・リエントリー API・着席処理はすべてこの判定を使い、判定の源泉を一箇所に保つ。
 *
 * 呼び出し側は TournamentRegistration が存在することを確認済みであること。
 *
 * @param dbReentryCount TournamentRegistration.reentryCount（課金済みのリエントリー回数）
 */
export function resolveEntryStatus(
  tournament: EntryStatusSource,
  userId: string,
  dbReentryCount: number,
): TournamentEntryStatus {
  const player = tournament.getPlayer(userId);
  // DB 登録済みでメモリ未着席も「参加中」。卓に入れば着席する
  if (!player || player.status !== 'eliminated') return 'entered';
  // 課金済みだがメモリ側のリエントリーが未実行。卓に入れば復帰する
  if (dbReentryCount > player.reentryCount) return 'reentry_pending';
  if (tournament.canReenter(userId)) return 'can_reenter';
  return 'eliminated';
}
