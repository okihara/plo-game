import { GameVariant } from '../types.js';
import { AIVariantStrategy } from './types.js';
import { PLOStrategy } from './ploStrategy.js';
import { StudStrategy } from './studStrategy.js';

// 新しいゲーム種類を追加する場合:
// 1. xxxStrategy.ts を作成 (AIVariantStrategy を実装)
// 2. ここにインポート + 1行追加
// 3. GameVariant 型に追加 (packages/shared/src/types.ts)
const strategies: Record<GameVariant, AIVariantStrategy> = {
  plo: new PLOStrategy(),
  stud: new StudStrategy(),
};

export function getVariantStrategy(variant: GameVariant): AIVariantStrategy {
  return strategies[variant] ?? strategies.plo;
}
