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
  stud: new StudStrategy(),
  razz: new RazzStrategy(),
  'limit_2-7_triple_draw': new DrawStrategy(),
  'no_limit_2-7_single_draw': new DrawStrategy(),
  'limit_holdem': new LimitHoldemStrategy(),
  'omaha_hilo': new PLOStrategy(),  // Omaha系なのでPLOストラテジーを流用
  'stud_hilo': new StudStrategy(),  // Stud系なのでStudストラテジーを流用
};

export function getVariantStrategy(variant: GameVariant): AIVariantStrategy {
  return strategies[variant] ?? strategies.plo;
}
