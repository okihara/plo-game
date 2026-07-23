// ポット構築・レーキ・分配の共通ロジック

import { GameState, Player } from '../types.js';

export type SidePot = { amount: number; eligiblePlayers: number[] };

/** ショーダウンで確定した勝者エントリ（winners[] に積まれる形） */
export type PotWinnerEntry = {
  playerId: number;
  amount: number;
  handName: string;
  hiLoType?: 'high' | 'low' | 'scoop';
};

/**
 * total を n 等分する。各取り分は chipUnit の倍数になるよう切り下げ、
 * 端数 (chipUnit 未満) は最初の要素にまとめて寄せる。
 *
 * 用途: ポット分配 (タイ分配 / DBBP のボード半分割 / 各ボードのチョップ)。
 *   - チップ総量保存: 返り値の合計は total と一致する
 *   - chipUnit=1 (キャッシュ) なら従来通り 1 チップ単位
 *   - chipUnit=100 (トーナメント) なら 100 未満のチップ移動が発生しない
 */
export function splitChipsEvenly(total: number, n: number, chipUnit: number = 1): number[] {
  if (n <= 0) return [];
  const unit = Math.max(1, chipUnit);
  const base = Math.floor(total / n / unit) * unit;
  const result = new Array(n).fill(base);
  result[0] += total - base * n;
  return result;
}

/**
 * プレイヤーの投入額からサイドポットを計算する
 * 各プレイヤーのtotalBetThisRoundを元に、オールインレベルごとにポットを分割する
 */
export function calculateSidePots(players: Player[]): SidePot[] {
  // フォールドしていないプレイヤーのユニークな投入額レベルを取得（昇順）
  const nonFoldedLevels = [...new Set(
    players.filter(p => !p.folded).map(p => p.totalBetThisRound)
  )].sort((a, b) => a - b);

  const sidePots: SidePot[] = [];
  let prevLevel = 0;

  for (const level of nonFoldedLevels) {
    if (level <= prevLevel) continue;

    let potAmount = 0;
    const eligiblePlayers: number[] = [];

    for (const player of players) {
      // このレベル区間に対するプレイヤーの貢献額
      const contribution = Math.min(player.totalBetThisRound, level) - Math.min(player.totalBetThisRound, prevLevel);
      potAmount += contribution;

      // フォールドしておらず、このレベル以上投入しているプレイヤーが対象
      if (!player.folded && player.totalBetThisRound >= level) {
        eligiblePlayers.push(player.id);
      }
    }

    if (potAmount > 0) {
      sidePots.push({ amount: potAmount, eligiblePlayers });
    }

    prevLevel = level;
  }

  return sidePots;
}

/**
 * レーキを計算する
 */
export function calculateRake(totalPot: number, bigBlind: number, rakePercent: number, rakeCapBB: number): number {
  const rawRake = Math.floor(totalPot * rakePercent);
  const cap = bigBlind * rakeCapBB;
  return Math.min(rawRake, cap);
}

/**
 * 相手のいないポット（eligible 1人）を未コール分として本人に返却し、
 * contested（2人以上が争う）ポットだけを返す。state.pot / chips を直接更新する。
 */
export function settleUncontestedPots(state: GameState, allPots: SidePot[]): SidePot[] {
  const contestedPots = allPots.filter(p => p.eligiblePlayers.length >= 2);
  const uncontestedPots = allPots.filter(p => p.eligiblePlayers.length === 1);
  for (const pot of uncontestedPots) {
    const player = state.players.find(p => p.id === pot.eligiblePlayers[0])!;
    player.chips += pot.amount;
    state.pot -= pot.amount;
  }
  return contestedPots;
}

/**
 * レーキを各 contested ポットから比例配分で差し引く（端数は最後のポットから）
 */
export function deductRakeProportionally(contestedPots: SidePot[], rake: number, totalContested: number): void {
  if (rake <= 0 || totalContested <= 0) return;
  let rakeRemaining = rake;
  for (const pot of contestedPots) {
    const potRake = Math.floor(rake * pot.amount / totalContested);
    pot.amount -= potRake;
    rakeRemaining -= potRake;
  }
  if (rakeRemaining > 0 && contestedPots.length > 0) {
    contestedPots[contestedPots.length - 1].amount -= rakeRemaining;
  }
}

/**
 * 「1つの評価軸で最強ハンドが勝つ」バリアントの共通ポット分配。
 * 各ポットごとに best-first 比較でソートし、タイは splitChipsEvenly で均等分配
 * （端数は最初の勝者へ）。プレイヤー単位で合算した PotWinnerEntry を返す。
 */
export function resolvePotsByBestHand<H>(
  pots: SidePot[],
  hands: Map<number, H>,
  compareBestFirst: (a: H, b: H) => number,
  formatName: (hand: H) => string,
  chipUnit: number,
): PotWinnerEntry[] {
  const winnerAmounts = new Map<number, { amount: number; handName: string }>();

  for (const pot of pots) {
    const eligibleHands = pot.eligiblePlayers
      .filter(id => hands.has(id))
      .map(id => ({ playerId: id, hand: hands.get(id)! }));

    if (eligibleHands.length === 0) continue;

    eligibleHands.sort((a, b) => compareBestFirst(a.hand, b.hand));

    // 同点チェック（タイの場合は複数人が勝者）
    const potWinners = [eligibleHands[0]];
    for (let i = 1; i < eligibleHands.length; i++) {
      if (compareBestFirst(eligibleHands[i].hand, eligibleHands[0].hand) === 0) {
        potWinners.push(eligibleHands[i]);
      } else {
        break;
      }
    }

    const shares = splitChipsEvenly(pot.amount, potWinners.length, chipUnit);

    for (let i = 0; i < potWinners.length; i++) {
      const amount = shares[i];
      const existing = winnerAmounts.get(potWinners[i].playerId);
      if (existing) {
        existing.amount += amount;
      } else {
        winnerAmounts.set(potWinners[i].playerId, {
          amount,
          handName: formatName(potWinners[i].hand),
        });
      }
    }
  }

  const entries: PotWinnerEntry[] = [];
  for (const [playerId, { amount, handName }] of winnerAmounts) {
    entries.push({ playerId, amount, handName });
  }
  return entries;
}
