import { BotPersonality } from './types.js';

// 各ボットの個性定義
// BOT_NAMES: Miko, Kento, Luna, Hiro, Tomoka, Yuki, Sora, Ren, Ai, Taro
const BOT_PERSONALITIES: Record<string, BotPersonality> = {
  // Miko: タイト・アグレッシブ（上級者風）
  // バランスが良く、しっかりハンドセレクトして積極的にプレイ
  Miko: {
    name: 'Miko',
    vpip: 0.22, pfr: 0.18, threeBetFreq: 0.10,
    cbetFreq: 0.70, aggression: 0.9,
    bluffFreq: 0.15, slowplayFreq: 0.10,
  },

  // Kento: ルース・アグレッシブ（暴れ馬）
  // 多くのハンドに参加し、頻繁にブラフする。手強いが読みやすい弱点も
  Kento: {
    name: 'Kento',
    vpip: 0.40, pfr: 0.30, threeBetFreq: 0.12,
    cbetFreq: 0.75, aggression: 1.1,
    bluffFreq: 0.22, slowplayFreq: 0.05,
  },

  // Luna: タイト・パッシブ（堅実派）
  // 参加頻度は低いが、入った時は強い手を持っている。しかしアグレッションが低い
  Luna: {
    name: 'Luna',
    vpip: 0.18, pfr: 0.12, threeBetFreq: 0.04,
    cbetFreq: 0.45, aggression: 0.4,
    bluffFreq: 0.05, slowplayFreq: 0.25,
  },

  // Hiro: ルース・パッシブ（コーリングステーション）
  // 多くの手でコールするが、あまりレイズしない。ブラフが効きにくい
  Hiro: {
    name: 'Hiro',
    vpip: 0.38, pfr: 0.15, threeBetFreq: 0.05,
    cbetFreq: 0.50, aggression: 0.5,
    bluffFreq: 0.08, slowplayFreq: 0.15,
  },

  // Tomoka: バランス型（中級者）
  // 平均的なプレイスタイル。大きなミスは少ないが、際立った強さもない
  Tomoka: {
    name: 'Tomoka',
    vpip: 0.28, pfr: 0.20, threeBetFreq: 0.08,
    cbetFreq: 0.60, aggression: 0.7,
    bluffFreq: 0.12, slowplayFreq: 0.12,
  },

  // Yuki: ニット（超タイト）
  // めったに参加しないが、参加した時は非常に強い手を持っている
  Yuki: {
    name: 'Yuki',
    vpip: 0.15, pfr: 0.12, threeBetFreq: 0.06,
    cbetFreq: 0.55, aggression: 0.6,
    bluffFreq: 0.07, slowplayFreq: 0.20,
  },

  // Sora: セミLAG（攻撃的中級者）
  Sora: {
    name: 'Sora',
    vpip: 0.32, pfr: 0.24, threeBetFreq: 0.09,
    cbetFreq: 0.65, aggression: 0.85,
    bluffFreq: 0.16, slowplayFreq: 0.08,
  },

  // Ren: タイトアグレッシブ寄りのバランス型
  Ren: {
    name: 'Ren',
    vpip: 0.24, pfr: 0.19, threeBetFreq: 0.07,
    cbetFreq: 0.62, aggression: 0.75,
    bluffFreq: 0.11, slowplayFreq: 0.14,
  },

  // Ai: ルースだが計算高い（トリッキー）
  Ai: {
    name: 'Ai',
    vpip: 0.35, pfr: 0.22, threeBetFreq: 0.10,
    cbetFreq: 0.58, aggression: 0.8,
    bluffFreq: 0.18, slowplayFreq: 0.18,
  },

  // Taro: 堅実なタイトプレイヤー
  Taro: {
    name: 'Taro',
    vpip: 0.20, pfr: 0.16, threeBetFreq: 0.05,
    cbetFreq: 0.52, aggression: 0.55,
    bluffFreq: 0.06, slowplayFreq: 0.22,
  },
};

// デフォルト（Tomoka相当）
const DEFAULT_PERSONALITY: BotPersonality = BOT_PERSONALITIES['Tomoka'];

/**
 * ボット名からパーソナリティを取得。
 * 名前が見つからない場合（数字サフィックス付き等）はベース名で検索し、
 * それでも見つからなければデフォルトを返す。
 */
export function getPersonality(botName: string): BotPersonality {
  // 完全一致
  if (BOT_PERSONALITIES[botName]) {
    return BOT_PERSONALITIES[botName];
  }

  // 数字サフィックスを除去して再検索 (e.g., "Kento2" → "Kento")
  const baseName = botName.replace(/\d+$/, '');
  if (BOT_PERSONALITIES[baseName]) {
    return BOT_PERSONALITIES[baseName];
  }

  return DEFAULT_PERSONALITY;
}

export { DEFAULT_PERSONALITY, BOT_PERSONALITIES };
