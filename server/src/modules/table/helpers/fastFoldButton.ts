/**
 * ファストフォールド卓のボタン位置決定。
 *
 * FF は毎ハンド面子が入れ替わるため、通常卓のように「ボタンを1席ずつ回す」ことに
 * 公平性の意味がない。しかも席は到着順（空いている若い番号から）で埋まり、到着順は
 * 前ハンドの立場（ブラインドはハンド終了まで残りやすく到着が遅い）と相関するので、
 * 回すだけだと同じ人に SB/BB が連続して当たりやすい。
 *
 * そこで「SB/BB になる 2 人のうち、ブラインドから遠ざかっている方が長い」配置を選ぶ。
 * 直前ハンドでブラインドを払った人（handsSinceBlind=0）は極力外れる。
 */

/** これ以上は同じ扱い（新規着席者もこの値として扱う） */
export const HANDS_SINCE_BLIND_CAP = 6;

/**
 * @param occupiedSeats 今ハンドに参加する席番号（昇順でなくてよい）
 * @param handsSinceBlind 席番号 → 最後にブラインドを払ってから何ハンド経ったか（0=直前ハンドで払った）
 * @param random 0以上1未満の乱数（テスト用に差し替え可能）
 * @returns ボタンにすべき席番号。3人未満なら null（ヘッズアップ等は通常の決め方に任せる）
 */
export function chooseFastFoldButtonSeat(
  occupiedSeats: readonly number[],
  handsSinceBlind: (seat: number) => number,
  random: () => number = Math.random,
): number | null {
  const ring = [...occupiedSeats].sort((a, b) => a - b);
  const n = ring.length;
  if (n < 3) return null;

  const since = (seat: number) => Math.min(Math.max(handsSinceBlind(seat), 0), HANDS_SINCE_BLIND_CAP);

  let bestScore = -Infinity;
  let candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    const sb = since(ring[(i + 1) % n]);
    const bb = since(ring[(i + 2) % n]);
    // まず「2人のうち短い方」を最大化（直前ブラインドの人を外すのが最優先）、次に合計
    const score = Math.min(sb, bb) * 100 + sb + bb;
    if (score > bestScore) {
      bestScore = score;
      candidates = [ring[i]];
    } else if (score === bestScore) {
      candidates.push(ring[i]);
    }
  }
  return candidates[Math.floor(random() * candidates.length)];
}
