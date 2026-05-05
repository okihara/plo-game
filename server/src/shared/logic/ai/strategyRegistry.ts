import { GameVariant } from '../types.js';
import { AIVariantStrategy } from './types.js';
import { PLOStrategy } from './ploStrategy.js';
import { StudStrategy } from './studStrategy.js';
import { RazzStrategy } from './razzStrategy.js';
import { DrawStrategy } from './drawStrategy.js';
import { LimitHoldemStrategy } from './limitHoldemStrategy.js';

// 新しいゲーム種類を追加する場合:
// 1. xxxStrategy.ts を作成 (AIVariantStrategy を実装)
// 2. ここにインポート + 1行追加
// 3. GameVariant 型に追加 (packages/shared/src/types.ts)
const strategies: Record<GameVariant, AIVariantStrategy> = {
  plo: new PLOStrategy(),
  plo5: new PLOStrategy(),  // PLO5: 暫定で PLO ストラテジーを流用 (Phase 3 でプリフロップ評価器を差し替え予定)
  stud: new StudStrategy(),
  razz: new RazzStrategy(),
  'limit_2-7_triple_draw': new DrawStrategy(),
  'no_limit_2-7_single_draw': new DrawStrategy(),
  'limit_holdem': new LimitHoldemStrategy(),
  'omaha_hilo': new PLOStrategy(),  // Omaha系なのでPLOストラテジーを流用
  'plo_hilo': new PLOStrategy(),    // PLO Hi-Lo: PLO ストラテジーを流用 (Hi-Lo 評価は今後)
  'stud_hilo': new StudStrategy(),  // Stud系なのでStudストラテジーを流用
  'plo_double_board_bomb': new PLOStrategy(),  // 暫定: PLO ストラテジーを流用 (ダブルボード対応の equity 評価は今後)
};

export function getVariantStrategy(variant: GameVariant): AIVariantStrategy {
  return strategies[variant] ?? strategies.plo;
}
