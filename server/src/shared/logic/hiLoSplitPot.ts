/**
 * Hi-Lo スプリットポット解決ロジック
 * Omaha Hi-Lo と Stud Hi-Lo で共用
 */

import { HandRank } from './types.js';
import { compareHands, compareLowHands } from './handEvaluator.js';
import { ShowdownPlayer, ShowdownPot, PotWinner } from './studVariantRules.js';

export interface HiLoHand {
  high: HandRank;
  low: HandRank | null; // null = 8-or-better にクオリファイしない
}

export type HiLoEvalFn = (player: ShowdownPlayer) => HiLoHand;

export interface HiLoPotWinner extends PotWinner {
  hiLoType: 'high' | 'low' | 'scoop';
}

/**
 * Hi-Lo ショーダウン解決
 *
 * 各ポットごとに:
 * 1. ハイ勝者を決定
 * 2. クオリファイするロー勝者を決定
 * 3. ローなし → ハイが全額取り (scoop)
 * 4. ローあり → 50/50スプリット（端数チップはハイへ）
 * 5. 同じプレイヤーがハイ/ロー両取り → scoop
 */
export function resolveHiLoShowdown(
  activePlayers: ShowdownPlayer[],
  pots: ShowdownPot[],
  evalFn: HiLoEvalFn,
): HiLoPotWinner[] {
  // 各プレイヤーのハンドを評価
  const playerHands = new Map<number, HiLoHand>();
  for (const player of activePlayers) {
    playerHands.set(player.id, evalFn(player));
  }

  // プレイヤーごとの獲得額とタイプを追跡
  const winnerMap = new Map<number, { amount: number; highName: string; lowName: string; wonHigh: boolean; wonLow: boolean }>();

  for (const pot of pots) {
    const eligible = pot.eligiblePlayers.filter(id => playerHands.has(id));
    if (eligible.length === 0) continue;

    // --- ハイ勝者 ---
    const highHands = eligible.map(id => ({
      playerId: id,
      hand: playerHands.get(id)!.high,
    }));
    highHands.sort((a, b) => compareHands(b.hand, a.hand));

    const highWinners = [highHands[0]];
    for (let i = 1; i < highHands.length; i++) {
      if (compareHands(highHands[i].hand, highHands[0].hand) === 0) {
        highWinners.push(highHands[i]);
      } else {
        break;
      }
    }

    // --- ロー勝者 ---
    const lowHands = eligible
      .map(id => ({
        playerId: id,
        hand: playerHands.get(id)!.low,
      }))
      .filter((h): h is { playerId: number; hand: HandRank } => h.hand !== null);

    let lowWinners: { playerId: number; hand: HandRank }[] = [];
    if (lowHands.length > 0) {
      lowHands.sort((a, b) => compareLowHands(a.hand, b.hand));
      lowWinners = [lowHands[0]];
      for (let i = 1; i < lowHands.length; i++) {
        if (compareLowHands(lowHands[i].hand, lowHands[0].hand) === 0) {
          lowWinners.push(lowHands[i]);
        } else {
          break;
        }
      }
    }

    // --- ポット分配 ---
    if (lowWinners.length === 0) {
      // ローなし → ハイが全額取り
      const winAmount = Math.floor(pot.amount / highWinners.length);
      const remainder = pot.amount % highWinners.length;

      for (let i = 0; i < highWinners.length; i++) {
        const amount = winAmount + (i === 0 ? remainder : 0);
        addToWinnerMap(winnerMap, highWinners[i].playerId, amount, highWinners[i].hand.name, '', true, false);
      }
    } else {
      // ハイ/ロー スプリット
      const highHalf = Math.ceil(pot.amount / 2); // 端数はハイへ
      const lowHalf = pot.amount - highHalf;

      // ハイ分配
      const highWin = Math.floor(highHalf / highWinners.length);
      const highRemainder = highHalf % highWinners.length;
      for (let i = 0; i < highWinners.length; i++) {
        const amount = highWin + (i === 0 ? highRemainder : 0);
        addToWinnerMap(winnerMap, highWinners[i].playerId, amount, highWinners[i].hand.name, '', true, false);
      }

      // ロー分配
      const lowWin = Math.floor(lowHalf / lowWinners.length);
      const lowRemainder = lowHalf % lowWinners.length;
      for (let i = 0; i < lowWinners.length; i++) {
        const amount = lowWin + (i === 0 ? lowRemainder : 0);
        addToWinnerMap(winnerMap, lowWinners[i].playerId, amount, '', lowWinners[i].hand.name, false, true);
      }
    }
  }

  // PotWinner[] に変換
  return Array.from(winnerMap.entries()).map(([playerId, data]) => {
    const isScoop = data.wonHigh && data.wonLow;
    const hiLoType: 'high' | 'low' | 'scoop' = isScoop ? 'scoop' : data.wonHigh ? 'high' : 'low';

    let handName: string;
    if (isScoop) {
      handName = data.lowName ? `${data.highName} / ${data.lowName}` : data.highName;
    } else if (data.wonHigh) {
      handName = data.highName;
    } else {
      handName = data.lowName;
    }

    return {
      playerId,
      amount: data.amount,
      handName,
      hiLoType,
    };
  });
}

function addToWinnerMap(
  map: Map<number, { amount: number; highName: string; lowName: string; wonHigh: boolean; wonLow: boolean }>,
  playerId: number,
  amount: number,
  highName: string,
  lowName: string,
  wonHigh: boolean,
  wonLow: boolean,
): void {
  const existing = map.get(playerId);
  if (existing) {
    existing.amount += amount;
    if (highName) existing.highName = highName;
    if (lowName) existing.lowName = lowName;
    if (wonHigh) existing.wonHigh = true;
    if (wonLow) existing.wonLow = true;
  } else {
    map.set(playerId, { amount, highName, lowName, wonHigh, wonLow });
  }
}
