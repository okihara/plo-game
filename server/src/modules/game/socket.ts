import { Server, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { prisma } from '../../config/database.js';
import { Action } from '../../shared/logic/types.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';
import { cashOutPlayer, deductBuyIn } from '../auth/bankroll.js';

interface AuthenticatedSocket extends Socket {
  odId?: string;
  odIsBot?: boolean;
}

interface GameSocketDependencies {
  tableManager: TableManager;
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

  // テーブルから離席してキャッシュアウトする共通処理
  async function unseatAndCashOut(table: TableInstance, odId: string): Promise<void> {
    const result = table.unseatPlayer(odId);
    tableManager.removePlayerFromTracking(odId);
    if (result) {
      await cashOutPlayer(result.odId, result.chips, table.id);
    }
  }

  // ファストフォールド: フォールド後に別テーブルへ移動する
  async function handleFastFoldMove(
    socket: AuthenticatedSocket,
    currentTable: TableInstance,
    odId: string
  ): Promise<void> {
    // 1. 現テーブルから静かに離席（チップを持って出る）
    const unseatResult = currentTable.unseatForFastFold(odId);
    if (!unseatResult) {
      console.warn(`[FastFold] unseatForFastFold failed for ${odId}`);
      return;
    }

    // チップが0以下なら移動せずバスト扱い
    if (unseatResult.chips <= 0) {
      tableManager.removePlayerFromTracking(odId);
      await cashOutPlayer(odId, 0, currentTable.id);
      socket.emit('table:busted', { message: 'チップがなくなりました' });
      return;
    }

    // 2. トラッキングを一旦削除
    tableManager.removePlayerFromTracking(odId);

    // 3. 新しいファストフォールドテーブルを取得（現テーブルを除外優先）
    const newTable = tableManager.getOrCreateTable(
      currentTable.blinds,
      true,
      currentTable.id
    );
    setupFastFoldCallback(newTable);

    // 4. ユーザー情報を取得
    const user = await prisma.user.findUnique({
      where: { id: odId },
    });

    if (!user) {
      console.error(`[FastFold] User not found: ${odId}`);
      await cashOutPlayer(odId, unseatResult.chips, currentTable.id);
      socket.emit('table:left');
      return;
    }

    // 5. 新テーブルに着席（バイイン控除なし、チップをそのまま持ち越し）
    const seatNumber = newTable.seatPlayer(
      odId,
      user.username,
      socket as Socket,
      unseatResult.chips,
      user.useTwitterAvatar ? (user.avatarUrl ?? null) : null,
      undefined,
      { skipJoinedEmit: true },
      user.nameMasked
    );

    if (seatNumber !== null) {
      // 6. トラッキング更新
      tableManager.setPlayerTable(odId, newTable.id);

      // 7. table:change を送信（フロントエンドはこれでテーブル移動を認識）
      socket.emit('table:change', { tableId: newTable.id, seat: seatNumber });

      // 8. 新テーブルのハンド開始を試行
      newTable.triggerMaybeStartHand();
    } else {
      // 席がない場合はチップを返金してテーブル離脱扱い
      await cashOutPlayer(odId, unseatResult.chips, currentTable.id);
      socket.emit('table:left');
      console.error(`[FastFold] Failed to seat player ${odId} at new table ${newTable.id}`);
    }
  }

  // FFテーブルにハンド完了後の再割り当てコールバックを設定
  function setupFastFoldCallback(table: TableInstance): void {
    if (!table.isFastFold || table.onFastFoldReassign) return;
    table.onFastFoldReassign = (players) => {
      for (const p of players) {
        tableManager.removePlayerFromTracking(p.odId);

        if (p.chips <= 0) {
          cashOutPlayer(p.odId, 0, table.id).catch(e => console.error('[FastFold] cashOut error:', e));
          p.socket.emit('table:busted', { message: 'チップがなくなりました' });
          continue;
        }

        const newTable = tableManager.getOrCreateTable(table.blinds, true, table.id);
        setupFastFoldCallback(newTable);

        const seatNumber = newTable.seatPlayer(
          p.odId, p.odName, p.socket, p.chips, p.avatarUrl, undefined,
          { skipJoinedEmit: true },
          p.nameMasked
        );

        if (seatNumber !== null) {
          tableManager.setPlayerTable(p.odId, newTable.id);
          p.socket.emit('table:change', { tableId: newTable.id, seat: seatNumber });
          newTable.triggerMaybeStartHand();
        } else {
          cashOutPlayer(p.odId, p.chips, table.id).catch(e => console.error('[FastFold] cashOut error:', e));
          p.socket.emit('table:left');
        }
      }
    };
  }

  // Create default tables
  tableManager.createTable('1/3', false); // Regular table
  const defaultFfTable = tableManager.createTable('1/3', true);  // Fast fold table
  setupFastFoldCallback(defaultFfTable);

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
      socket.odIsBot = false;
      return next();
    } catch (err) {
      console.warn('Socket auth failed:', err);
      return next(new Error('認証に失敗しました'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`Player connected: ${socket.odId}`);

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
    socket.on('game:action', async (data: { action: Action; amount?: number }) => {
      const table = tableManager.getPlayerTable(socket.odId!);
      if (!table) {
        socket.emit('table:error', { message: 'Not seated at a table' });
        return;
      }

      const success = table.handleAction(socket.odId!, data.action, data.amount || 0);
      if (!success) {
        socket.emit('table:error', { message: 'Invalid action' });
        return;
      }

      // ファストフォールド: フォールド後に別テーブルへ移動
      if (table.isFastFold && data.action === 'fold') {
        try {
          await handleFastFoldMove(socket, table, socket.odId!);
        } catch (err) {
          console.error('[FastFold] move failed:', err);
        }
      }
    });

    // Handle fast fold (fold before your turn in fast fold mode)
    socket.on('game:fast_fold', async () => {
      const table = tableManager.getPlayerTable(socket.odId!);
      if (!table) {
        socket.emit('table:error', { message: 'Not seated at a table' });
        return;
      }

      if (!table.isFastFold) {
        socket.emit('table:error', { message: 'Fast fold not available' });
        return;
      }

      const success = table.handleEarlyFold(socket.odId!);
      if (!success) {
        return;
      }

      try {
        await handleFastFoldMove(socket, table, socket.odId!);
      } catch (err) {
        console.error('[FastFold] early fold move failed:', err);
      }
    });

    // Handle table join (find available table or create one, seat immediately)
    socket.on('matchmaking:join', async (data: { blinds: string; isFastFold?: boolean }) => {
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
        const buyIn = bb * 100; // $300 for $1/$3

        // Check balance and get user info
        const user = await prisma.user.findUnique({
          where: { id: socket.odId },
          include: { bankroll: true },
        });

        if (!user?.bankroll || user.bankroll.balance < buyIn) {
          socket.emit('table:error', { message: 'Insufficient balance for minimum buy-in' });
          return;
        }

        // Leave current table if any (with cashout)
        const currentTable = tableManager.getPlayerTable(socket.odId!);
        if (currentTable) {
          await unseatAndCashOut(currentTable, socket.odId!);
        }

        // Find available table or create one
        const isFastFold = data.isFastFold ?? false;
        const table = tableManager.getOrCreateTable(blinds, isFastFold);
        if (isFastFold) setupFastFoldCallback(table);

        // Deduct buy-in
        const deducted = await deductBuyIn(socket.odId!, buyIn);
        if (!deducted) {
          socket.emit('table:error', { message: 'Insufficient balance for buy-in' });
          return;
        }

        // Seat player
        const seatNumber = table.seatPlayer(
          socket.odId!,
          user.username,
          socket,
          buyIn,
          user.useTwitterAvatar ? (user.avatarUrl ?? null) : null,
          undefined,
          undefined,
          user.nameMasked
        );

        if (seatNumber !== null) {
          tableManager.setPlayerTable(socket.odId!, table.id);
          table.triggerMaybeStartHand();
        } else {
          // Seating failed - refund
          await cashOutPlayer(socket.odId!, buyIn);
          socket.emit('table:error', { message: 'No available seat' });
        }
      } catch (err) {
        console.error('Error joining table:', err);
        socket.emit('table:error', { message: 'Failed to join table' });
      }
    });

    // Handle matchmaking leave (just leave table)
    socket.on('matchmaking:leave', async () => {
      try {
        const table = tableManager.getPlayerTable(socket.odId!);
        if (table) {
          await unseatAndCashOut(table, socket.odId!);
        }
      } catch (err) {
        console.error(`Error during matchmaking:leave for ${socket.odId}:`, err);
        socket.emit('table:error', { message: 'Failed to leave table' });
      }
    });

    // Handle disconnect - immediately unseat and cash out
    socket.on('disconnect', async () => {
      console.log(`Player disconnected: ${socket.odId}`);

      try {
        const table = tableManager.getPlayerTable(socket.odId!);
        if (table) {
          await unseatAndCashOut(table, socket.odId!);
        }
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
          console.log(`[debug] Set chips for ${socket.odId} to ${data.chips}`);
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

  return { tableManager };
}
