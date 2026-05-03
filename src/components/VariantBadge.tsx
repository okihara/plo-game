import { GameVariant, VARIANT_BADGE_BG, VARIANT_DISPLAY_NAMES } from '../logic';

interface VariantBadgeProps {
  variant: GameVariant;
  /** バッジ全体のクラス（パディング・フォントサイズ・rounded など）を呼び出し側で指定 */
  className?: string;
}

/** Tournament 等で variant を区別表示する小さなバッジ。
 *  デフォルト variant（plo 等、`VARIANT_BADGE_BG` に登録なし）は何も描画しない。
 *  バッジ文字列は `VARIANT_DISPLAY_NAMES` から、背景色は `VARIANT_BADGE_BG` から取る。
 *  サイズ・rounded は className で外から指定する（HUD と List で異なるため）。 */
export function VariantBadge({ variant, className = '' }: VariantBadgeProps) {
  const bgClass = VARIANT_BADGE_BG[variant];
  if (!bgClass) return null;
  return (
    <span className={`font-bold text-white ${bgClass} ${className}`}>
      {VARIANT_DISPLAY_NAMES[variant]}
    </span>
  );
}
