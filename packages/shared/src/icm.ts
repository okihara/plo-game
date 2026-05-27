// ICM (Independent Chip Model) calculations for tournament equity.
//
// computeICM:    Malmuth-Harville recursive ICM. For each player returns
//                their expected prize money ($EV) given current stacks and
//                a payout structure.
//
// computeBubbleFactors:
//                Symmetric "fair exchange" bubble factor:
//                  BF = ($EV lost when risking X chips)
//                     / ($EV gained when winning X chips)
//                where X = min(myChips, others_total) — i.e. the maximum amount
//                that can change hands in a single all-in against the field.
//                Both the win and loss scenarios trade the same X, so chip and
//                $ exchange rates are compared symmetrically.
//                The win scenario takes X chips proportionally from every other
//                player; the loss scenario hands X chips back to them by the same
//                proportional split. If the loss would bring the player to 0
//                chips they're treated as busting at the next-eliminated
//                position (deterministic payout for that finish).
//
//                BF = 1.0  → chips and $ trade 1:1 (cash-game-like)
//                BF > 1.0  → ICM pressure (losing chips costs more $ than winning gains)
//                BF < 1.0  → reverse pressure (rare, e.g. heads-up satellites)
//
//                Note: the canonical Tysen Streib BF uses "lose all chips
//                (bust)" vs "double up (capped)" which makes the formula
//                asymmetric when the player has more chips than the others
//                combined. The symmetric formulation here keeps HU in-the-money
//                BFs near 1.0 for both players, matching the theoretical
//                "no remaining ICM pressure" property of HU IM.

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
 * Symmetric "fair exchange" bubble factor per player.
 * Returns NaN for a player when the gain scenario provides zero $ gain
 * (e.g. they already have all chips and a payout structure that maxes out).
 *
 * Both the win and loss scenarios trade the same chip amount X = min(myChips,
 * others_total) so that BF reflects the marginal $/chip exchange rate rather
 * than the asymmetric "bust vs capped double" of the classic Streib BF. When
 * the loss leaves the player at 0 chips they're treated as busting at the
 * next-eliminated position (deterministic finish-position prize).
 */
export function computeBubbleFactors(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0 || payouts.length === 0) return out;

  const icmNow = computeICM(stacks, payouts);
  const totalChips = stacks.reduce((a, b) => a + b, 0);
  if (totalChips <= 0) return out;

  const aliveCount = stacks.reduce((c, s) => c + (s > 0 ? 1 : 0), 0);
  // If player i busts, they finish at position `aliveCount` among the originally
  // alive players (last alive becomes the next eliminated). Their prize is the
  // payout at that position, or 0 if the position is past the money.
  const bustPrize = aliveCount - 1 < payouts.length ? payouts[aliveCount - 1] : 0;

  for (let i = 0; i < n; i++) {
    const myChips = stacks[i];
    if (myChips <= 0) continue;

    const others = totalChips - myChips;
    if (others <= 0) continue; // player already has all chips
    // Maximum symmetric trade — both the win and loss scenarios move this many
    // chips. Capped at the smaller of "what I can lose" and "what the others
    // can collectively cover".
    const tradeAmount = Math.min(myChips, others);

    // Win scenario: gain `tradeAmount` chips, taken proportionally from every
    // other player based on their current stack.
    const stacksWin = stacks.slice();
    stacksWin[i] = myChips + tradeAmount;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      stacksWin[j] = stacks[j] - (stacks[j] / others) * tradeAmount;
    }
    const icmWin = computeICM(stacksWin, payouts);
    const gainEv = icmWin[i] - icmNow[i];

    // Loss scenario: give `tradeAmount` chips back to the field by the same
    // proportional split. If this empties the player's stack they're busted
    // and finish at the deterministic next-elimination position.
    let lossEv: number;
    const newStack = myChips - tradeAmount;
    if (newStack <= 0) {
      lossEv = icmNow[i] - bustPrize;
    } else {
      const stacksLose = stacks.slice();
      stacksLose[i] = newStack;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        stacksLose[j] = stacks[j] + (stacks[j] / others) * tradeAmount;
      }
      const icmLose = computeICM(stacksLose, payouts);
      lossEv = icmNow[i] - icmLose[i];
    }

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
