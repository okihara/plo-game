// ハンドヒストリーのDB保存処理

import { GameState, Card, GameAction } from '../../../shared/logic/types.js';
import { SeatInfo } from '../types.js';
import { prisma } from '../../../config/database.js';

function serializeCard(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function serializeCards(cards: Card[]): string[] {
  return cards.map(serializeCard);
}

function isAuthenticatedUser(odId: string): boolean {
  return !odId.startsWith('guest_') && !odId.startsWith('bot_');
}

export class HandHistoryRecorder {
  private handCount = 0;
  private startChips: Map<number, number> = new Map();

  /**
   * ハンド開始時に呼ぶ。開始時チップを記録する。
   */
  recordHandStart(seats: (SeatInfo | null)[], gameState: GameState): void {
    this.handCount++;
    this.startChips.clear();

    for (let i = 0; i < seats.length; i++) {
      if (seats[i]) {
        // ブラインド差し引き前のチップを復元
        const chips = gameState.players[i].chips + gameState.players[i].totalBetThisRound;
        this.startChips.set(i, chips);
      }
    }
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

      // 認証済みユーザーの HandHistoryPlayer レコードを準備
      const playerRecords = seats
        .map((seat, seatIndex) => {
          if (!seat || !isAuthenticatedUser(seat.odId)) return null;
          if (!this.startChips.has(seatIndex)) return null;

          const startChip = this.startChips.get(seatIndex)!;
          const endChip = gameState.players[seatIndex].chips;
          const profit = endChip - startChip;

          const winnerEntry = gameState.winners.find(w => w.playerId === seatIndex);

          return {
            userId: seat.odId,
            seatPosition: seatIndex,
            holeCards: serializeCards(gameState.players[seatIndex].holeCards),
            finalHand: winnerEntry?.handName || null,
            profit,
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
          winners: winnerOdIds,
          actions,
          dealerPosition: gameState.dealerPosition,
          players: {
            create: playerRecords,
          },
        },
      });
    } catch (error) {
      console.error('Failed to save hand history:', error);
    }
  }
}
