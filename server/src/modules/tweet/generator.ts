/**
 * kind ごとに「データ収集 → プロンプト構築 → LLM 呼び出し」を行い、
 * 生成されたツイート本文と入力 JSON を返す。
 *
 * 状態遷移（PENDING → GENERATING → DRAFT/FAILED）は scheduler が行う。
 * 本ファイルは純粋にコンテンツ生成に専念する（Single Responsibility）。
 */
import type { TweetDraft } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { callAnthropic } from './anthropicClient.js';
import { fetchResultData } from './data/resultData.js';
import { buildResultPrompt } from './promptTemplates/result.js';
import type { PromptResult } from './types.js';
import { TweetKind } from './types.js';

export async function generate(draft: TweetDraft): Promise<PromptResult> {
  switch (draft.kind) {
    case TweetKind.RESULT:
      return generateResult(draft);
    case TweetKind.ANNOUNCE:
    case TweetKind.START:
    case TweetKind.PROGRESS:
    case TweetKind.RANKING:
      throw new Error(`generator for kind=${draft.kind} is not implemented yet`);
    default:
      throw new Error(`unknown tweet kind: ${draft.kind}`);
  }
}

async function generateResult(draft: TweetDraft): Promise<PromptResult> {
  if (!draft.tournamentId) {
    throw new Error('RESULT draft must have tournamentId');
  }
  const bundle = await fetchResultData(prisma, { tournamentId: draft.tournamentId });
  if (!bundle) {
    throw new Error(`tournament ${draft.tournamentId} not found`);
  }
  if (bundle.tournament.status !== 'COMPLETED') {
    throw new Error(`tournament ${draft.tournamentId} is not COMPLETED (status=${bundle.tournament.status})`);
  }
  const prompt = buildResultPrompt(bundle);
  const llm = await callAnthropic({
    system: prompt.system,
    user: prompt.user,
    maxTokens: 800,
  });
  return {
    text: llm.text,
    promptVersion: prompt.promptVersion,
    promptInputJson: prompt.inputJson,
  };
}
