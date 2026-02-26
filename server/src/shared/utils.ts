/**
 * プレイヤー名をマスクする（先頭2文字と最後の1文字を公開、間を * に置換）
 * 例: "Alice" → "Al**e", "Bob" → "B*b", "Jo" → "Jo", "A" → "A"
 */
export function maskName(name: string): string {
  if (name.length <= 2) return name;
  return name.slice(0, 2) + '*'.repeat(name.length - 3) + name[name.length - 1];
}
