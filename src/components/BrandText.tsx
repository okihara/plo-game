export const BRAND_NAME = 'BabyPLO';

interface BrandTextProps {
  className?: string;
}

// ブランド名「BabyPLO」を規定のロゴフォント（font-logo = Baloo 2）で表示する。
// 画面上にブランド名を出すときは生文字列ではなくこのコンポーネントを使う。
export function BrandText({ className }: BrandTextProps) {
  return <span className={`font-logo ${className ?? ''}`.trim()}>{BRAND_NAME}</span>;
}
