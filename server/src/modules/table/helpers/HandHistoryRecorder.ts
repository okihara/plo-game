// ハンドヒストリーのDB保存処理

import { GameState, Card, GameAction } from '../../../shared/logic/types.js';
import { SeatInfo } from '../types.js';
import { prisma } from '../../../config/database.js';
import { evaluatePLOHand } from '../../../shared/logic/handEvaluator.js';
import { updatePlayerStats } from '../../stats/updateStatsIncremental.js';

function serializeCard(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function serializeCards(cards: Card[]): string[] {
  return cards.map(serializeCard);
}

function isAuthenticatedUser(_odId: string): boolean {
  return true;
}

export class HandHistoryRecorder {
  private handCount = 0;
  private startChips: Map<number, number> = new Map();
  private allInEVProfits: Map<number, number> | null = null;

  /**
   * ハンド開始時に呼ぶ。開始時チップを記録する。
   */
  recordHandStart(seats: (SeatInfo | null)[], gameState: GameState): void {
    this.handCount++;
    this.startChips.clear();
    this.allInEVProfits = null;

    for (let i = 0; i < seats.length; i++) {
      if (seats[i]) {
        // ブラインド差し引き前のチップを復元
        const chips = gameState.players[i].chips + gameState.players[i].totalBetThisRound;
        this.startChips.set(i, chips);
      }
    }
  }

  /** オールインランアウト時のEV利益をセット（seatIndex → evProfit） */
  setAllInEVProfits(evProfits: Map<number, number>): void {
    this.allInEVProfits = evProfits;
  }

  /** ハンド開始時のチップを取得 */
  getStartChips(): Map<number, number> {
    return this.startChips;
  }

  /**
   * ハンド完了時に呼ぶ。DBに保存する（fire-and-forget）。
   */
  async recordHandComplete(
    tableId: string,
    blinds: string,
    gameState: GameState,
    seats: (SeatInfo | null)[]
  ): Promise<void> {
    if (this.startChips.size === 0) return;

    // 認証済みユーザーが1人もいなければスキップ
    const hasAuthUser = seats.some(
      (s, i) => s && isAuthenticatedUser(s.odId) && this.startChips.has(i)
    );
    if (!hasAuthUser) return;

    try {
      // アクション履歴を odId/odName/street 付きに変換
      const actions = gameState.handHistory.map((a: GameAction) => ({
        seatIndex: a.playerId,
        odId: seats[a.playerId]?.odId ?? `unknown_${a.playerId}`,
        odName: seats[a.playerId]?.odName ?? `Seat ${a.playerId}`,
        action: a.action,
        amount: a.amount,
        street: a.street,
      }));

      // 勝者の odId リスト
      const winnerOdIds = gameState.winners
        .map(w => seats[w.playerId]?.odId ?? '')
        .filter(Boolean);

      // 全プレイヤーの HandHistoryPlayer レコードを準備
      const playerRecords = seats
        .map((seat, seatIndex) => {
          if (!seat) return null;
          if (!this.startChips.has(seatIndex)) return null;

          const startChip = this.startChips.get(seatIndex)!;
          const endChip = gameState.players[seatIndex].chips;
          const profit = endChip - startChip;

          const player = gameState.players[seatIndex];
          const winnerEntry = gameState.winners.find(w => w.playerId === seatIndex);

          // ショーダウンに参加した全プレイヤーの役名を評価
          let finalHand: string | null = null;
          if (winnerEntry?.handName) {
            finalHand = winnerEntry.handName;
          } else if (!player.folded && player.holeCards.length === 4 && gameState.communityCards.length === 5) {
            try {
              const result = evaluatePLOHand(player.holeCards, gameState.communityCards);
              finalHand = result.name || null;
            } catch (e) {
              console.warn('Hand evaluation failed for seat', seatIndex, e);
            }
          }

          const allInEVProfit = this.allInEVProfits?.get(seatIndex) ?? null;

          return {
            userId: isAuthenticatedUser(seat.odId) ? seat.odId : null,
            username: seat.odName,
            seatPosition: seatIndex,
            holeCards: serializeCards(player.holeCards),
            finalHand,
            profit,
            allInEVProfit,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (playerRecords.length === 0) return;

      await prisma.handHistory.create({
        data: {
          tableId,
          handNumber: this.handCount,
          blinds,
          communityCards: serializeCards(gameState.communityCards),
          potSize: gameState.pot,
          rakeAmount: gameState.rake ?? 0,
          winners: winnerOdIds,
          actions,
          dealerPosition: gameState.dealerPosition,
          players: {
            create: playerRecords,
          },
        },
      });

      // スタッツキャッシュ更新 (fire-and-forget)
      updatePlayerStats(gameState, seats, this.startChips, this.allInEVProfits).catch(err =>
        console.error('Stats cache update failed:', err)
      );
    } catch (error) {
      console.error('Failed to save hand history:', error);
    }
  }
}
