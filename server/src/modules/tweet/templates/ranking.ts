/**
 * RANKING（RPランキング更新＋シーズン進捗）ツイートの決定的テンプレート。
 *
 * 文面規約は .claude/skills/ranking-tweet/SKILL.md を移植:
 *   - マーカー: ↑N（ランクアップ）/ --（キープ）/ NEW（圏外からTOP入り）
 *   - ランクダウンはマーカーを書かない（ネガティブ表記禁止）
 *   - 「今回の目玉」1行はルールベースの優先順位で選ぶ
 * 完全自動投稿のため LLM は使わない。
 */
import type { RankingDiff, RankingDiffEntry } from '../../season/computeSeasonRanking.js';
import { CURRENT_SEASON } from '../../season/seasonConfig.js';
import { assertTweetLength } from './tweetLength.js';

const TOP_LINES = 3;

function marker(e: RankingDiffEntry): string | null {
  if (e.isNewToTop) return 'NEW';
  if (e.positionDelta !== null && e.positionDelta > 0) return `↑${e.positionDelta}`;
  if (e.positionDelta === 0) return '--';
  return null; // ランクダウンは表記しない
}

function topLine(e: RankingDiffEntry): string {
  const head = e.position === 1 ? '🏆 ' : '　 ';
  const m = marker(e);
  const suffix = m ? `（${e.totalRp}RP / ${m}）` : `（${e.totalRp}RP）`;
  return `${head}${e.position}位 ${e.name}${suffix}`;
}

/** 「今回の目玉」をルールベースで1行選ぶ */
export function pickHighlight(diff: RankingDiff): string {
  const top = diff.top;

  // 1. 圏外・11位以下から TOP10 入り（ジャンプ幅最大の人）
  const newToTop10 = top
    .filter(
      (e) =>
        e.position <= 10 &&
        (e.previousPosition === null || e.previousPosition > 10) &&
        e.rpGained > 0,
    )
    .sort((a, b) => (b.positionDelta ?? Infinity) - (a.positionDelta ?? Infinity));
  if (newToTop10.length > 0) {
    const e = newToTop10[0];
    return e.previousPosition === null
      ? `${e.name} さんが圏外から一気に ${e.position}位 に登場、TOP10入り`
      : `${e.name} さんが ${e.previousPosition}位 → ${e.position}位 に急浮上して TOP10入り`;
  }

  // 2. 5ランク以上のジャンプアップ
  const bigJump = top
    .filter((e) => (e.positionDelta ?? 0) >= 5)
    .sort((a, b) => b.positionDelta! - a.positionDelta!);
  if (bigJump.length > 0) {
    const e = bigJump[0];
    return `${e.name} さんが ${e.previousPosition}位 → ${e.position}位 にジャンプアップ`;
  }

  // 3. TOP3 内の上昇
  const top3Rise = top.filter((e) => e.position <= 3 && (e.positionDelta ?? 0) > 0);
  if (top3Rise.length > 0) {
    const e = top3Rise[0];
    return `${e.name} さんが ${e.previousPosition}位 → ${e.position}位 に上昇、トップ争いが一段加速`;
  }

  // 4. 首位が加点してリード拡大
  const leader = top.find((e) => e.position === 1);
  if (leader && leader.rpGained > 0) {
    return `1位の ${leader.name} さんは今回も加点してリードを拡大`;
  }

  // 5. フォールバック
  return `${diff.latestTournament.name} の結果を反映しました`;
}

export function buildRankingText(diff: RankingDiff): string {
  const lines: string[] = [];
  lines.push(`【${CURRENT_SEASON.name} RPランキング】${diff.latestTournament.name} 終了時点`);
  lines.push('');
  for (const e of diff.top.slice(0, TOP_LINES)) {
    lines.push(topLine(e));
  }
  lines.push('');
  lines.push('今回の目玉:');
  lines.push(pickHighlight(diff));
  lines.push('');
  lines.push(`シーズン進捗: 完了トナメ ${diff.tournamentsCounted}本 / ランキング入り ${diff.totals.currentRankedUsers}人`);
  lines.push('#BabyPLO');
  return assertTweetLength(lines.join('\n'));
}
