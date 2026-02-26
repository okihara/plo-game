import { BotPersonality } from './types.js';

// 各ボットの個性定義（20体）
// 全体的に強化済み: PFR/VPIP比0.60以上、適度なCbet、バランスの取れたアグレッション
// プレイスタイル分布: TAG×5, LAG×4, セミTAG×3, セミLAG×3, バランス×3, タイトAG×1, ルースAG×1
const BOT_PERSONALITIES: Record<string, BotPersonality> = {
  // Taku83: TAG上級者 — ハンドセレクトが堅く、入ったら攻める
  Taku83: {
    name: 'Taku83',
    vpip: 0.23, pfr: 0.19, threeBetFreq: 0.10,
    cbetFreq: 0.68, aggression: 0.88,
    bluffFreq: 0.14, slowplayFreq: 0.10,
    foldTo3Bet: 0.55, foldToCbet: 0.45, foldToRiverBet: 0.50,
  },

  // mii_chan: セミLAG — やや広く参加するが攻めの意識あり
  mii_chan: {
    name: 'mii_chan',
    vpip: 0.33, pfr: 0.22, threeBetFreq: 0.07,
    cbetFreq: 0.55, aggression: 0.65,
    bluffFreq: 0.10, slowplayFreq: 0.14,
    foldTo3Bet: 0.58, foldToCbet: 0.48, foldToRiverBet: 0.55,
  },

  // ShotaK: LAGアグレッシブ — 多くの手に参加し攻撃的（ブラフは制御）
  ShotaK: {
    name: 'ShotaK',
    vpip: 0.36, pfr: 0.28, threeBetFreq: 0.12,
    cbetFreq: 0.72, aggression: 0.95,
    bluffFreq: 0.16, slowplayFreq: 0.06,
    foldTo3Bet: 0.48, foldToCbet: 0.38, foldToRiverBet: 0.45,
  },

  // risa.p: セミTAG — タイトでポジションを活かすプレイ
  'risa.p': {
    name: 'risa.p',
    vpip: 0.22, pfr: 0.17, threeBetFreq: 0.07,
    cbetFreq: 0.58, aggression: 0.65,
    bluffFreq: 0.08, slowplayFreq: 0.16,
    foldTo3Bet: 0.58, foldToCbet: 0.50, foldToRiverBet: 0.55,
  },

  // YuHayashi: バランスTAG — 安定感ある堅い攻め（好成績ボット）
  YuHayashi: {
    name: 'YuHayashi',
    vpip: 0.25, pfr: 0.20, threeBetFreq: 0.09,
    cbetFreq: 0.65, aggression: 0.80,
    bluffFreq: 0.13, slowplayFreq: 0.12,
    foldTo3Bet: 0.52, foldToCbet: 0.45, foldToRiverBet: 0.50,
  },

  // ken2408: ルースAG — アグレッシブだが計算的（ブラフ抑制済み）
  ken2408: {
    name: 'ken2408',
    vpip: 0.38, pfr: 0.30, threeBetFreq: 0.12,
    cbetFreq: 0.73, aggression: 1.00,
    bluffFreq: 0.17, slowplayFreq: 0.05,
    foldTo3Bet: 0.45, foldToCbet: 0.35, foldToRiverBet: 0.42,
  },

  // NanaM: タイトAG — 参加は少ないが入ったら本物
  NanaM: {
    name: 'NanaM',
    vpip: 0.20, pfr: 0.16, threeBetFreq: 0.08,
    cbetFreq: 0.60, aggression: 0.72,
    bluffFreq: 0.08, slowplayFreq: 0.18,
    foldTo3Bet: 0.50, foldToCbet: 0.48, foldToRiverBet: 0.52,
  },

  // daisk77: セミLAG — 攻撃的だがブラフは控えめ
  daisk77: {
    name: 'daisk77',
    vpip: 0.32, pfr: 0.24, threeBetFreq: 0.09,
    cbetFreq: 0.66, aggression: 0.83,
    bluffFreq: 0.12, slowplayFreq: 0.08,
    foldTo3Bet: 0.52, foldToCbet: 0.43, foldToRiverBet: 0.48,
  },

  // HaruSun: バランス型 — 平均的で安定
  HaruSun: {
    name: 'HaruSun',
    vpip: 0.27, pfr: 0.21, threeBetFreq: 0.08,
    cbetFreq: 0.62, aggression: 0.75,
    bluffFreq: 0.11, slowplayFreq: 0.12,
    foldTo3Bet: 0.55, foldToCbet: 0.47, foldToRiverBet: 0.52,
  },

  // AyakaSaito: TAGトリッキー — タイトだがスロープレイ混ぜ
  AyakaSaito: {
    name: 'AyakaSaito',
    vpip: 0.23, pfr: 0.18, threeBetFreq: 0.09,
    cbetFreq: 0.58, aggression: 0.76,
    bluffFreq: 0.10, slowplayFreq: 0.18,
    foldTo3Bet: 0.53, foldToCbet: 0.47, foldToRiverBet: 0.52,
  },

  // ryooo3: セミLAG — 広めに参加してポジションプレイ
  ryooo3: {
    name: 'ryooo3',
    vpip: 0.33, pfr: 0.22, threeBetFreq: 0.07,
    cbetFreq: 0.55, aggression: 0.68,
    bluffFreq: 0.11, slowplayFreq: 0.13,
    foldTo3Bet: 0.57, foldToCbet: 0.48, foldToRiverBet: 0.55,
  },

  // MizuhoT: TAG Cベッター — Cベット率高めのタイトプレイヤー
  MizuhoT: {
    name: 'MizuhoT',
    vpip: 0.24, pfr: 0.20, threeBetFreq: 0.11,
    cbetFreq: 0.75, aggression: 0.88,
    bluffFreq: 0.15, slowplayFreq: 0.07,
    foldTo3Bet: 0.50, foldToCbet: 0.42, foldToRiverBet: 0.48,
  },

  // shun_pkr: LAG控えめブラフ — 広く攻めるがブラフは少ない（好成績ボット）
  shun_pkr: {
    name: 'shun_pkr',
    vpip: 0.35, pfr: 0.26, threeBetFreq: 0.10,
    cbetFreq: 0.62, aggression: 0.82,
    bluffFreq: 0.09, slowplayFreq: 0.10,
    foldTo3Bet: 0.48, foldToCbet: 0.42, foldToRiverBet: 0.48,
  },

  // Sakuraba: セミTAG — 手堅いハンドセレクトで堅実に利益を積む
  Sakuraba: {
    name: 'Sakuraba',
    vpip: 0.23, pfr: 0.18, threeBetFreq: 0.08,
    cbetFreq: 0.60, aggression: 0.70,
    bluffFreq: 0.09, slowplayFreq: 0.15,
    foldTo3Bet: 0.55, foldToCbet: 0.48, foldToRiverBet: 0.53,
  },

  // kojimax: LAG計算型 — 広く参加しつつ巧みにプレイ
  kojimax: {
    name: 'kojimax',
    vpip: 0.34, pfr: 0.24, threeBetFreq: 0.10,
    cbetFreq: 0.60, aggression: 0.80,
    bluffFreq: 0.15, slowplayFreq: 0.12,
    foldTo3Bet: 0.50, foldToCbet: 0.42, foldToRiverBet: 0.48,
  },

  // Mei0522: TAG高アグレッション — 少数精鋭のハンドで攻め
  Mei0522: {
    name: 'Mei0522',
    vpip: 0.22, pfr: 0.18, threeBetFreq: 0.11,
    cbetFreq: 0.72, aggression: 0.92,
    bluffFreq: 0.14, slowplayFreq: 0.07,
    foldTo3Bet: 0.48, foldToCbet: 0.40, foldToRiverBet: 0.45,
  },

  // TatsuyaN: バランスやや攻撃的 — 攻めの意識あり（好成績ボット）
  TatsuyaN: {
    name: 'TatsuyaN',
    vpip: 0.30, pfr: 0.22, threeBetFreq: 0.09,
    cbetFreq: 0.64, aggression: 0.80,
    bluffFreq: 0.13, slowplayFreq: 0.09,
    foldTo3Bet: 0.52, foldToCbet: 0.44, foldToRiverBet: 0.50,
  },

  // yuna0312: セミTAG — やや受動的だが堅いハンドセレクト
  yuna0312: {
    name: 'yuna0312',
    vpip: 0.28, pfr: 0.19, threeBetFreq: 0.06,
    cbetFreq: 0.52, aggression: 0.60,
    bluffFreq: 0.08, slowplayFreq: 0.15,
    foldTo3Bet: 0.60, foldToCbet: 0.52, foldToRiverBet: 0.58,
  },

  // Kaito_R: LAGアグレッシブ — 攻撃的で存在感のあるプレイ
  Kaito_R: {
    name: 'Kaito_R',
    vpip: 0.35, pfr: 0.27, threeBetFreq: 0.11,
    cbetFreq: 0.70, aggression: 0.92,
    bluffFreq: 0.16, slowplayFreq: 0.06,
    foldTo3Bet: 0.46, foldToCbet: 0.38, foldToRiverBet: 0.44,
  },

  // momoka55: TAG堅実 — タイトだが攻めるべきところは攻める
  momoka55: {
    name: 'momoka55',
    vpip: 0.21, pfr: 0.16, threeBetFreq: 0.07,
    cbetFreq: 0.56, aggression: 0.65,
    bluffFreq: 0.07, slowplayFreq: 0.16,
    foldTo3Bet: 0.56, foldToCbet: 0.50, foldToRiverBet: 0.55,
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
