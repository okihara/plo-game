// TableInstance用定数定義

export const TABLE_CONSTANTS = {
  // テーブル設定
  MAX_PLAYERS: 6,
  DEFAULT_AVATAR_COUNT: 15,
  DEFAULT_BUYIN_MULTIPLIER: 200, // bigBlind * 200
  MIN_PLAYERS_TO_START: 3,

  // タイミング
  ACTION_TIMEOUT_MS: 20000,
  ACTION_ANIMATION_DELAY_MS: 1200,    // ストリート変更前のアクション演出待ち
  STREET_TRANSITION_DELAY_MS: 800,    // コミュニティカード確認時間
  SHOWDOWN_DELAY_MS: 2000,            // ショウダウンカード公開前の待ち時間
  HAND_COMPLETE_DELAY_MS: 2000,       // hand_complete表示前の待ち時間
  NEXT_HAND_DELAY_MS: 2000,           // 通常ハンド完了後の次ハンドまでの待ち時間
  NEXT_HAND_SHOWDOWN_DELAY_MS: 5000,  // ショウダウン後の次ハンドまでの待ち時間
  RUNOUT_STREET_DELAY_MS: 1500,       // オールイン時の各ストリート表示間隔
  
  // レーキ
  RAKE_PERCENT: 0.05,  // 5%
  RAKE_CAP_BB: 3,      // キャップ = 3BB

  // AFK検出
  MAX_CONSECUTIVE_TIMEOUTS: 5,  // 連続タイムアウト回数でAFK退席

  // ダッシュボード
  MAX_MESSAGE_LOG: 50,
} as const;
