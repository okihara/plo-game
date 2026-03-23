import crypto from 'crypto';

/** 完全マスク（公開ページ・シェア用） */
export const MASKED_PLAYER_NAME = '********';

/**
 * プレイヤー名を部分マスクする（ランキング・ゲーム本編用）
 * 例: "Alice" → "Al**e", "Bob" → "B*b", "Jo" → "Jo", "A" → "A"
 */
export function maskName(name: string): string {
  if (name.length <= 2) return name;
  return name.slice(0, 2) + '*'.repeat(name.length - 3) + name[name.length - 1];
}

/**
 * ハンドシェア用トークンを生成（HMAC署名でシェアした人のシート番号を保護）
 * 形式: "<seatIndex>.<signature(16文字)>"
 */
export function generateShareToken(handId: string, seatIndex: number, secret: string): string {
  const payload = `${handId}:${seatIndex}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 16);
  return `${seatIndex}.${sig}`;
}

/**
 * シェアトークンを検証し、有効ならシート番号を返す
 */
export function verifyShareToken(handId: string, token: string, secret: string): number | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const seatIndex = parseInt(token.slice(0, dot), 10);
  if (isNaN(seatIndex) || seatIndex < 0 || seatIndex > 5) return null;
  const expected = generateShareToken(handId, seatIndex, secret);
  if (token !== expected) return null;
  return seatIndex;
}
