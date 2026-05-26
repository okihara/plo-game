// ICM (Independent Chip Model) calculations for tournament equity.
//
// computeICM:    Malmuth-Harville recursive ICM. For each player returns
//                their expected prize money ($EV) given current stacks and
//                a payout structure.
//
// computeBubbleFactors:
//                For each player returns the standard (Tysen Streib style)
//                "individual" bubble factor:
//                  BF = (ICM lost when busting from current stack)
//                     / (ICM gained when doubling current stack)
//                where the doubling scenario takes chips proportionally from
//                the other players so that total chips are preserved.
//
//                BF = 1.0  → chips and $ trade 1:1 (cash-game-like)
//                BF > 1.0  → ICM pressure (losing chips costs more $ than winning gains)
//                BF < 1.0  → reverse pressure (rare, e.g. heads-up satellites)

/**
 * Pure-function ICM with bitmask memoization. O(2^n * n) per call.
 * Intended for n ≤ ~20 (i.e. ≤ 2 tables of 9-handed).
 */
export function computeICM(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const result = new Array<number>(n).fill(0);
  if (n === 0 || payouts.length === 0) return result;

  const numPayouts = Math.min(payouts.length, n);
  const fullMask = (1 << n) - 1;
  const cache = new Map<number, number[]>();

  // helper(mask) returns the $EV contribution to each *remaining* player
  // (bit set in mask) when they collectively share payouts starting at
  // index `payoutsAssigned`. payoutsAssigned is derived from popcount so
  // we only need `mask` as the cache key.
  function helper(mask: number): number[] {
    const cached = cache.get(mask);
    if (cached) return cached;

    const remaining = popcount(mask);
    const payoutsAssigned = n - remaining;
    const out = new Array<number>(n).fill(0);

    if (remaining === 0 || payoutsAssigned >= numPayouts) {
      cache.set(mask, out);
      return out;
    }

    let total = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) total += stacks[i];
    }
    if (total <= 0) {
      cache.set(mask, out);
      return out;
    }

    const prize = payouts[payoutsAssigned];
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const pTop = stacks[i] / total;
      out[i] += pTop * prize;
      if (payoutsAssigned + 1 < numPayouts && remaining > 1) {
        const sub = helper(mask & ~(1 << i));
        // Probability of each (i finishes 1st in this sub-game) times sub-EV
        // accumulates into all *other* players' totals.
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          out[j] += pTop * sub[j];
        }
      }
    }

    cache.set(mask, out);
    return out;
  }

  const evs = helper(fullMask);
  for (let i = 0; i < n; i++) result[i] = evs[i];
  return result;
}

/**
 * Standard "individual" bubble factor per player.
 * Returns NaN for a player when the win scenario provides zero $ gain
 * (e.g. they already have all chips and a payout structure that maxes out).
 */
export function computeBubbleFactors(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0 || payouts.length === 0) return out;

  const icmNow = computeICM(stacks, payouts);
  const totalChips = stacks.reduce((a, b) => a + b, 0);
  if (totalChips <= 0) return out;

  for (let i = 0; i < n; i++) {
    const myChips = stacks[i];
    if (myChips <= 0) continue;

    // Bust scenario: player i has 0 chips.
    const stacksZero = stacks.slice();
    stacksZero[i] = 0;
    const icmZero = computeICM(stacksZero, payouts);
    const lossEv = icmNow[i] - icmZero[i];

    // Double scenario: player i's stack doubles, the gain is taken
    // proportionally from every other player based on their current stack.
    // Skip if it would require more chips than the others combined have.
    const others = totalChips - myChips;
    if (others <= 0) continue; // player already has all chips
    const stacksDouble = stacks.slice();
    stacksDouble[i] = 2 * myChips;
    // The amount taken from each other player j: (stacks[j] / others) * myChips.
    // If myChips > others, the proportional take would exceed some j's stack,
    // so cap the take at the available chips and treat anything beyond that
    // as "i takes as many chips as available" (still a fair upper bound).
    const take = Math.min(myChips, others);
    stacksDouble[i] = myChips + take;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      stacksDouble[j] = stacks[j] - (stacks[j] / others) * take;
    }
    const icmDouble = computeICM(stacksDouble, payouts);
    const gainEv = icmDouble[i] - icmNow[i];

    if (gainEv > 0) out[i] = lossEv / gainEv;
  }

  return out;
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}
