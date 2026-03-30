import { Server } from 'socket.io';
import { TournamentInstance } from './TournamentInstance.js';
import { TournamentConfig, TournamentLobbyInfo, TournamentResult } from './types.js';
import { prisma } from '../../config/database.js';

/**
 * 全トーナメントのレジストリ
 * トーナメントの作成・取得・一覧・クリーンアップを管理する
 */
export class TournamentManager {
  private tournaments: Map<string, TournamentInstance> = new Map();
  private playerTournaments: Map<string, string> = new Map(); // odId → tournamentId
  private readonly io: Server;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(io: Server) {
    this.io = io;

    // 定期的に完了済みトーナメントをクリーンアップ（10分ごと）
    this.cleanupTimer = setInterval(() => this.cleanupCompleted(), 10 * 60 * 1000);
  }

  /**
   * トーナメントを作成
   */
  createTournament(config: TournamentConfig): TournamentInstance {
    const tournament = new TournamentInstance(this.io, config);

    tournament.onTournamentComplete = (tournamentId, results) => {
      // プレイヤートラッキングをクリア
      for (const [odId, tId] of this.playerTournaments) {
        if (tId === tournamentId) {
          this.playerTournaments.delete(odId);
        }
      }

      // 賞金支払い・結果DB保存（fire-and-forget）
      const prizePool = tournament.getPrizePool();
      this.persistTournamentResults(tournamentId, results, prizePool).catch(err => {
        console.error(`[TournamentManager] Failed to persist results for ${tournamentId}:`, err);
      });
    };

    this.tournaments.set(config.id, tournament);
    return tournament;
  }

  /**
   * トーナメント完了時のDB操作: 賞金支払い + 結果保存 + ステータス更新
   */
  private async persistTournamentResults(tournamentId: string, results: TournamentResult[], prizePool: number): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // 1. 入賞者への賞金支払い
      for (const result of results) {
        if (result.prize > 0) {
          await tx.bankroll.update({
            where: { userId: result.odId },
            data: { balance: { increment: result.prize } },
          });
          await tx.transaction.create({
            data: {
              userId: result.odId,
              type: 'TOURNAMENT_PRIZE',
              amount: result.prize,
            },
          });
        }

        // 2. 結果レコード保存
        await tx.tournamentResult.upsert({
          where: { tournamentId_userId: { tournamentId, userId: result.odId } },
          create: {
            tournamentId,
            userId: result.odId,
            position: result.position,
            prize: result.prize,
            reentries: result.reentries,
          },
          update: {
            position: result.position,
            prize: result.prize,
            reentries: result.reentries,
          },
        });
      }

      // 3. トーナメントステータス更新
      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          prizePool,
        },
      });
    });

    console.log(`[TournamentManager] Results persisted for tournament ${tournamentId}: ${results.length} entries`);
  }

  /**
   * トーナメントを取得
   */
  getTournament(tournamentId: string): TournamentInstance | undefined {
    return this.tournaments.get(tournamentId);
  }

  /**
   * プレイヤーが参加中のトーナメントIDを取得
   */
  getPlayerTournament(odId: string): string | undefined {
    return this.playerTournaments.get(odId);
  }

  /**
   * プレイヤーをトーナメントに関連付け
   */
  setPlayerTournament(odId: string, tournamentId: string): void {
    this.playerTournaments.set(odId, tournamentId);
  }

  /**
   * プレイヤーのトーナメント関連付けを解除
   */
  removePlayerFromTracking(odId: string): void {
    this.playerTournaments.delete(odId);
  }

  /**
   * ロビー用のトーナメント一覧を取得
   */
  getActiveTournaments(): TournamentLobbyInfo[] {
    const list: TournamentLobbyInfo[] = [];
    for (const tournament of this.tournaments.values()) {
      const status = tournament.getStatus();
      if (status !== 'completed' && status !== 'cancelled') {
        list.push(tournament.getLobbyInfo());
      }
    }
    return list;
  }

  /**
   * 全トーナメント一覧（完了済み含む）
   */
  getAllTournaments(): TournamentLobbyInfo[] {
    return Array.from(this.tournaments.values()).map(t => t.getLobbyInfo());
  }

  /**
   * 完了済みトーナメントのクリーンアップ（メモリ解放）
   */
  cleanupCompleted(): void {
    for (const [id, tournament] of this.tournaments) {
      const status = tournament.getStatus();
      if (status === 'completed' || status === 'cancelled') {
        this.tournaments.delete(id);
      }
    }
  }

  /**
   * マネージャーの停止（サーバーシャットダウン時）
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
