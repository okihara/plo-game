import { Server, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { MatchmakingPool } from '../fastfold/MatchmakingPool.js';
import { prisma } from '../../config/database.js';
import { Action } from '../../shared/logic/types.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';

interface AuthenticatedSocket extends Socket {
  odId?: string;
  odName?: string;
  odAvatarUrl?: string | null;
  odIsBot?: boolean;
}

interface GameSocketDependencies {
  tableManager: TableManager;
  matchmakingPool: MatchmakingPool;
}

// Bot用ユーザーをDBにfind or create
async function findOrCreateBotUser(botName: string, botAvatar: string | null) {
  const providerId = botName;
  let user = await prisma.user.findUnique({
    where: { provider_providerId: { provider: 'bot', providerId } },
  });

  if (!user) {
    let username = botName;
    let suffix = 1;
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${botName}${suffix}`;
      suffix++;
    }

    user = await prisma.user.create({
      data: {
        email: `${botName.toLowerCase().replace(/[^a-z0-9]/g, '_')}@bot.local`,
        username,
        avatarUrl: botAvatar,
        provider: 'bot',
        providerId,
        bankroll: { create: { balance: 100000 } },
      },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), avatarUrl: botAvatar },
    });
  }

  return user;
}

// テーブル離脱時のキャッシュアウト処理
async function cashOutPlayer(odId: string, chips: number, tableId?: string): Promise<void> {
  if (odId.startsWith('guest_') || chips <= 0) return;
  try {
    await prisma.bankroll.update({
      where: { userId: odId },
      data: { balance: { increment: chips } },
    });
    await prisma.transaction.create({
      data: { userId: odId, type: 'CASH_OUT', amount: chips, tableId },
    });
  } catch (e) {
    console.error('Cash-out failed:', odId, chips, e);
  }
}

export function setupGameSocket(io: Server, fastify: FastifyInstance): GameSocketDependencies {
  const tableManager = new TableManager(io);
  const matchmakingPool = new MatchmakingPool(io, tableManager);

  // テーブルから離席してキャッシュアウトする共通処理
  async function unseatAndCashOut(table: TableInstance, odId: string): Promise<void> {
    const result = table.unseatPlayer(odId);
    tableManager.removePlayerFromTracking(odId);
    if (result) {
      await cashOutPlayer(result.odId, result.chips, table.id);
    }
  }

  // Create default tables
  tableManager.createTable('1/3', false); // Regular table
  tableManager.createTable('1/3', true);  // Fast fold table

  // Authentication middleware (allows anonymous guests and bots)
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      // Check if this is a bot connection
      const isBot = socket.handshake.auth.isBot === true;
      if (isBot) {
        const botName = socket.handshake.auth.botName || 'Bot';
        const botAvatar = socket.handshake.auth.botAvatar || null;

        const user = await findOrCreateBotUser(botName, botAvatar);

        socket.odId = user.id;
        socket.odName = user.username;
        socket.odAvatarUrl = user.avatarUrl;
        socket.odIsBot = true;

        console.log(`Bot connected: ${user.id} (${user.username})`);
        return next();
      }

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
          socket.odIsBot = false;
          return next();
        }
      }

      // Anonymous guest - generate temporary ID
      const guestId = `guest_${socket.id}`;
      const guestNumber = Math.floor(Math.random() * 9999) + 1;
      socket.odId = guestId;
      socket.odName = `Guest${guestNumber}`;
      socket.odAvatarUrl = null;
      socket.odIsBot = false;

      next();
    } catch (err) {
      // On error, fall back to guest mode
      const guestId = `guest_${socket.id}`;
      const guestNumber = Math.floor(Math.random() * 9999) + 1;
      socket.odId = guestId;
      socket.odName = `Guest${guestNumber}`;
      socket.odAvatarUrl = null;
      socket.odIsBot = false;
      next();
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`Player connected: ${socket.odId} (${socket.odName})`);

    socket.emit('connection:established', { playerId: socket.odId! });

    // メンテナンス状態を新規接続クライアントに通知
    if (maintenanceService.isMaintenanceActive()) {
      socket.emit('maintenance:status', maintenanceService.getStatus());
    }

    // Handle table join
    socket.on('table:join', async (data: { tableId: string; buyIn: number }) => {
      if (maintenanceService.isMaintenanceActive()) {
        socket.emit('table:error', { message: 'メンテナンス中のため参加できません' });
        return;
      }

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

        // Leave current table if any (with cashout)
        const currentTable = tableManager.getPlayerTable(socket.odId!);
        if (currentTable) {
          await unseatAndCashOut(currentTable, socket.odId!);
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
          socket,
          buyIn,
          socket.odAvatarUrl
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
        await unseatAndCashOut(table, socket.odId!);
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
    socket.on('game:fold', () => {
      const table = tableManager.getPlayerTable(socket.odId!);
      if (table && table.isFastFold) {
        table.handleFastFold(socket.odId!);
      }
    });

    // Handle fast fold pool join
    socket.on('matchmaking:join', async (data: { blinds: string }) => {
      if (maintenanceService.isMaintenanceActive()) {
        socket.emit('table:error', { message: 'メンテナンス中のため参加できません' });
        return;
      }

      const { blinds } = data;
      const isGuest = socket.odId!.startsWith('guest_');

      try {
        const [, bb] = blinds.split('/').map(Number);
        const minBuyIn = bb * 100; // $300 for $1/$3

        if (!isGuest) {
          // Authenticated user (including bots) - check balance
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

        // Leave current table if any (with cashout)
        const currentTable = tableManager.getPlayerTable(socket.odId!);
        if (currentTable) {
          await unseatAndCashOut(currentTable, socket.odId!);
        }

        // Queue player (guests get default buy-in)
        await matchmakingPool.queuePlayer(
          socket.odId!,
          socket.odName!,
          socket.odAvatarUrl!,
          socket,
          minBuyIn,
          blinds
        );
      } catch (err) {
        console.error('Error joining fast fold:', err);
        socket.emit('table:error', { message: 'Failed to join matchmaking pool' });
      }
    });

    // Handle fast fold pool leave
    socket.on('matchmaking:leave', async (data: { blinds: string }) => {
      await matchmakingPool.removeFromQueue(socket.odId!, data.blinds);

      // Leave current table too (with cashout)
      const table = tableManager.getPlayerTable(socket.odId!);
      if (table) {
        await unseatAndCashOut(table, socket.odId!);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.odId} (${socket.odName})`);

      const table = tableManager.getPlayerTable(socket.odId!);
      if (table) {
        const odId = socket.odId!;
        // Give some time for reconnection before removing
        setTimeout(async () => {
          // Check if player reconnected
          const stillConnected = Array.from(io.sockets.sockets.values())
            .some((s: AuthenticatedSocket) => s.odId === odId);

          if (!stillConnected) {
            await unseatAndCashOut(table, odId);
          }
        }, 30000); // 30 second grace period
      }
    });

    // Get available tables
    socket.on('lobby:get_tables', () => {
      const tables = tableManager.getTablesInfo();
      socket.emit('lobby:tables', { tables });
    });

    // Handle spectator join
    socket.on('table:spectate', (data: { tableId: string }) => {
      const { tableId } = data;
      const table = tableManager.getTable(tableId);
      if (!table) {
        socket.emit('table:error', { message: 'Table not found' });
        return;
      }

      table.addSpectator(socket);

      const clientState = table.getClientGameState();
      socket.emit('game:state', { state: clientState });

      table.sendAllHoleCardsToSpectator(socket);

      socket.emit('table:spectating', { tableId });
    });
  });

  return { tableManager, matchmakingPool };
}
