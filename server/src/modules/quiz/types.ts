/** デイリーPLOクイズの型定義 */

export type QuizType = 'board' | 'knowledge';

export interface Quiz {
  type: QuizType;
  /** ツイート本文 */
  question: string;
  /** 4択の選択肢 */
  choices: string[];
  /** 正解のインデックス (0-3) */
  correctIndex: number;
  /** 解説文（回答ツイート用） */
  explanation: string;
  /** クイズ画像（ボード問題の場合） */
  image?: Buffer;
}

export interface QuizHistory {
  date: string;       // YYYY-MM-DD
  type: QuizType;
  question: string;
  correctIndex: number;
  tweetId?: string;
  answerTweetId?: string;
}
