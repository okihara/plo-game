import { Server } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { TableManager } from '../table/TableManager.js';
import { TournamentManager } from '../tournament/TournamentManager.js';
import { registerTournamentHandlers } from '../tournament/socket.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';
import { announcementService } from '../announcement/AnnouncementService.js';
import { setupAuthMiddleware, AuthenticatedSocket } from './authMiddleware.js';
import { setupFastFoldCallback } from './fastFoldService.js';
import {
  handleTableLeave,
  handleGameAction,
  handleFastFold,
  handleMatchmakingJoin,
  handleMatchmakingLeave,
  handleDisconnect,
  handleDebugSetChips,
  handlePrivateCreate,
  handlePrivateJoin,
  handleSpectateJoin,
  handleSpectateLeave,
  handleSpectatorDisconnect,
} from './handlers.js';

interface GameSocketDependencies {
  tableManager: TableManager;
  tournamentManager: TournamentManager;
}

// Socket.io が emit する disconnect reason のうち、サーバー側に原因があるものは
// 接続障害として error ログを出す（クライアントが明示的に切断した場合や、
// クライアント側のネットワーク事情による transport close は info で十分）。
// 参考: https://socket.io/docs/v4/server-socket-instance/#disconnect
const SERVER_CAUSED_DISCONNECT_REASONS = new Set<string>([
  'server namespace disconnect', // サーバーが socket.disconnect() を呼んだ
  'server shutting down',         // io.close() 中
  'transport error',              // トランスポート層のエラー
  'parse error',                  // サーバーが不正パケットを受け取った
  'ping timeout',                 // ping 応答が来なかった（サーバー負荷の可能性）
]);

export function setupGameSocket(io: Server, fastify: FastifyInstance): GameSocketDependencies {
  const tableManager = new TableManager(io);
  const tournamentManager = new TournamentManager(io);

  // 同一ユーザーのプレイ用最新socket（観戦専用接続はここに入れない）
  const activePlayerConnections = new Map<string, AuthenticatedSocket>();

  // Create default tables
  tableManager.createTable('1/3', false); // Regular table
  const defaultFfTable = tableManager.createTable('1/3', true); // Fast fold table
  setupFastFoldCallback(defaultFfTable, tableManager);

  // Authentication middleware
  setupAuthMiddleware(io, fastify);

  // Engine 層の接続エラー（ハンドシェイク失敗・トランスポートエラーなど）を error ログに残す
  io.engine.on('connection_error', (err: { code?: number; message?: string; context?: unknown }) => {
    console.error('[Socket.io] connection_error:', {
      code: err.code,
      message: err.message,
      context: err.context,
    });
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const odId = socket.odId!;
    const isSpectate = socket.odConnectionMode === 'spectate';
    console.log(`${isSpectate ? 'Spectator' : 'Player'} connected: ${odId} (socket: ${socket.id})`);

    if (!isSpectate) {
      const existingSocket = activePlayerConnections.get(odId);
      if (existingSocket && existingSocket.id !== socket.id) {
        console.warn(`[DuplicateConnection] Forcing disconnect of old socket for ${odId}: old=${existingSocket.id}, new=${socket.id}`);
        existingSocket.odDisplacedByNewConnection = true;
        existingSocket.emit('connection:displaced', { reason: 'new_connection' });
        existingSocket.disconnect(true);
      }
      activePlayerConnections.set(odId, socket);
    }

    // トーナメント参加中なら再接続処理（観戦接続ではプレイ座席のソケット置換をしない）
    if (!isSpectate) {
      const tournamentId = tournamentManager.getPlayerTournament(odId);
      if (tournamentId) {
        const tournament = tournamentManager.getTournament(tournamentId);
        tournament?.handleReconnect(odId, socket);
      }
    }

    socket.emit('connection:established', { playerId: odId });

    if (maintenanceService.isMaintenanceActive()) {
      socket.emit('maintenance:status', maintenanceService.getStatus());
    }
    if (announcementService.isAnnouncementActive()) {
      socket.emit('announcement:status', announcementService.getStatus());
    }

    socket.on('table:leave', () => handleTableLeave(socket, tableManager));
    socket.on('table:spectate_join', (data) =>
      handleSpectateJoin(socket, data ?? {}, tableManager, tournamentManager)
    );
    socket.on('table:spectate_leave', () =>
      handleSpectateLeave(socket, tableManager, tournamentManager)
    );
    socket.on('game:action', (data) => handleGameAction(socket, data, tableManager, tournamentManager));
    socket.on('game:fast_fold', () => handleFastFold(socket, tableManager));
    socket.on('matchmaking:join', (data) => handleMatchmakingJoin(socket, data, tableManager));
    socket.on('matchmaking:leave', () => handleMatchmakingLeave(socket, tableManager));
    socket.on('private:create', (data) => handlePrivateCreate(socket, data, tableManager));
    socket.on('private:join', (data) => handlePrivateJoin(socket, data, tableManager));

    // トーナメントイベント登録
    registerTournamentHandlers(socket, tournamentManager);

    socket.on('disconnect', (reason: string) => {
      const role = isSpectate ? 'Spectator' : 'Player';
      // サーバー起因の切断（transport error / ping timeout / 強制切断 等）は error として残し、
      // クライアントが明示的に切断したケース（client namespace disconnect 等）は info で十分
      if (SERVER_CAUSED_DISCONNECT_REASONS.has(reason)) {
        console.error(`[Socket] ${role} disconnected (server-caused): odId=${odId}, socket=${socket.id}, reason=${reason}`);
      } else {
        console.log(`[Socket] ${role} disconnected: odId=${odId}, socket=${socket.id}, reason=${reason}`);
      }

      // displaced されたsocketはクリーンアップをスキップ
      // （新しいsocketの matchmaking:join で正しく処理される）
      if (socket.odDisplacedByNewConnection) {
        return;
      }

      if (socket.odConnectionMode === 'spectate') {
        handleSpectatorDisconnect(socket, tableManager, tournamentManager);
        return;
      }

      if (activePlayerConnections.get(odId)?.id === socket.id) {
        activePlayerConnections.delete(odId);
      }

      handleDisconnect(socket, tableManager);

      const tournamentId = tournamentManager.getPlayerTournament(odId);
      if (tournamentId) {
        const tournament = tournamentManager.getTournament(tournamentId);
        tournament?.handleDisconnect(odId);
      }
    });

    if (process.env.NODE_ENV !== 'production') {
      socket.on('debug:set_chips', (data) => handleDebugSetChips(socket, data, tableManager));
    }
  });

  return { tableManager, tournamentManager };
}
