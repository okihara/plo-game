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
  HAND_START_DELAY_MS: 2000,
  
  // ダッシュボード
  MAX_MESSAGE_LOG: 50,
} as const;
