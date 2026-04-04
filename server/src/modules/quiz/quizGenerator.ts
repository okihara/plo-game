/**
 * クイズ生成のオーケストレーター。
 * ボード問題と知識問題を 7:3 の比率でランダムに選択する。
 */
import { generateBoardQuiz } from './generators/boardQuiz.js';
import { generateKnowledgeQuiz } from './generators/knowledgeQuiz.js';
import type { Quiz } from './types.js';

/** クイズを1問生成する。usedKnowledge で既出の知識問題を除外可能。 */
export function generateQuiz(usedKnowledge?: Set<string>): Quiz {
  const isBoardQuiz = Math.random() < 0.7;

  if (isBoardQuiz) {
    return generateBoardQuiz();
  }
  return generateKnowledgeQuiz(usedKnowledge);
}
