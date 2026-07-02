/**
 * X の weighted length 概算。
 * 全角（CJK等）= 2、半角 = 1、URL は t.co 短縮で一律 23 として数える。
 * 上限 280（= 全角換算 140 文字）。テンプレは投稿前に assert する。
 */

const URL_RE = /https?:\/\/\S+/g;
const URL_WEIGHT = 23;
export const MAX_WEIGHTED_LENGTH = 280;

function charWeight(ch: string): number {
  const cp = ch.codePointAt(0)!;
  // Twitter の規定に近い近似: Latin-1 前後までを1、それ以外（CJK・絵文字等）を2
  return cp <= 0x10ff ? 1 : 2;
}

export function weightedTweetLength(text: string): number {
  let total = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    total += URL_WEIGHT;
    return '';
  });
  for (const ch of withoutUrls) total += charWeight(ch);
  return total;
}

/** テンプレ生成物が長すぎる場合は投稿前に落とす（黙って途中で切らない） */
export function assertTweetLength(text: string): string {
  const len = weightedTweetLength(text);
  if (len > MAX_WEIGHTED_LENGTH) {
    throw new Error(`tweet too long: weighted=${len} > ${MAX_WEIGHTED_LENGTH}\n${text}`);
  }
  return text;
}
