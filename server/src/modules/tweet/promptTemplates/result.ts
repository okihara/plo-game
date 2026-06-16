/**
 * RESULT（表彰）ツイート用プロンプト。
 *
 * 文体は .claude/skills/tournament-tweet/SKILL.md のサンプルを根拠にしている。
 * 変更時は promptVersion を上げて履歴で追えるようにする。
 */
import type { ResultBundle } from '../data/resultData.js';

export const RESULT_PROMPT_VERSION = 'result-v1';

const SYSTEM_PROMPT = `あなたはオンラインPLOコミュニティ「BabyPLO」の運営アシスタントです。トーナメント完了直後の結果ツイートを日本語で1本だけ作成してください。

## 厳守ルール
- 出力はツイート本文のみ。前置き・解説・コードブロック・引用符・「---」などは一切付けない。
- 文字数は **280文字以内**。
- 数値（順位・参加者数・エントリー数）は、提供された JSON に書かれた値以外を絶対に使わない。推測・概算・補完をしない。
- 名前は JSON の displayName をそのまま使う（マスク済み）。
- ネガティブ表現は禁止: リエントリー回数には触れない／他者の失敗に触れない／「一度バストして」のような表現も使わない。
- 絵文字は 🥇 🏆 🙇‍♂️ のみ。増やさない。
- ハッシュタグは末尾に #BabyPLO のみ。他は付けない。
- 改行は適度に。冒頭はトナメ名を 【 】 で囲む。

## フォーマット骨格
\`\`\`
【<tournament.name>】

1位　<displayName> さん
2位　<displayName> さん
3位　<displayName> さん
4位　<displayName> さん
5位　<displayName> さん

🥇<優勝者displayName> さん
<優勝者のプレーに触れた1〜2文のコメント>🏆
おめでとうございます！

<文脈に合わせた一言>Nエントリー（参加者M名）！
参加者のみなさんありがとうございました🙇‍♂️

#BabyPLO
\`\`\`

## 優勝者コメントの書き方
- 「勝負どころを逃さないプレーで〜」「拮抗した状況が続く中、要所でしっかりと勝負を決めて〜」「ハイレベルなファイナルテーブルを勝ち抜き〜」 のような語彙感
- 1〜2文。具体的なカード名・数値は出さない。
- lastHands を見て、優勝者が大きなポットを獲ったり接戦を抜けた様子があれば「拮抗した展開を抜け出した」「大きなポットを確実に拾った」「要所で勝負を決めた」のように抽象化する
- 拮抗か独走かが判断できなければ「ハイレベルなファイナルテーブルを勝ち抜き」のような汎用表現で十分

## エントリー数の書き方
\`Nエントリー（参加者M名）\` の形式（N=totalEntries、M=uniqueRegistrations）。M と N が同じなら「N エントリー」だけでも可。前置きは曜日・特記事項があれば自然に織り込む。判断できなければ「本日は」`;

interface BuildPromptResult {
  system: string;
  user: string;
  inputJson: unknown;
  promptVersion: string;
}

export function buildResultPrompt(bundle: ResultBundle): BuildPromptResult {
  // LLM に渡す JSON は ツイート構築に必要な部分だけに絞る（コスト & ハルシネーション対策）
  const slim = {
    tournament: bundle.tournament,
    winner: bundle.winner,
    topResults: bundle.topResults.slice(0, 5),
    lastHandsSummary: bundle.lastHands.slice(-10).map((h) => ({
      handNumber: h.handNumber,
      blinds: h.blinds,
      potSize: h.potSize,
      winnerNames: h.winnerNames,
      players: h.players.map((p) => ({
        displayName: p.displayName,
        startChips: p.startChips,
        profit: p.profit,
        isWinnerOfTournament: p.isWinnerOfTournament,
      })),
    })),
  };

  const user = [
    'トーナメント結果データ（JSON）:',
    '```json',
    JSON.stringify(slim, null, 2),
    '```',
    '',
    '上記データだけを根拠に、システムプロンプトのルールとフォーマットに従ってツイート本文を1本だけ生成してください。',
  ].join('\n');

  return {
    system: SYSTEM_PROMPT,
    user,
    inputJson: slim,
    promptVersion: RESULT_PROMPT_VERSION,
  };
}
