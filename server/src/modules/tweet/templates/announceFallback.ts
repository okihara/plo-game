/**
 * ANNOUNCE（開催告知）の定型フォールバック文。
 *
 * 通常はサーバー側の LLM 生成（promptTemplates/announce.ts）を使うが、
 * 投稿期限までに DRAFT が用意できない場合に ops がこの定型文で直接投稿する。
 * 冒頭2行の固定文言は LLM 版と共通の規約。
 */
import { VARIANT_DISPLAY_NAMES, type GameVariant } from '@plo/shared';
import type { AnnounceContext } from '../data/announceData.js';
import { assertTweetLength } from './tweetLength.js';

/** 告知文で使う種目の読み表記（略称だけで通じないものは補足つき） */
const VARIANT_ANNOUNCE_LABELS: Partial<Record<GameVariant, string>> = {
  plo: 'PLO',
  plo5: 'PLO5（5枚PLO）',
  plo_hilo: 'PLO8（Hi-Lo）',
  plo_double_board_bomb: 'Double Board Bomb Pot',
};

export function announceVariantLabel(gameVariant: string): string {
  return (
    VARIANT_ANNOUNCE_LABELS[gameVariant as GameVariant] ??
    VARIANT_DISPLAY_NAMES[gameVariant as GameVariant] ??
    gameVariant
  );
}

export function buildAnnounceFallbackText(
  context: AnnounceContext,
  specialNote?: string,
): string {
  const lines: string[] = [
    '参加無料のオンラインPLOトーナメント',
    '今夜も22:00から開催です！',
    '',
  ];

  const prev = context.previousResult;
  if (prev && !prev.tournament.stale && prev.winner) {
    lines.push(
      `昨夜は ${prev.winner.displayName} さんが ${prev.tournament.totalEntries}エントリーを制して優勝🏆`,
    );
  }

  lines.push(`今夜の種目は ${announceVariantLabel(context.today.gameVariant)}💪`);
  if (specialNote) {
    lines.push(`${specialNote}🎁`);
  }

  lines.push('');
  lines.push('#BabyPLO');
  lines.push('https://baby-plo.app');
  return assertTweetLength(lines.join('\n'));
}
