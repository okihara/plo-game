import { Server, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { MatchmakingPool } from '../fastfold/MatchmakingPool.js';
import { prisma } from '../../config/database.js';
import { Action } from '../../shared/logic/types.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';
import { cashOutPlayer } from '../auth/bankroll.js';

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

  // Authentication middleware (requires authentication or bot credentials)
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

      if (!token) {
        return next(new Error('認証が必要です'));
      }

      const decoded = fastify.jwt.verify<{ userId: string }>(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { bankroll: true },
      });

      if (!user) {
        return next(new Error('ユーザーが見つかりません'));
      }

      socket.odId = user.id;
      socket.odName = user.username;
      socket.odAvatarUrl = user.avatarUrl;
      socket.odIsBot = false;
      return next();
    } catch (err) {
      console.warn('Socket auth failed:', err);
      return next(new Error('認証に失敗しました'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`Player connected: ${socket.odId} (${socket.odName})`);

    socket.emit('connection:established', { playerId: socket.odId! });

    // メンテナンス状態を新規接続クライアントに通知
    if (maintenanceService.isMaintenanceActive()) {
      socket.emit('maintenance:status', maintenanceService.getStatus());
    }

    // Handle table leave
    socket.on('table:leave', async () => {
      const table = tableManager.getPlayerTable(socket.odId!);
      if (table) {
        await unseatAndCashOut(table, socket.odId!);
        socket.emit('table:left');
      } else {
        console.warn(`[table:leave] Player ${socket.odId} tried to leave but not seated at any table`);
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

    // Handle fast fold pool join
    socket.on('matchmaking:join', async (data: { blinds: string }) => {
      if (maintenanceService.isMaintenanceActive()) {
        socket.emit('table:error', { message: 'メンテナンス中のため参加できません' });
        return;
      }

      const { blinds } = data;

      try {
        const parts = blinds.split('/');
        if (parts.length !== 2 || parts.some(p => isNaN(Number(p)) || Number(p) <= 0)) {
          console.error(`[matchmaking:join] Invalid blinds format: "${blinds}", odId=${socket.odId}`);
          socket.emit('table:error', { message: 'Invalid blinds format' });
          return;
        }
        const [, bb] = parts.map(Number);
        const minBuyIn = bb * 100; // $300 for $1/$3

        // Check balance (deduction happens later when actually seated)
        const bankroll = await prisma.bankroll.findUnique({
          where: { userId: socket.odId },
        });

        if (!bankroll || bankroll.balance < minBuyIn) {
          socket.emit('table:error', { message: 'Insufficient balance for minimum buy-in' });
          return;
        }

        // Leave current table if any (with cashout)
        const currentTable = tableManager.getPlayerTable(socket.odId!);
        if (currentTable) {
          await unseatAndCashOut(currentTable, socket.odId!);
        }

        // Queue player
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
      try {
        matchmakingPool.removeFromQueue(socket.odId!, data.blinds);

        // Leave current table too (with cashout)
        const table = tableManager.getPlayerTable(socket.odId!);
        if (table) {
          await unseatAndCashOut(table, socket.odId!);
        }
      } catch (err) {
        console.error(`Error during matchmaking:leave for ${socket.odId}:`, err);
        socket.emit('table:error', { message: 'Failed to leave matchmaking pool' });
      }
    });

    // Handle disconnect - immediately unseat and cash out
    socket.on('disconnect', async () => {
      console.log(`Player disconnected: ${socket.odId} (${socket.odName})`);

      try {
        // テーブルから離席+キャッシュアウト
        const table = tableManager.getPlayerTable(socket.odId!);
        if (table) {
          await unseatAndCashOut(table, socket.odId!);
        }

        // マッチメイキングキューから除去（バイイン未引き落としなのでリファンド不要）
        matchmakingPool.removeFromAllQueues(socket.odId!);
      } catch (err) {
        console.error(`Error during disconnect cleanup for ${socket.odId}:`, err);
      }
    });

    // Debug: チップ設定（開発環境のみ）
    if (process.env.NODE_ENV !== 'production') {
      socket.on('debug:set_chips', (data: { chips: number }) => {
        const table = tableManager.getPlayerTable(socket.odId!);
        if (!table) {
          socket.emit('table:error', { message: '[debug] Not seated at a table' });
          return;
        }

        const success = table.debugSetChips(socket.odId!, data.chips);
        if (success) {
          console.log(`[debug] Set chips for ${socket.odName} to ${data.chips}`);
        } else {
          socket.emit('table:error', { message: '[debug] Failed to set chips' });
        }
      });
    }

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
