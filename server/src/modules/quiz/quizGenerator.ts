/**
 * クイズ生成のオーケストレーター。
 * ボード問題と知識問題を 7:3 の比率でランダムに選択する。
 */
import { generateBoardQuiz } from './generators/boardQuiz.js';
import { generateKnowledgeQuiz } from './generators/knowledgeQuiz.js';
import type { Quiz, QuizType, BoardQuizSubtype } from './types.js';

const BOARD_SUBTYPES: readonly string[] = ['winner', 'nuts', 'handname', 'outs'];

/** クイズタイプ文字列をパースする。"board:outs" のようにサブタイプも指定可能。 */
export function parseQuizType(raw: string): { type: QuizType; subtype?: BoardQuizSubtype } {
  if (raw === 'knowledge') return { type: 'knowledge' };
  if (raw === 'board') return { type: 'board' };
  if (raw.startsWith('board:')) {
    const sub = raw.slice(6);
    if (!BOARD_SUBTYPES.includes(sub)) {
      throw new Error(`無効なボード問題サブタイプ: ${sub}（${BOARD_SUBTYPES.join(' / ')} を指定してください）`);
    }
    return { type: 'board', subtype: sub as BoardQuizSubtype };
  }
  throw new Error(`無効なクイズタイプ: ${raw}（board / board:winner / board:nuts / board:handname / board:outs / knowledge を指定してください）`);
}

/** クイズを1問生成する。type / subtype で種類を指定可能、usedKnowledge で既出の知識問題を除外可能。 */
export function generateQuiz(usedKnowledge?: Set<string>, type?: QuizType, subtype?: BoardQuizSubtype): Quiz {
  const isBoardQuiz = type ? type === 'board' : Math.random() < 0.7;

  if (isBoardQuiz) {
    return generateBoardQuiz(subtype);
  }
  return generateKnowledgeQuiz(usedKnowledge);
}
