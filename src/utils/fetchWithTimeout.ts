/**
 * タイムアウト付き fetch。
 *
 * サーバーが応答を返さないまま繋ぎっぱなしになると、画面がローディング表示のまま
 * 永久に固まってしまう。必ず有限時間で決着させ、呼び出し側にエラーを返す。
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 15000;

export async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
