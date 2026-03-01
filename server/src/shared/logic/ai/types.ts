import { Card, Street, Action, GameAction } from '../types.js';

// ボードテクスチャ（基本）
export interface BoardTexture {
  isPaired: boolean;
  isTrips: boolean;
  flushPossible: boolean;
  flushDraw: boolean;
  straightPossible: boolean;
  isConnected: boolean;
  isWet: boolean;
  highCard: number;
}

// 拡張ボードテクスチャ
export interface ExtendedBoardTexture extends BoardTexture {
  monotone: boolean;       // 同スート3枚以上
  twoTone: boolean;        // 2スートが支配的（2+1 or 2+2+1）
  rainbow: boolean;        // 全異スート
  dynamism: number;        // ボード変化リスク (0-1): 次カードでナッツが変わりやすさ
  averageRank: number;     // ボードの平均ランク値
  hasBroadway: boolean;    // ブロードウェイカード(T+)が2枚以上
}

// ボットのプレイスタイルパラメータ
export interface BotPersonality {
  name: string;
  // プリフロップ
  vpip: number;           // 参加頻度 (0.20-0.38)
  pfr: number;            // プリフロップレイズ頻度 (0.14-0.30)
  threeBetFreq: number;   // 3ベット頻度 (0.05-0.13)
  // ポストフロップ
  cbetFreq: number;       // Cベット頻度 (0.50-0.75)
  aggression: number;     // 全体アグレッション (0.55-1.00)
  bluffFreq: number;      // ブラフ傾向 (0.06-0.18)
  slowplayFreq: number;   // スロープレイ傾向 (0.05-0.20)
  // フォールド傾向（over-fold制御）
  foldTo3Bet: number;     // 3ベットに対するフォールド頻度 (0.40-0.70)
  foldToCbet: number;     // Cベットに対するフォールド頻度 (0.35-0.60)
  foldToRiverBet: number; // リバーベットに対するフォールド頻度 (0.40-0.70)
}

// 相手統計情報
export interface OpponentStats {
  odId: string;
  handsPlayed: number;
  vpip: number;           // VPIP (実測)
  pfr: number;            // PFR (実測)
  cbetCount: number;
  cbetOpportunities: number;
  foldToCbetCount: number;
  foldToCbetOpportunities: number;
  aggBets: number;        // ベット/レイズ回数
  aggCalls: number;       // コール回数
  aggChecks: number;      // チェック回数
  foldCount: number;      // フォールド回数
  totalActions: number;   // 総アクション数
}

// ストリート別アクション履歴
export interface StreetHistory {
  preflopAggressor: number | null;
  flopAggressor: number | null;
  turnAggressor: number | null;
  wasRaisedPreflop: boolean;
  numBetsOnFlop: number;
  numBetsOnTurn: number;
}

// 拡張ハンド評価
export interface ExtendedHandEval {
  // 既存フィールド
  strength: number;
  madeHandRank: number;
  hasFlushDraw: boolean;
  hasStraightDraw: boolean;
  hasWrapDraw: boolean;
  drawStrength: number;
  isNuts: boolean;
  isNearNuts: boolean;
  // 新規
  estimatedEquity: number;      // アウツベースの推定エクイティ
  blockerScore: number;         // ブロッカースコア (0-1)
  vulnerabilityToDraws: number; // ドローに対する脆弱性 (0-1)
  // リバーナッツ分析（リバーのみ）
  nutRank?: number;              // 1=ナッツ, 2=セカンドナッツ, ...
  possibleBetterHands?: string[]; // 自分より上の手の種類
}

// ブロッカー分析結果
export interface BlockerAnalysis {
  blocksNutFlush: boolean;
  blocksNutStraight: boolean;
  blocksTopSet: boolean;
  blockerScore: number;
}

// アウツ計算結果
export interface OutsResult {
  flushOuts: number;
  straightOuts: number;
  totalOuts: number;
  nutOuts: number;         // ナッツへのアウツ
  isNutFlushDraw: boolean;
  isNutStraightDraw: boolean;
}

// ベットサイジングコンテキスト
export interface BetSizingContext {
  pot: number;
  street: Street;
  spr: number;
  boardTexture: ExtendedBoardTexture;
  handEval: ExtendedHandEval;
  isAggressor: boolean;
  numOpponents: number;
  personality: BotPersonality;
}

// AI実行コンテキスト（getCPUActionに渡す）
export interface AIContext {
  botName: string;
  opponentModel?: OpponentModel;
  handActions?: GameAction[];
}

// 相手モデル（インターフェース）
export interface OpponentModel {
  getStats(playerId: number): OpponentStats | null;
  classifyPlayer(playerId: number): 'TAG' | 'LAG' | 'TP' | 'LP' | 'unknown';
  estimateFoldProbability(playerId: number, street: Street): number;
}

// ブラフの種類
export type BluffType = 'pure_bluff' | 'semi_bluff' | 'check_raise_bluff' | 'probe_bet' | 'barrel';
