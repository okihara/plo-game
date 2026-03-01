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
  handleSpectate,
  handlePrivateCreate,
  handlePrivateJoin,
} from './handlers.js';

interface GameSocketDependencies {
  tableManager: TableManager;
}

export function setupGameSocket(io: Server, fastify: FastifyInstance): GameSocketDependencies {
  const tableManager = new TableManager(io);

  // Create default tables
  tableManager.createTable('1/3', false); // Regular table
  const defaultFfTable = tableManager.createTable('1/3', true); // Fast fold table
  setupFastFoldCallback(defaultFfTable, tableManager);

  // Authentication middleware
  setupAuthMiddleware(io, fastify);

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`Player connected: ${socket.odId}`);
    socket.emit('connection:established', { playerId: socket.odId! });

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
    socket.on('disconnect', () => handleDisconnect(socket, tableManager));
    socket.on('table:spectate', (data) => handleSpectate(socket, data, tableManager));
    socket.on('private:create', (data) => handlePrivateCreate(socket, data, tableManager));
    socket.on('private:join', (data) => handlePrivateJoin(socket, data, tableManager));

    if (process.env.NODE_ENV !== 'production') {
      socket.on('debug:set_chips', (data) => handleDebugSetChips(socket, data, tableManager));
    }
  });

  return { tableManager };
}
