import { Server } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { Sentry, sentryEnabled } from '../../config/sentry.js';
import { TableManager } from '../table/TableManager.js';
import { TournamentManager } from '../tournament/TournamentManager.js';
import { registerTournamentHandlers } from '../tournament/socket.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';
import { announcementService } from '../announcement/AnnouncementService.js';
import { setupAuthMiddleware, AuthenticatedSocket } from './authMiddleware.js';
import { setupFastFoldCallback } from './fastFoldService.js';
import { wrapSocketHandler } from './socketErrorReporter.js';
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
    if (sentryEnabled) {
      Sentry.withScope((scope) => {
        scope.setTag('source', 'socket.io');
        scope.setTag('socket.phase', 'connection');
        scope.setContext('connection_error', {
          code: err.code,
          message: err.message,
        });
        Sentry.captureMessage(`Socket.io connection_error: ${err.message ?? err.code ?? 'unknown'}`, 'error');
      });
    }
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

    socket.on('table:leave', wrapSocketHandler(socket, 'table:leave', () => handleTableLeave(socket, tableManager)));
    socket.on('table:spectate_join', wrapSocketHandler(socket, 'table:spectate_join', (data: unknown) =>
      handleSpectateJoin(socket, (data as Parameters<typeof handleSpectateJoin>[1]) ?? {}, tableManager, tournamentManager)
    ));
    socket.on('table:spectate_leave', wrapSocketHandler(socket, 'table:spectate_leave', () =>
      handleSpectateLeave(socket, tableManager, tournamentManager)
    ));
    socket.on('game:action', wrapSocketHandler(socket, 'game:action', (data: Parameters<typeof handleGameAction>[1]) =>
      handleGameAction(socket, data, tableManager, tournamentManager)
    ));
    socket.on('game:fast_fold', wrapSocketHandler(socket, 'game:fast_fold', () => handleFastFold(socket, tableManager)));
    socket.on('matchmaking:join', wrapSocketHandler(socket, 'matchmaking:join', (data: Parameters<typeof handleMatchmakingJoin>[1]) =>
      handleMatchmakingJoin(socket, data, tableManager)
    ));
    socket.on('matchmaking:leave', wrapSocketHandler(socket, 'matchmaking:leave', () => handleMatchmakingLeave(socket, tableManager)));
    socket.on('private:create', wrapSocketHandler(socket, 'private:create', (data: Parameters<typeof handlePrivateCreate>[1]) =>
      handlePrivateCreate(socket, data, tableManager)
    ));
    socket.on('private:join', wrapSocketHandler(socket, 'private:join', (data: Parameters<typeof handlePrivateJoin>[1]) =>
      handlePrivateJoin(socket, data, tableManager)
    ));

    // トーナメントイベント登録
    registerTournamentHandlers(socket, tournamentManager);

    socket.on('disconnect', (reason: string) => {
      const role = isSpectate ? 'Spectator' : 'Player';
      const username = socket.odUsername ?? '(unknown)';
      // サーバー起因の切断（transport error / ping timeout / 強制切断 等）は error として残し、
      // クライアントが明示的に切断したケース（client namespace disconnect 等）は info で十分
      if (SERVER_CAUSED_DISCONNECT_REASONS.has(reason)) {
        console.error(`[Socket] ${role} disconnected (server-caused): odId=${odId}, username=${username}, socket=${socket.id}, reason=${reason}`);
      } else {
        console.log(`[Socket] ${role} disconnected: odId=${odId}, username=${username}, socket=${socket.id}, reason=${reason}`);
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
      socket.on('debug:set_chips', wrapSocketHandler(socket, 'debug:set_chips', (data: Parameters<typeof handleDebugSetChips>[1]) =>
        handleDebugSetChips(socket, data, tableManager)
      ));
    }
  });

  return { tableManager, tournamentManager };
}
