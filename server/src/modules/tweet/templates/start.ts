/**
 * START（開始）ツイートの定型文。LLM 不使用の純関数。
 */
import { formatJstTime } from '../../../shared/timeJst.js';
import { assertTweetLength } from './tweetLength.js';

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
    '#BabyPLO',
    'https://baby-plo.app',
  ].join('\n');
  return assertTweetLength(text);
}
