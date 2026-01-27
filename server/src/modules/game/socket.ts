import { Server, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { TableManager } from '../table/TableManager.js';
import { FastFoldPool } from '../fastfold/FastFoldPool.js';
import { prisma } from '../../config/database.js';
import { Action } from '../../shared/logic/types.js';

interface AuthenticatedSocket extends Socket {
  odId?: string;
  odName?: string;
  odAvatarUrl?: string | null;
}

interface GameSocketDependencies {
  tableManager: TableManager;
  fastFoldPool: FastFoldPool;
}

export function setupGameSocket(io: Server, fastify: FastifyInstance): GameSocketDependencies {
  const tableManager = new TableManager(io);
  const fastFoldPool = new FastFoldPool(io, tableManager);

  // Create default tables
  tableManager.createTable('1/3', false); // Regular table
  tableManager.createTable('1/3', true);  // Fast fold table

  // Authentication middleware (allows anonymous guests)
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token ||
        socket.handshake.headers.cookie?.split('token=')[1]?.split(';')[0];

      if (token) {
        // Authenticated user
        const decoded = fastify.jwt.verify<{ userId: string }>(token);
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          include: { bankroll: true },
        });

        if (user) {
          socket.odId = user.id;
          socket.odName = user.username;
          socket.odAvatarUrl = user.avatarUrl;
          return next();
        }
      }

      // Anonymous guest - generate temporary ID
      const guestId = `guest_${socket.id}`;
      const guestNumber = Math.floor(Math.random() * 9999) + 1;
      socket.odId = guestId;
      socket.odName = `Guest${guestNumber}`;
      socket.odAvatarUrl = null;

      next();
    } catch (err) {
      // On error, fall back to guest mode
      const guestId = `guest_${socket.id}`;
      const guestNumber = Math.floor(Math.random() * 9999) + 1;
      socket.odId = guestId;
      socket.odName = `Guest${guestNumber}`;
      socket.odAvatarUrl = null;
      next();
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`Player connected: ${socket.odId} (${socket.odName})`);

    socket.emit('connection:established', { playerId: socket.odId! });

    // Handle table join
    socket.on('table:join', async (data: { tableId: string; buyIn: number }) => {
      const { tableId, buyIn } = data;

      try {
        // Check balance
        const bankroll = await prisma.bankroll.findUnique({
          where: { userId: socket.odId },
        });

        if (!bankroll || bankroll.balance < buyIn) {
          socket.emit('table:error', { message: 'Insufficient balance' });
          return;
        }

        // Get table
        const table = tableManager.getTable(tableId);
        if (!table) {
          socket.emit('table:error', { message: 'Table not found' });
          return;
        }

        // Leave current table if any
        const currentTable = tableManager.getPlayerTable(socket.odId!);
        if (currentTable) {
          currentTable.unseatPlayer(socket.odId!);
          tableManager.removePlayerFromTracking(socket.odId!);
        }

        // Deduct buy-in from balance
        await prisma.bankroll.update({
          where: { userId: socket.odId },
          data: { balance: { decrement: buyIn } },
        });

        await prisma.transaction.create({
          data: {
            userId: socket.odId!,
            type: 'BUY_IN',
            amount: -buyIn,
            tableId,
          },
        });

        // Seat player
        const seatNumber = table.seatPlayer(
          socket.odId!,
          socket.odName!,
          socket.odAvatarUrl!,
          socket,
          buyIn
        );

        if (seatNumber !== null) {
          tableManager.setPlayerTable(socket.odId!, tableId);
          socket.emit('table:joined', { tableId, seat: seatNumber });
        } else {
          // Refund if couldn't seat
          await prisma.bankroll.update({
            where: { userId: socket.odId },
            data: { balance: { increment: buyIn } },
          });
          socket.emit('table:error', { message: 'No available seats' });
        }
      } catch (err) {
        console.error('Error joining table:', err);
        socket.emit('table:error', { message: 'Failed to join table' });
      }
    });

    // Handle table leave
    socket.on('table:leave', async () => {
      const table = tableManager.getPlayerTable(socket.odId!);
      if (table) {
        // Get remaining chips
        // Note: Would need to add method to get player chips from table
        table.unseatPlayer(socket.odId!);
        tableManager.removePlayerFromTracking(socket.odId!);
        socket.emit('table:left');
      }
    });

    // Handle game action
    socket.on('game:action', (data: { action: Action; amount?: number }) => {
      const table = tableManager.getPlayerTable(socket.odId!);
      if (!table) {
        socket.emit('table:error', { message: 'Not seated at a table' });
        return;
      }

      const success = table.handleAction(socket.odId!, data.action, data.amount || 0);
      if (!success) {
        socket.emit('table:error', { message: 'Invalid action' });
      }
    });

    // Handle fast fold
    socket.on('game:fast_fold', () => {
      const table = tableManager.getPlayerTable(socket.odId!);
      if (table && table.isFastFold) {
        table.handleFastFold(socket.odId!);
      }
    });

    // Handle fast fold pool join
    socket.on('fastfold:join', async (data: { blinds: string }) => {
      const { blinds } = data;
      const isGuest = socket.odId!.startsWith('guest_');

      try {
        const [, bb] = blinds.split('/').map(Number);
        const minBuyIn = bb * 100; // $300 for $1/$3

        if (!isGuest) {
          // Authenticated user - check balance
          const bankroll = await prisma.bankroll.findUnique({
            where: { userId: socket.odId },
          });

          if (!bankroll || bankroll.balance < minBuyIn) {
            socket.emit('table:error', { message: 'Insufficient balance for minimum buy-in' });
            return;
          }

          // Deduct buy-in
          await prisma.bankroll.update({
            where: { userId: socket.odId },
            data: { balance: { decrement: minBuyIn } },
          });

          await prisma.transaction.create({
            data: {
              userId: socket.odId!,
              type: 'BUY_IN',
              amount: -minBuyIn,
            },
          });
        }

        // Leave current table if any
        const currentTable = tableManager.getPlayerTable(socket.odId!);
        if (currentTable) {
          currentTable.unseatPlayer(socket.odId!);
          tableManager.removePlayerFromTracking(socket.odId!);
        }

        // Queue player (guests get default buy-in)
        await fastFoldPool.queuePlayer(
          socket.odId!,
          socket.odName!,
          socket.odAvatarUrl!,
          socket,
          minBuyIn,
          blinds
        );
      } catch (err) {
        console.error('Error joining fast fold:', err);
        socket.emit('table:error', { message: 'Failed to join fast fold pool' });
      }
    });

    // Handle fast fold pool leave
    socket.on('fastfold:leave', async (data: { blinds: string }) => {
      await fastFoldPool.removeFromQueue(socket.odId!, data.blinds);

      // Leave current table too
      const table = tableManager.getPlayerTable(socket.odId!);
      if (table) {
        table.unseatPlayer(socket.odId!);
        tableManager.removePlayerFromTracking(socket.odId!);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.odId} (${socket.odName})`);

      const table = tableManager.getPlayerTable(socket.odId!);
      if (table) {
        // Give some time for reconnection before removing
        setTimeout(() => {
          // Check if player reconnected
          const stillConnected = Array.from(io.sockets.sockets.values())
            .some((s: AuthenticatedSocket) => s.odId === socket.odId);

          if (!stillConnected) {
            table.unseatPlayer(socket.odId!);
            tableManager.removePlayerFromTracking(socket.odId!);
          }
        }, 30000); // 30 second grace period
      }
    });

    // Get available tables
    socket.on('lobby:get_tables', () => {
      const tables = tableManager.getTablesInfo();
      socket.emit('lobby:tables', { tables });
    });
  });

  return { tableManager, fastFoldPool };
}
