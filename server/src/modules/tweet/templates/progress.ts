/**
 * PROGRESS（進行状況＋レイトレジ締切）ツイートの定型文。LLM 不使用の純関数。
 */
import { formatJstTime } from '../../../shared/timeJst.js';
import { assertTweetLength } from './tweetLength.js';

export interface ProgressTextInput {
  tournamentName: string;
  totalEntries: number;
  lateRegDeadline: Date;
}

export function buildProgressText(input: ProgressTextInput): string {
  const deadline = formatJstTime(input.lateRegDeadline);
  const text = [
    `【${input.tournamentName}】開催中！`,
    '',
    `ここまで ${input.totalEntries}エントリー🔥`,
    `レイトレジは ${deadline} まで。まだ間に合います💪`,
    '',
    '#BabyPLO',
    'https://baby-plo.app',
  ].join('\n');
  return assertTweetLength(text);
}
