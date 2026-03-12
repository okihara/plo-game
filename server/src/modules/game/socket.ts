import { Server } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { TableManager } from '../table/TableManager.js';
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
} from './handlers.js';

interface GameSocketDependencies {
  tableManager: TableManager;
}

export function setupGameSocket(io: Server, fastify: FastifyInstance): GameSocketDependencies {
  const tableManager = new TableManager(io);

  // 同一ユーザーの最新socket接続を追跡（odId → socket）
  const activeConnections = new Map<string, AuthenticatedSocket>();

  // Create default tables
  tableManager.createTable('1/3', false); // Regular table
  const defaultFfTable = tableManager.createTable('1/3', true); // Fast fold table
  setupFastFoldCallback(defaultFfTable, tableManager);

  // Authentication middleware
  setupAuthMiddleware(io, fastify);

  io.on('connection', (socket: AuthenticatedSocket) => {
    const odId = socket.odId!;
    console.log(`Player connected: ${odId} (socket: ${socket.id})`);

    // 同一ユーザーの旧接続を切断
    const existingSocket = activeConnections.get(odId);
    if (existingSocket && existingSocket.id !== socket.id) {
      console.log(`[DuplicateConnection] Disconnecting old socket for ${odId}: ${existingSocket.id}`);
      existingSocket.odDisplacedByNewConnection = true;
      existingSocket.emit('connection:displaced', { reason: 'new_connection' });
      existingSocket.disconnect(true);
    }
    activeConnections.set(odId, socket);

    socket.emit('connection:established', { playerId: odId });

    if (maintenanceService.isMaintenanceActive()) {
      socket.emit('maintenance:status', maintenanceService.getStatus());
    }
    if (announcementService.isAnnouncementActive()) {
      socket.emit('announcement:status', announcementService.getStatus());
    }

    socket.on('table:leave', () => handleTableLeave(socket, tableManager));
    socket.on('game:action', (data) => handleGameAction(socket, data, tableManager));
    socket.on('game:fast_fold', () => handleFastFold(socket, tableManager));
    socket.on('matchmaking:join', (data) => handleMatchmakingJoin(socket, data, tableManager));
    socket.on('matchmaking:leave', () => handleMatchmakingLeave(socket, tableManager));
    socket.on('private:create', (data) => handlePrivateCreate(socket, data, tableManager));
    socket.on('private:join', (data) => handlePrivateJoin(socket, data, tableManager));

    socket.on('disconnect', () => {
      // displaced されたsocketはクリーンアップをスキップ
      // （新しいsocketの matchmaking:join で正しく処理される）
      if (socket.odDisplacedByNewConnection) {
        console.log(`[DuplicateConnection] Skipping cleanup for displaced socket ${odId}: ${socket.id}`);
        return;
      }

      // 自分がまだ最新の接続の場合のみレジストリから削除
      if (activeConnections.get(odId)?.id === socket.id) {
        activeConnections.delete(odId);
      }

      handleDisconnect(socket, tableManager);
    });

    if (process.env.NODE_ENV !== 'production') {
      socket.on('debug:set_chips', (data) => handleDebugSetChips(socket, data, tableManager));
    }
  });

  return { tableManager };
}
