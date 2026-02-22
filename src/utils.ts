/**
 * プレイヤー名をマスクする（1文字目と最後の文字以外を * に置換）
 * 例: "Alice" → "A***e", "Jo" → "Jo", "A" → "A"
 */
export function maskName(name: string): string {
  if (name.length <= 2) return name;
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}
