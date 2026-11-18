/**
 * ブラインドが同じ人に連続しないための席・ボタン決定ロジック（純粋関数）。
 *
 * ## ファストフォールド卓のボタン位置決定
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

/**
 * 次のハンドで SB/BB を払う席を予測する（gameEngine.startHand と同じ規則）。
 * - ボタンは前回ボタン（lastDealer）の次の着席者へ進む。未設定（<0）なら席 0 の次。
 * - 3人以上: ボタンの次が SB、その次が BB。ヘッズアップ: ボタンが SB、もう一人が BB。
 */
export function predictNextBlindSeats(
  occupiedSeats: readonly number[],
  lastDealer: number,
  maxSeats: number,
): number[] {
  const ring = [...occupiedSeats].sort((a, b) => a - b);
  if (ring.length < 2) return [];
  const nextAfter = (from: number) => ring.find(s => s > from) ?? ring[0];
  const dealer = nextAfter(lastDealer < 0 ? 0 : lastDealer % maxSeats);
  if (ring.length === 2) return [dealer, nextAfter(dealer)];
  const sb = nextAfter(dealer);
  return [sb, nextAfter(sb)];
}

/**
 * 卓移動で着席する人の席を選ぶ。
 * 直近（2ハンド以内）にブラインドを払った人は、着席直後のハンドで SB/BB にならない席を優先する。
 * ボタンはトーナメントでは通常どおり回す必要があるので、動かすのは「座る席」の方。
 *
 * @returns 選んだ席。条件を満たす席がなければ空席の先頭（従来どおり）。空席なしなら null
 */
export function chooseSeatAvoidingBlinds(params: {
  seats: readonly (unknown | null)[];
  lastDealer: number;
  handsSinceBlind: number | undefined;
  random?: () => number;
}): number | null {
  const { seats, lastDealer, handsSinceBlind, random = Math.random } = params;
  const empty = seats.map((s, i) => (s === null ? i : -1)).filter(i => i !== -1);
  if (empty.length === 0) return null;
  if (handsSinceBlind === undefined || handsSinceBlind >= RECENT_BLIND_WINDOW) return empty[0];

  const occupied = seats.map((s, i) => (s !== null ? i : -1)).filter(i => i !== -1);
  const safe = empty.filter(seat => !predictNextBlindSeats([...occupied, seat], lastDealer, seats.length).includes(seat));
  if (safe.length === 0) return empty[0];
  return safe[Math.floor(random() * safe.length)];
}

/** 直近この手数以内にブラインドを払った人は、移動直後のブラインドを避ける（0=直前, 1=2つ前） */
export const RECENT_BLIND_WINDOW = 2;
