/**
 * プレイヤー名をマスクする（先頭2文字を公開、残りを * に置換）
 * 例: "Alice" → "Al***", "Jo" → "Jo", "A" → "A"
 */
export function maskName(name: string): string {
  if (name.length <= 2) return name;
  return name.slice(0, 2) + '*'.repeat(name.length - 2);
}
