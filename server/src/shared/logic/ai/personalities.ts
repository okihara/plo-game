import { BotPersonality } from './types.js';

// 各ボットの個性定義（20体）
// プレイスタイル分布: TAG×5, LAG×4, TP×3, LP×3, バランス×3, ニット×1, マニアック×1
const BOT_PERSONALITIES: Record<string, BotPersonality> = {
  // Taku83: TAG上級者 — ハンドセレクトが堅く、入ったら攻める
  Taku83: {
    name: 'Taku83',
    vpip: 0.22, pfr: 0.18, threeBetFreq: 0.10,
    cbetFreq: 0.70, aggression: 0.90,
    bluffFreq: 0.15, slowplayFreq: 0.10,
  },

  // mii_chan: LP（コーリングステーション）— 広くコールするがレイズ少なめ
  mii_chan: {
    name: 'mii_chan',
    vpip: 0.42, pfr: 0.14, threeBetFreq: 0.04,
    cbetFreq: 0.40, aggression: 0.35,
    bluffFreq: 0.06, slowplayFreq: 0.20,
  },

  // ShotaK: LAG（暴れ馬）— 多くの手に参加し頻繁にブラフ
  ShotaK: {
    name: 'ShotaK',
    vpip: 0.40, pfr: 0.30, threeBetFreq: 0.13,
    cbetFreq: 0.75, aggression: 1.10,
    bluffFreq: 0.22, slowplayFreq: 0.05,
  },

  // risa.p: TP（堅実パッシブ）— 参加時は強いが消極的
  'risa.p': {
    name: 'risa.p',
    vpip: 0.18, pfr: 0.11, threeBetFreq: 0.04,
    cbetFreq: 0.42, aggression: 0.40,
    bluffFreq: 0.05, slowplayFreq: 0.25,
  },

  // YuHayashi: バランスTAG — 安定感ある堅い攻め
  YuHayashi: {
    name: 'YuHayashi',
    vpip: 0.25, pfr: 0.20, threeBetFreq: 0.09,
    cbetFreq: 0.65, aggression: 0.80,
    bluffFreq: 0.13, slowplayFreq: 0.12,
  },

  // ken2408: マニアック（超LAG）— とにかくアグレッシブ、ブラフ多め
  ken2408: {
    name: 'ken2408',
    vpip: 0.45, pfr: 0.35, threeBetFreq: 0.15,
    cbetFreq: 0.80, aggression: 1.20,
    bluffFreq: 0.25, slowplayFreq: 0.03,
  },

  // NanaM: ニット（超タイト）— 参加は稀だが入ったら本物
  NanaM: {
    name: 'NanaM',
    vpip: 0.15, pfr: 0.12, threeBetFreq: 0.06,
    cbetFreq: 0.55, aggression: 0.60,
    bluffFreq: 0.05, slowplayFreq: 0.28,
  },

  // daisk77: セミLAG — 攻撃的だがブラフは控えめ
  daisk77: {
    name: 'daisk77',
    vpip: 0.33, pfr: 0.25, threeBetFreq: 0.09,
    cbetFreq: 0.68, aggression: 0.85,
    bluffFreq: 0.14, slowplayFreq: 0.08,
  },

  // HaruSun: バランス型中級者 — 平均的だが安定
  HaruSun: {
    name: 'HaruSun',
    vpip: 0.28, pfr: 0.20, threeBetFreq: 0.08,
    cbetFreq: 0.60, aggression: 0.70,
    bluffFreq: 0.12, slowplayFreq: 0.12,
  },

  // AyakaSaito: TAGトリッキー — タイトだがスロープレイ多め
  AyakaSaito: {
    name: 'AyakaSaito',
    vpip: 0.21, pfr: 0.17, threeBetFreq: 0.08,
    cbetFreq: 0.55, aggression: 0.75,
    bluffFreq: 0.10, slowplayFreq: 0.22,
  },

  // ryooo3: LP寄り — 広く参加してまれにブラフ
  ryooo3: {
    name: 'ryooo3',
    vpip: 0.38, pfr: 0.16, threeBetFreq: 0.05,
    cbetFreq: 0.48, aggression: 0.50,
    bluffFreq: 0.10, slowplayFreq: 0.15,
  },

  // MizuhoT: TAG Cベッター — Cベット率高めのタイトプレイヤー
  MizuhoT: {
    name: 'MizuhoT',
    vpip: 0.23, pfr: 0.19, threeBetFreq: 0.11,
    cbetFreq: 0.78, aggression: 0.88,
    bluffFreq: 0.16, slowplayFreq: 0.07,
  },

  // shun_pkr: LAG控えめブラフ — 広く攻めるがブラフは少ない
  shun_pkr: {
    name: 'shun_pkr',
    vpip: 0.35, pfr: 0.26, threeBetFreq: 0.10,
    cbetFreq: 0.62, aggression: 0.82,
    bluffFreq: 0.09, slowplayFreq: 0.10,
  },

  // Sakuraba: 堅実TAG — 手堅いハンドセレクトで堅実に利益を積む
  Sakuraba: {
    name: 'Sakuraba',
    vpip: 0.20, pfr: 0.16, threeBetFreq: 0.07,
    cbetFreq: 0.58, aggression: 0.65,
    bluffFreq: 0.08, slowplayFreq: 0.18,
  },

  // kojimax: ルース計算型 — 広く参加しつつ巧みにプレイ
  kojimax: {
    name: 'kojimax',
    vpip: 0.36, pfr: 0.23, threeBetFreq: 0.10,
    cbetFreq: 0.58, aggression: 0.78,
    bluffFreq: 0.18, slowplayFreq: 0.16,
  },

  // Mei0522: 超TAG — 少数精鋭のハンドで高アグレッション
  Mei0522: {
    name: 'Mei0522',
    vpip: 0.19, pfr: 0.16, threeBetFreq: 0.12,
    cbetFreq: 0.72, aggression: 0.95,
    bluffFreq: 0.14, slowplayFreq: 0.06,
  },

  // TatsuyaN: バランスやや攻撃的 — 中級者だが攻めの意識あり
  TatsuyaN: {
    name: 'TatsuyaN',
    vpip: 0.30, pfr: 0.22, threeBetFreq: 0.09,
    cbetFreq: 0.64, aggression: 0.80,
    bluffFreq: 0.13, slowplayFreq: 0.09,
  },

  // yuna0312: LP弱め — コール多めで受動的、初心者風
  yuna0312: {
    name: 'yuna0312',
    vpip: 0.40, pfr: 0.13, threeBetFreq: 0.03,
    cbetFreq: 0.35, aggression: 0.30,
    bluffFreq: 0.04, slowplayFreq: 0.18,
  },

  // Kaito_R: LAGアグレッシブ中級者 — 攻撃的だが荒さもある
  Kaito_R: {
    name: 'Kaito_R',
    vpip: 0.37, pfr: 0.28, threeBetFreq: 0.11,
    cbetFreq: 0.70, aggression: 0.95,
    bluffFreq: 0.20, slowplayFreq: 0.06,
  },

  // momoka55: TP初心者風 — タイトだが打ち方が消極的
  momoka55: {
    name: 'momoka55',
    vpip: 0.17, pfr: 0.10, threeBetFreq: 0.03,
    cbetFreq: 0.38, aggression: 0.35,
    bluffFreq: 0.04, slowplayFreq: 0.26,
  },
};

// デフォルト（HaruSun相当のバランス型）
const DEFAULT_PERSONALITY: BotPersonality = BOT_PERSONALITIES['HaruSun'];

// パーソナリティテンプレート配列（ハッシュ割り当て用）
const PERSONALITY_TEMPLATES = Object.values(BOT_PERSONALITIES);

/** 名前から決定的にハッシュ値を生成 */
function nameHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * ボット名からパーソナリティを取得。
 * 既存定義にない名前はハッシュベースで20体のテンプレートから割り当て。
 */
export function getPersonality(botName: string): BotPersonality {
  if (BOT_PERSONALITIES[botName]) {
    return BOT_PERSONALITIES[botName];
  }
  // 名前のハッシュで既存テンプレートから決定的に選択
  const idx = nameHash(botName) % PERSONALITY_TEMPLATES.length;
  return { ...PERSONALITY_TEMPLATES[idx], name: botName };
}

export { DEFAULT_PERSONALITY, BOT_PERSONALITIES };
