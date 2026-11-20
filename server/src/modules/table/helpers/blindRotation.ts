/**
 * ブラインドが同じ人に連続しないための席決定ロジック（純粋関数）。
 * トーナメントのテーブル移動で、直前にブラインドを払った人が移動先ですぐ SB/BB に
 * ならないようにする。
 */

/** handsSinceBlind の上限（これ以上は同じ扱い。記録なしの人の初期値にも使う） */
export const HANDS_SINCE_BLIND_CAP = 6;

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
