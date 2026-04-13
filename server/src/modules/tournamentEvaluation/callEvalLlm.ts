import {
  toPokerStarsHandText,
  type PokerStarsHandAction,
  type PokerStarsHandInput,
} from '@plo/shared';
import { env } from '../../config/env.js';
import type { TournamentHandExport } from '../history/tournamentHandsForUser.js';

const SYSTEM_PROMPT = `あなたはPot Limit Omahaのトーナメントコーチです。ユーザーは1トーナメントに参加し、公式結果（JSONの概要）と、全ハンドがPokerStars形式のテキストで渡されます。
PokerStars形式では、本人（isCurrentUser=true のプレイヤー）のホールカードは Dealt to やショーダウンで分かります。他プレイヤーの伏せカードは通常表示されません。
日本語のMarkdownでレビューしてください`;

const PROMPT_VERSION = '2';

function normalizeActions(raw: unknown): PokerStarsHandAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
    .map(a => ({
      seatIndex: Number(a.seatIndex),
      odId: typeof a.odId === 'string' ? a.odId : undefined,
      odName: String(a.odName ?? ''),
      action: String(a.action ?? ''),
      amount: Number(a.amount ?? 0),
      street: typeof a.street === 'string' ? a.street : undefined,
    }));
}

function exportHandToPokerStarsInput(hand: TournamentHandExport): PokerStarsHandInput {
  return {
    id: hand.id,
    handNumber: hand.handNumber,
    blinds: hand.blinds,
    communityCards: hand.communityCards,
    potSize: hand.potSize,
    rakeAmount: hand.rakeAmount,
    winners: hand.winners,
    actions: normalizeActions(hand.actions),
    dealerPosition: hand.dealerPosition,
    createdAt: hand.createdAt,
    players: hand.players.map(p => ({
      username: p.username,
      seatPosition: p.seatPosition,
      startChips: p.startChips,
      holeCards: p.holeCards,
      finalHand: p.finalHand,
      profit: p.profit,
      isCurrentUser: p.isCurrentUser,
    })),
  };
}

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
  const tournamentMeta = JSON.stringify(
    {
      name: input.tournamentName,
      buyIn: input.buyIn,
      result: {
        position: input.position,
        prize: input.prize,
        reentries: input.reentries,
      },
    },
    null,
    0
  );

  const handsPokerStars = input.hands
    .map(h => toPokerStarsHandText(exportHandToPokerStarsInput(h)))
    .join('\n\n\n----------\n\n\n');

  const userContent =
    '## トーナメント概要（JSON）\n```json\n' +
    tournamentMeta +
    '\n```\n\n## 全ハンド（PokerStars形式）\n' +
    handsPokerStars;

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
            '以下を解釈し、上記方針で評価を書いてください。\n\n' + userContent,
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
