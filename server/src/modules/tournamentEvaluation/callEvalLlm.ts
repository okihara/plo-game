import {
  toPokerStarsHandText,
  type PokerStarsHandAction,
  type PokerStarsHandInput,
} from '@plo/shared';
import { env } from '../../config/env.js';
import type { TournamentHandExport } from '../history/tournamentHandsForUser.js';

const SYSTEM_PROMPT = `あなたはPot Limit Omahaのトーナメントコーチです。ユーザーは1トーナメントに参加し、公式結果（JSONの概要）と、参加した全ハンドがPokerStars形式のテキストで渡されます。

## 【最重要】PLOの役作成ルール（絶対厳守）
PLOはテキサスホールデムと違い、役の作り方に厳格な制約があります。**この制約を間違えた解説は致命的な誤り**なので、役について言及する前に必ず確認してください。

- **ホールカード4枚のうち、ちょうど2枚を使用する**（1枚でも3枚でも4枚でもダメ。必ず2枚）
- **ボード5枚のうち、ちょうど3枚を使用する**
- 合計5枚で最良のハンドを作る
- フラッシュ・ストレート・フルハウス等すべての役でこのルールが適用される

### よくある誤り（絶対にやらないこと）
- ❌ ボードに同じスートが3枚あるとき、自分のホールにそのスートが1枚しかないのに「フラッシュがある」と判定する
- ❌ ボードに4枚ストレートが並んでいるとき、自分のホールに該当カードが1枚しかないのに「ストレート完成」と判定する
- ❌ ボードにフラッシュ・ストレートが見えているのに、ブロッカーや必要な2枚を持っているか確認せずに役の可能性を論じる

**役や相手ハンドの可能性を議論するときは、毎回「ホールカードから2枚 + ボードから3枚」を具体的に示して検証してください。**

## レビュー方針
全ハンドを均等に扱わず、**学習価値の高い重要ハンドを4〜6個選んで深く解説**してください。選抜基準：
- ポットが大きい／オールインが絡む
- 判断が難しい、または代替ラインが明確に存在する
- プリフロップ〜リバーのどこかに学びがある

選ばなかったハンドは「その他のハンド」として1〜2行だけ触れるか、触れなくてよい。

## 各ハンドの解説密度
選抜ハンドは以下を含めて密度高く書く：
- **プリフロップの判断**: ポジション・スタック・レンジから見た参加可否とサイジング
- **ストリートごとのライン**: ボードテクスチャ、エクイティ、代替アクション、それらの EV 比較
- **相手の読み**: ショーダウンで相手ホールカードが見えるハンドでは、相手のプリフロップ〜リバーの判断も評価する
- **テイクアウェイ**: 1〜2行で要点

## 形式
- PokerStars形式では、本人（isCurrentUser=true）のホールカードは Dealt to やショーダウンで分かる。他プレイヤーは通常非表示で、ショーダウン到達時のみ見える。
- 日本語のMarkdownで出力。
- 構成: 冒頭に1〜2行の全体所感 → 選抜ハンドの深掘り → 最後に総括。
- 次の質問は求めず、まとめで終わる。
`;

const PROMPT_VERSION = '4';

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
      max_completion_tokens: 10000,
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
