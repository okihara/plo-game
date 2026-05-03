// ハンドヒストリーのDB保存処理

import { GameState, Card, GameAction } from '../../../shared/logic/types.js';
import { SeatInfo } from '../types.js';
import { prisma } from '../../../config/database.js';
import { evaluatePLOHand, evaluateStudHand } from '../../../shared/logic/handEvaluator.js';
import { updatePlayerStats } from '../../stats/updateStatsIncremental.js';

/** ハンド履歴記録のインターフェイス */
export interface IHandHistoryRecorder {
  /**
   * ハンド開始時 (= variantAdapter.startHand を呼ぶ前) に呼ぶ。
   * このタイミングで chips を撮ることでブラインド/アンテ徴収前の値が保存され、
   * profit = endChips - startChips が正しく "自分の投資を引いた純利益" になる。
   * blinds 文字列もここで snapshot し、ハンド中の level up で値が変わっても
   * 保存される値はそのハンド開始時のものになる。
   */
  recordHandStart(seats: (SeatInfo | null)[], gameState: GameState, blinds: string): void;
  setAllInEVProfits(evProfits: Map<number, number>): void;
  getStartChips(): Map<number, number>;
  recordHandComplete(
    tableId: string,
    gameState: GameState,
    seats: (SeatInfo | null)[]
  ): Promise<void>;
}

/** Stud用: DB保存しないno-op実装 */
export class NullHandHistoryRecorder implements IHandHistoryRecorder {
  private startChips = new Map<number, number>();

  recordHandStart(seats: (SeatInfo | null)[], gameState: GameState, _blinds: string): void {
    this.startChips.clear();
    for (let i = 0; i < seats.length; i++) {
      if (seats[i]) {
        this.startChips.set(i, gameState.players[i].chips);
      }
    }
  }

  setAllInEVProfits(_evProfits: Map<number, number>): void {}

  getStartChips(): Map<number, number> {
    return this.startChips;
  }

  async recordHandComplete(): Promise<void> {}
}

function serializeCard(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function serializeCards(cards: Card[]): string[] {
  return cards.map(serializeCard);
}

function isAuthenticatedUser(_odId: string): boolean {
  return true;
}

export class HandHistoryRecorder implements IHandHistoryRecorder {
  private handCount = 0;
  private startChips: Map<number, number> = new Map();
  private allInEVProfits: Map<number, number> | null = null;
  private blinds: string = '';
  private readonly tournamentId: string | null;

  constructor(options?: { tournamentId?: string }) {
    this.tournamentId = options?.tournamentId ?? null;
  }

  /**
   * ハンド開始時 (variantAdapter.startHand を呼ぶ前) に呼ぶ。
   * ブラインド/アンテ徴収前の chips と、そのハンドで適用される blinds 文字列を
   * snapshot として保存する。
   */
  recordHandStart(seats: (SeatInfo | null)[], gameState: GameState, blinds: string): void {
    this.handCount++;
    this.startChips.clear();
    this.allInEVProfits = null;
    this.blinds = blinds;

    for (let i = 0; i < seats.length; i++) {
      if (seats[i]) {
        // startHand を呼ぶ前なので chips はそのまま開始時の値。
        // ハンド完了時の cleanup で totalBetThisRound は 0 になっているはずだが、
        // 念のため加算しておく (再呼び出し等の防御)。
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
          const isBombPot = gameState.variant === 'plo_double_board_bomb' && gameState.boards?.length === 2;
          if (isBombPot && !player.folded && player.holeCards.length === 4
              && gameState.boards![0].length === 5 && gameState.boards![1].length === 5) {
            try {
              const h1 = evaluatePLOHand(player.holeCards, gameState.boards![0]).name;
              const h2 = evaluatePLOHand(player.holeCards, gameState.boards![1]).name;
              finalHand = `B1: ${h1} / B2: ${h2}`;
            } catch (e) {
              console.warn('Bomb pot hand evaluation failed for seat', seatIndex, e);
            }
          } else if (winnerEntry?.handName) {
            finalHand = winnerEntry.handName;
          } else if (!player.folded && (player.holeCards.length === 4 || player.holeCards.length === 5) && gameState.communityCards.length === 5) {
            try {
              finalHand = evaluatePLOHand(player.holeCards, gameState.communityCards).name || null;
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
            startChips: startChip,
            profit,
            allInEVProfit,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (playerRecords.length === 0) return;

      const isBombPot = gameState.variant === 'plo_double_board_bomb' && gameState.boards?.length === 2;
      const board1 = isBombPot ? gameState.boards![0] : gameState.communityCards;
      const board2 = isBombPot ? gameState.boards![1] : [];

      await prisma.handHistory.create({
        data: {
          tableId,
          ...(this.tournamentId ? { tournamentId: this.tournamentId } : {}),
          handNumber: this.handCount,
          blinds: this.blinds,
          communityCards: serializeCards(board1),
          communityCards2: serializeCards(board2),
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

      // スタッツキャッシュ更新 (fire-and-forget) — tournamentIdの有無でキャッシュ先を切替
      updatePlayerStats(
        gameState,
        seats,
        this.startChips,
        this.allInEVProfits,
        this.tournamentId != null,
      ).catch(err => console.error('Stats cache update failed:', err));
    } catch (error) {
      console.error('Failed to save hand history:', error);
    }
  }
}
