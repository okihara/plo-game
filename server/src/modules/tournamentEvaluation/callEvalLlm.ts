import { toPokerStarsHandText, type PokerStarsHandInput } from '@plo/shared';
import { env } from '../../config/env.js';
import type { TournamentHandExport } from '../history/tournamentHandsForUser.js';
import { buildHandFacts } from './handFacts.js';
import { formatHandsSummary, normalizeActions, selectKeyHands } from './keyHandSelection.js';

const SYSTEM_PROMPT = `あなたはPot Limit Omahaのトーナメントコーチです。ユーザーは1トーナメントに参加し、公式結果（JSONの概要）、全ハンドの集計値、そしてサーバーが事前に抽出した重要候補ハンド（ポットが大きい・オールインが絡む・損益の振れが大きい等）がPokerStars形式のテキストで渡されます。候補以外のハンドは集計値にのみ反映されています。

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

## 【最重要】サーバー計算済みの事実を優先する
各ハンドの PokerStars テキストの直後に「サーバー計算済みの事実」ブロックがある場合、そこに書かれた以下の項目はプログラムで正確に計算した値です。**ハンド履歴から自分で読み直したり再計算したりせず、この値をそのまま使ってください**。
- ポジション、開始スタック・有効スタック（BB換算）
- アクションの順番と金額（誰が先にベットし、誰がレイズ／コール／フォールドしたか）
- 各ストリートでのヒーローの役（使用カード付き）、ナッツかどうか、次の1枚でストレート以上に改善するカードの枚数
- ショーダウンした相手の役、ヒーローの損益

役やドローに言及するときは、事実ブロックの記述と矛盾しないことを確認してください。事実ブロックに無い推測（相手のレンジ等）は推測だと分かる書き方にしてください。

## レビュー方針
渡された候補ハンドを均等に扱わず、**その中から学習価値の高い重要ハンドを4〜6個選んで深く解説**してください。選抜基準：
- ポットが大きい／オールインが絡む
- 判断が難しい、または代替ラインが明確に存在する
- プリフロップ〜リバーのどこかに学びがある

選ばなかったハンドは「その他のハンド」として1〜2行だけ触れるか、触れなくてよい。全体傾向（VPIP・PFR等）に触れるときは集計値を根拠にする。

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

export const PROMPT_VERSION = '6';

function exportHandToPokerStarsInput(hand: TournamentHandExport): PokerStarsHandInput {
  // 5 枚ホールカードのプレイヤーがいれば PLO5 と判定 (DB スキーマに gameVariant
  // カラムが追加されたら hand.gameVariant を直接使う形に置換予定)
  const variant = hand.players.some(p => p.holeCards.length === 5) ? 'plo5' : 'plo';
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
    variant,
  };
}

/** OpenAI の usage から保存・コスト集計に使う値だけを取り出したもの */
export type EvalTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

function toEvalTokenUsage(u: OpenAiUsage | undefined): EvalTokenUsage | null {
  if (!u) return null;
  return {
    inputTokens: u.prompt_tokens ?? 0,
    cachedInputTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

export type TournamentEvaluationResult = {
  markdown: string;
  model: string;
  promptVersion: string;
  usage: EvalTokenUsage | null;
  handsTotal: number;
  handsSent: number;
};

export async function generateTournamentEvaluationMarkdown(
  input: {
    tournamentName: string;
    buyIn: number;
    position: number;
    prize: number;
    reentries: number;
    hands: TournamentHandExport[];
  },
  /** モデル比較用（dry-run スクリプト）。本番経路では env の値と既定の上限を使う */
  overrides: { model?: string; reasoningEffort?: string; maxHands?: number } = {}
): Promise<TournamentEvaluationResult> {
  const apiKey = env.TOURNAMENT_EVAL_OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error('TOURNAMENT_EVAL_OPENAI_API_KEY is not configured');
  }

  const model = overrides.model ?? env.TOURNAMENT_EVAL_MODEL;
  const reasoningEffort = overrides.reasoningEffort ?? env.TOURNAMENT_EVAL_REASONING_EFFORT;
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

  const { selected, summary } = selectKeyHands(input.hands, overrides.maxHands);
  const handsPokerStars = selected
    .map(h => {
      const text = toPokerStarsHandText(exportHandToPokerStarsInput(h));
      const facts = buildHandFacts(h);
      return facts ? `${text}\n\n【サーバー計算済みの事実】\n${facts}` : text;
    })
    .join('\n\n\n----------\n\n\n');

  const userContent =
    '## トーナメント概要（JSON）\n```json\n' +
    tournamentMeta +
    '\n```\n\n## 全ハンドの集計\n' +
    formatHandsSummary(summary) +
    '\n\n## 重要候補ハンド（PokerStars形式・時系列順）\n' +
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
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
    usage?: OpenAiUsage;
  };
  const markdown = data.choices?.[0]?.message?.content?.trim();
  if (!markdown) {
    throw new Error('OpenAI returned empty content');
  }

  return {
    markdown,
    model,
    promptVersion: PROMPT_VERSION,
    usage: toEvalTokenUsage(data.usage),
    handsTotal: summary.totalHands,
    handsSent: summary.selectedHands,
  };
}
