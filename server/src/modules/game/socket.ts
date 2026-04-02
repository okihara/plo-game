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

  io.on('connection', (socket: AuthenticatedSocket) => {
    const odId = socket.odId!;
    const isSpectate = socket.odConnectionMode === 'spectate';
    console.log(`${isSpectate ? 'Spectator' : 'Player'} connected: ${odId} (socket: ${socket.id})`);

    if (!isSpectate) {
      const existingSocket = activePlayerConnections.get(odId);
      if (existingSocket && existingSocket.id !== socket.id) {
        console.log(`[DuplicateConnection] Disconnecting old socket for ${odId}: ${existingSocket.id}`);
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

    socket.on('disconnect', () => {
      // displaced されたsocketはクリーンアップをスキップ
      // （新しいsocketの matchmaking:join で正しく処理される）
      if (socket.odDisplacedByNewConnection) {
        console.log(`[DuplicateConnection] Skipping cleanup for displaced socket ${odId}: ${socket.id}`);
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
