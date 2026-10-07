/**
 * START（開始）ツイートの定型文。LLM 不使用の純関数。
 */
import { formatJstTime } from '../../../shared/timeJst.js';
import { assertTweetLength } from './tweetLength.js';
import { TWEET_FOOTER_LINES } from './footer.js';

export interface StartTextInput {
  tournamentName: string;
  lateRegDeadline: Date;
}

export function buildStartText(input: StartTextInput): string {
  const deadline = formatJstTime(input.lateRegDeadline);
  const text = [
    `【${input.tournamentName}】スタートしました🔥`,
    '',
    `レイトレジは ${deadline} まで受付中。`,
    'いまからでも間に合います💪',
    '',
    ...TWEET_FOOTER_LINES,
  ].join('\n');
  return assertTweetLength(text);
}
