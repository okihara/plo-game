// TableInstance用定数定義

export const TABLE_CONSTANTS = {
  // テーブル設定
  MAX_PLAYERS: 6,
  DEFAULT_AVATAR_COUNT: 15,
  DEFAULT_BUYIN_MULTIPLIER: 200, // bigBlind * 200
  MIN_PLAYERS_TO_START: 3,

  // タイミング
  ACTION_TIMEOUT_PREFLOP_MS: 15000,
  ACTION_TIMEOUT_POSTFLOP_MS: 30000,
  /**
   * 連続タイムアウト時の持ち時間倍率。
   * index = consecutiveTimeouts（タイムアウト前カウント）。
   * 例: 1回目のタイムアウト後、次の手番では index=1 の倍率で短縮される。
   * 末尾を超えた回数は末尾の倍率を使う。
   */
  ACTION_TIMEOUT_PENALTY_FACTORS: [1.0, 0.9, 0.5, 0.3] as const,
  /** ペナルティ後でもこの時間は確保する */
  ACTION_TIMEOUT_MIN_MS: 5000,
  ACTION_ANIMATION_DELAY_MS: 1200,    // ストリート変更前のアクション演出待ち
  STREET_TRANSITION_DELAY_MS: 800,    // コミュニティカード確認時間
  SHOWDOWN_DELAY_MS: 1800,            // ショウダウンカード公開前の待ち時間
  HAND_COMPLETE_DELAY_MS: 1800,       // hand_complete表示前の待ち時間
  NEXT_HAND_DELAY_MS: 1800,           // 通常ハンド完了後の次ハンドまでの待ち時間
  NEXT_HAND_SHOWDOWN_DELAY_MS: 4200,  // ショウダウン後の次ハンドまでの待ち時間
  RUNOUT_STREET_DELAY_MS: 1500,       // オールイン時の各ストリート表示間隔
  BOMB_POT_FLOP_REVEAL_DELAY_MS: 1000, // DBBP: ホール配布 → フロップ公開までの待ち時間
  
  // レーキ
  RAKE_PERCENT: 0.05,  // 5%
  RAKE_CAP_BB: 3,      // キャップ = 3BB

  // ダッシュボード
  MAX_MESSAGE_LOG: 50,

  /** 1卓あたりの同時観戦者上限 */
  MAX_SPECTATORS_PER_TABLE: 50,
} as const;
