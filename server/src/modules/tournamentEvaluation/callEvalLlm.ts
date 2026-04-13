import { env } from '../../config/env.js';
import type { TournamentHandExport } from '../history/tournamentHandsForUser.js';

const SYSTEM_PROMPT = `あなたはPot Limit Omahaのトーナメントコーチです。渡されたJSONには、あるユーザーが参加した1トーナメントの公式結果と、保存された全ハンド履歴（アクション・ボード・損益・ホールカードは本人分のみ、その他は表示名のみ等）が含まれます。
次を満たす日本語のMarkdownで回答してください。
- 全体の流れとスタック推移の印象
- 良かった判断・改善できそうな局面（具体ハンド番号や状況に言及）
- トーナメント形式（ICMは簡単に触れる程度でよい）を意識した一言
煽りや人格攻撃はしない。根拠のない断定は避け、推測は推測と書く。`;

const PROMPT_VERSION = '1';

export async function generateTournamentEvaluationMarkdown(input: {
  tournamentName: string;
  buyIn: number;
  position: number;
  prize: number;
  reentries: number;
  hands: TournamentHandExport[];
}): Promise<{ markdown: string; model: string; promptVersion: string }> {
  const apiKey = env.TOURNAMENT_EVAL_OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error('TOURNAMENT_EVAL_OPENAI_API_KEY is not configured');
  }

  const model = env.TOURNAMENT_EVAL_MODEL;
  const userPayload = JSON.stringify({
    tournament: {
      name: input.tournamentName,
      buyIn: input.buyIn,
      result: {
        position: input.position,
        prize: input.prize,
        reentries: input.reentries,
      },
    },
    hands: input.hands,
  });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            '以下のJSONを解釈し、上記方針で評価を書いてください。\n```json\n' +
            userPayload +
            '\n```',
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const markdown = data.choices?.[0]?.message?.content?.trim();
  if (!markdown) {
    throw new Error('OpenAI returned empty content');
  }

  return { markdown, model, promptVersion: PROMPT_VERSION };
}
