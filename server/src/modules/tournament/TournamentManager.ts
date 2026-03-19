import { Server } from 'socket.io';
import { TournamentInstance } from './TournamentInstance.js';
import { TournamentConfig, TournamentLobbyInfo } from './types.js';

/**
 * 全トーナメントのレジストリ
 * トーナメントの作成・取得・一覧・クリーンアップを管理する
 */
export class TournamentManager {
  private tournaments: Map<string, TournamentInstance> = new Map();
  private playerTournaments: Map<string, string> = new Map(); // odId → tournamentId
  private readonly io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  /**
   * トーナメントを作成
   */
  createTournament(config: TournamentConfig): TournamentInstance {
    const tournament = new TournamentInstance(this.io, config);

    tournament.onTournamentComplete = (tournamentId) => {
      // トーナメント完了時にプレイヤートラッキングをクリア
      for (const [odId, tId] of this.playerTournaments) {
        if (tId === tournamentId) {
          this.playerTournaments.delete(odId);
        }
      }
    };

    this.tournaments.set(config.id, tournament);
    return tournament;
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
}
