/**
 * kind ごとに「データ収集 → プロンプト構築 → LLM 呼び出し」を行い、
 * 生成されたツイート本文と入力 JSON を返す。
 *
 * 呼び出し元はローカルの運用スクリプト（scripts/ops/）。--prod で本番 DB を
 * 向けられるよう、PrismaClient は引数で受け取る（グローバル prisma に依存しない）。
 * 本ファイルは純粋にコンテンツ生成に専念する（Single Responsibility）。
 */
import type { PrismaClient } from '@prisma/client';
import { callAnthropic } from './anthropicClient.js';
import { fetchAnnounceContext } from './data/announceData.js';
import { fetchResultData } from './data/resultData.js';
import { buildAnnouncePrompt } from './promptTemplates/announce.js';
import { buildResultPrompt } from './promptTemplates/result.js';
import type { PromptResult } from './types.js';

export async function generateResultText(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<PromptResult> {
  const bundle = await fetchResultData(prisma, { tournamentId });
  if (!bundle) {
    throw new Error(`tournament ${tournamentId} not found`);
  }
  if (bundle.tournament.status !== 'COMPLETED') {
    throw new Error(`tournament ${tournamentId} is not COMPLETED (status=${bundle.tournament.status})`);
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

export async function generateAnnounceText(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<PromptResult> {
  const context = await fetchAnnounceContext(prisma, tournamentId);
  if (!context) {
    throw new Error(`tournament ${tournamentId} not found or has no scheduledStartTime`);
  }
  const prompt = buildAnnouncePrompt(context);
  const llm = await callAnthropic({
    system: prompt.system,
    user: prompt.user,
    maxTokens: 600,
  });
  return {
    text: llm.text,
    promptVersion: prompt.promptVersion,
    promptInputJson: prompt.inputJson,
  };
}
