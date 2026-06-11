/**
 * トーナメント結果ツイートの文面を生成する純関数群。
 * DB・X API には依存しない（テスト可能）。
 *
 * 文体・ルールは .claude/skills/tournament-tweet/SKILL.md に準拠:
 * - 順位の列挙は prize > 0 の人数まで（インマネ人数。5位固定ではない）
 * - 生のカード名・生のチップ数は本文に出さない
 * - 役名 / BB換算ポット / ダブルボードのスクープは本文に書いてよい
 * - リエントリー・他プレイヤーの失敗などネガティブな話題は書かない
 * - ハッシュタグは #BabyPLO のみ
 */
import type { TournamentTweetData, TweetHand } from './types.js';

export interface BuildResultTweetOptions {
  /** エントリー数行の前置き（例: 「本日は」「休みの中」「平日の夜に」）。デフォルト「本日は」 */
  entriesLead?: string;
  /** 優勝者コメントを差し替える（指定時はヒューリスティック生成をスキップ） */
  winnerComment?: string;
}

/** "SB/BB" または "SB/BB/アンティ" 形式から実質BBを求める（"0/0/60000" は BBアンティ＝実質BB 60000） */
export function parseEffectiveBB(blinds: string): number {
  const [, bb, ante] = blinds.split('/').map((s) => Number(s));
  return Math.max(bb || 0, ante || 0);
}

/** ダブルボードの finalHand "B1: X / B2: Y" を分解する。シングルボードなら null */
export function parseDoubleBoardHand(finalHand: string): { board1: string; board2: string } | null {
  const m = finalHand.match(/^B1:\s*(.+?)\s*\/\s*B2:\s*(.+)$/);
  if (!m) return null;
  return { board1: m[1], board2: m[2] };
}

interface FinalHandObservation {
  /** 優勝者がそのハンドのポットを獲得したか */
  winnerWonPot: boolean;
  /** ショーダウンの役（シングルボード） */
  handName: string | null;
  /** ダブルボードの役（B1/B2） */
  doubleBoard: { board1: string; board2: string } | null;
  /** ダブルボードで両ボードを総取り（スクープ）したか */
  isScoop: boolean;
  /** BB換算ポット（実質BBが不明なら null） */
  potBB: number | null;
}

/** 最終ハンドから優勝者の決め手を観察する */
export function observeFinalHand(
  hand: TweetHand,
  winnerUserId: string,
): FinalHandObservation {
  const winnerWonPot = hand.winnerUserIds.includes(winnerUserId);
  const winnerPlayer = hand.players.find((p) => p.userId === winnerUserId) ?? null;

  const finalHand = winnerPlayer?.finalHand ?? null;
  const doubleBoard = finalHand ? parseDoubleBoardHand(finalHand) : null;
  // スクープ＝ダブルボードで勝者が優勝者ひとり（両ボードのポットを総取り）
  const isScoop = doubleBoard !== null && winnerWonPot && hand.winnerUserIds.length === 1;

  const effectiveBB = parseEffectiveBB(hand.blinds);
  const potBB = effectiveBB > 0 ? Math.round(hand.potSize / effectiveBB) : null;

  return {
    winnerWonPot,
    handName: doubleBoard ? null : finalHand,
    doubleBoard,
    isScoop,
    potBB,
  };
}

/**
 * 優勝者コメントをヒューリスティックに生成する。
 * 最終ハンドの役・スクープ・BB換算ポットと、終盤の勝率（勢い）だけを材料にする。
 */
export function buildWinnerComment(data: TournamentTweetData): string {
  const winnerUserId = data.winner?.userId;
  const hands = data.lastHands;

  // 終盤の勢い: 優勝者が参加したハンドのうち勝ったハンドの割合
  const participated = winnerUserId
    ? hands.filter((h) => h.players.some((p) => p.userId === winnerUserId))
    : [];
  const wonCount = winnerUserId
    ? participated.filter((h) => h.winnerUserIds.includes(winnerUserId)).length
    : 0;
  const momentum =
    participated.length >= 5 && wonCount / participated.length >= 0.5
      ? '終盤は圧倒的な勢いでチップを積み上げ、'
      : '勝負どころを逃さないプレーで、';

  const fallback = `${momentum}堂々のトップフィニッシュです！`;

  if (!winnerUserId || hands.length === 0) return fallback;

  const obs = observeFinalHand(hands[hands.length - 1], winnerUserId);
  if (!obs.winnerWonPot) return fallback;

  const potPhrase = obs.potBB !== null && obs.potBB >= 5 ? `約${obs.potBB}BBのポット` : 'ポット';

  if (obs.isScoop && obs.doubleBoard) {
    return `${momentum}最後は${obs.doubleBoard.board1}と${obs.doubleBoard.board2}の両ボード制覇（スクープ）で${potPhrase}を獲得し、見事優勝を決めました`;
  }
  if (obs.handName) {
    return `${momentum}最後は${obs.handName}で${potPhrase}を制し、見事優勝を決めました`;
  }
  return fallback;
}

/** インマネ（prize > 0）した順位だけを列挙した行を返す */
export function buildPlacementLines(data: TournamentTweetData): string[] {
  return data.topResults
    .filter((r) => r.prize > 0)
    .sort((a, b) => a.position - b.position)
    .map((r) => `${r.position}位　${r.displayName} さん`);
}

/**
 * 結果ツイートの全文を生成する。
 * 優勝者が確定していない（winner が null）の場合はエラー。
 */
export function buildResultTweet(
  data: TournamentTweetData,
  options: BuildResultTweetOptions = {},
): string {
  if (!data.winner) {
    throw new Error('優勝者が確定していないため結果ツイートを生成できません');
  }

  const lead = options.entriesLead ?? '本日は';
  const comment = options.winnerComment ?? buildWinnerComment(data);
  const placements = buildPlacementLines(data);

  const { totalEntries, uniqueRegistrations, name } = data.tournament;

  return [
    `【${name}】`,
    '',
    ...placements,
    '',
    `🥇${data.winner.displayName} さん`,
    `${comment}🏆`,
    'おめでとうございます！',
    '',
    `${lead}${totalEntries}エントリー（参加者${uniqueRegistrations}名）！`,
    '参加者のみなさんありがとうございました🙇‍♂️',
    '',
    '#BabyPLO',
  ].join('\n');
}

/**
 * X の文字数カウント（CJK等は2、半角は1の近似。URL は含まれない前提）。
 * 280 を超えると通常アカウントでは投稿できない。
 */
export function estimateTweetWeight(text: string): number {
  let weight = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // X の weighted ranges（CJK・絵文字などは 2）に対する近似
    weight += cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) ? 1 : 2;
  }
  return weight;
}
