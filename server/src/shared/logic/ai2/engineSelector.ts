// Bot エンジンの A/B 割当（bot-redesign Phase 3）。
//
// Bot 名のハッシュで決定的に v1（旧 ai/）/ v2（ai2/ EV エンジン）を割り当てる。
// - 同じ Bot は常に同じエンジン（日次の A/B 集計が名前だけで再現できる）
// - パーソナリティ割当のハッシュとは salt で独立させ、相関を避ける
// - 割合は環境変数 BOT_ENGINE_V2_RATIO で制御（未設定は 1 = 全量 v2）。0 で全停止
//
// 対象はリング PLO4 のみ。トーナメント除外は呼び出し側 (BotClient)、
// variant 除外は getCPUAction 側で行う。

import { hashString } from './engine/rng.js';

export type BotEngine = 'v1' | 'v2';

export function v2Ratio(): number {
  const raw = process.env.BOT_ENGINE_V2_RATIO;
  if (raw == null || raw === '') return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed));
}

export function getEngineForBot(botName: string): BotEngine {
  const ratio = v2Ratio();
  if (ratio <= 0) return 'v1';
  if (ratio >= 1) return 'v2';
  const bucket = (hashString(`engine-ab:${botName}`) % 1000) / 1000;
  return bucket < ratio ? 'v2' : 'v1';
}
