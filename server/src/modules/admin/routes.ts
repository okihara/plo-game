import { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { TableManager } from '../table/TableManager.js';
import { TournamentManager } from '../tournament/TournamentManager.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import type { MessageLog, PendingAction } from '../table/TableInstance.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';
import { announcementService } from '../announcement/AnnouncementService.js';
import { cashOutPlayer } from '../auth/bankroll.js';
import {
  DEFAULT_BUY_IN,
  DEFAULT_STARTING_CHIPS,
  DEFAULT_MAX_PLAYERS,
  DEFAULT_MIN_PLAYERS,
  DEFAULT_REGISTRATION_LEVELS,
} from '../tournament/constants.js';

const tournamentDefaults = {
  buyIn: DEFAULT_BUY_IN,
  startingChips: DEFAULT_STARTING_CHIPS,
  maxPlayers: DEFAULT_MAX_PLAYERS,
  minPlayers: DEFAULT_MIN_PLAYERS,
  registrationLevels: DEFAULT_REGISTRATION_LEVELS,
};

interface AdminDependencies {
  io: Server;
  tableManager: TableManager;
  tournamentManager: TournamentManager;
}

interface TableStats {
  id: string;
  blinds: string;
  variant: string;
  isFastFold: boolean;
  playerCount: number;
  maxPlayers: number;
  isHandInProgress: boolean;
  currentStreet: string | null;
  pot: number;
  players: Array<{
    odId: string;
    odName: string;
    seatNumber: number;
    chips: number;
    isConnected: boolean;
    folded: boolean;
    isAllIn: boolean;
    position: string;
    currentBet: number;
    totalBetThisRound: number;
    hasActed: boolean;
    isSittingOut: boolean;
    buyIn: number;
    waitingForNextHand: boolean;
  }>;
  // デバッグ情報
  gamePhase: string;
  pendingAction: PendingAction | null;
  recentMessages: MessageLog[];
}

interface ServerStats {
  timestamp: string;
  uptime: number;
  connections: {
    total: number;
    authenticated: number;
  };
  tables: {
    total: number;
    regular: number;
    fastFold: number;
    activeHands: number;
    details: TableStats[];
  };
  database: {
    connected: boolean;
    userCount: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  tournaments: {
    total: number;
    details: TournamentStats[];
  };
  maintenance: {
    isActive: boolean;
    message: string;
    activatedAt: string | null;
  };
  announcement: {
    isActive: boolean;
    message: string;
  };
}

interface TournamentStats {
  id: string;
  name: string;
  status: string;
  buyIn: number;
  playersRemaining: number;
  totalPlayers: number;
  prizePool: number;
  currentBlindLevel: { smallBlind: number; bigBlind: number } | null;
  tableCount: number;
  tables: TableStats[];
}

const startTime = Date.now();

export function adminRoutes(deps: AdminDependencies) {
  const { io, tableManager, tournamentManager } = deps;

  return async function (fastify: FastifyInstance) {
    // 管理エンドポイント認証: ADMIN_SECRET が設定されている場合、?secret= パラメータで認証
    fastify.addHook('onRequest', async (request, reply) => {
      const secret = env.ADMIN_SECRET;
      if (!secret) return; // ADMIN_SECRET 未設定時はスキップ（開発環境用）

      const querySecret = (request.query as Record<string, string>).secret;
      if (querySecret !== secret) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    });

    // JSON API for stats
    fastify.get('/api/admin/stats', async (): Promise<ServerStats> => {
      const sockets = Array.from(io.sockets.sockets.values());
      const authenticatedCount = sockets.filter((s: any) => s.odId).length;

      const tablesInfo = tableManager.getTablesInfo();
      const tableDetails: TableStats[] = [];

      for (const info of tablesInfo) {
        const table = tableManager.getTable(info.id);
        if (table) {
          const gameState = table.getClientGameState();
          const debugState = table.getDebugState();
          tableDetails.push({
            id: info.id,
            blinds: info.blinds,
            variant: info.variant,
            isFastFold: info.isFastFold,
            playerCount: info.players,
            maxPlayers: info.maxPlayers,
            isHandInProgress: gameState?.isHandInProgress ?? false,
            currentStreet: gameState?.currentStreet ?? null,
            pot: gameState?.pot ?? 0,
            players: table.getAdminSeats().filter((s): s is NonNullable<typeof s> => s !== null),
            // デバッグ情報
            gamePhase: debugState.gamePhase,
            pendingAction: debugState.pendingAction,
            recentMessages: debugState.messageLog.slice(-10), // 直近10件
          });
        }
      }

      const regularTables = tableDetails.filter(t => !t.isFastFold);
      const fastFoldTables = tableDetails.filter(t => t.isFastFold);
      const activeHands = tableDetails.filter(t => t.isHandInProgress).length;

      // トーナメント情報
      const activeTournaments = tournamentManager.getActiveTournaments();
      const tournamentDetails: TournamentStats[] = activeTournaments.map(lobby => {
        const tournament = tournamentManager.getTournament(lobby.id);
        const tTables: TableStats[] = [];
        if (tournament) {
          for (const table of tournament.getTables()) {
            const gameState = table.getClientGameState();
            const debugState = table.getDebugState();
            tTables.push({
              id: table.id,
              blinds: table.blinds,
              variant: table.variant ?? 'plo',
              isFastFold: false,
              playerCount: table.getAdminSeats().filter((s): s is NonNullable<typeof s> => s !== null).length,
              maxPlayers: 6,
              isHandInProgress: gameState?.isHandInProgress ?? false,
              currentStreet: gameState?.currentStreet ?? null,
              pot: gameState?.pot ?? 0,
              players: table.getAdminSeats().filter((s): s is NonNullable<typeof s> => s !== null),
              gamePhase: debugState.gamePhase,
              pendingAction: debugState.pendingAction,
              recentMessages: debugState.messageLog.slice(-10),
            });
          }
        }
        const currentLevel = tournament?.getClientState()?.currentBlindLevel ?? null;
        return {
          id: lobby.id,
          name: lobby.name,
          status: lobby.status,
          buyIn: lobby.buyIn,
          playersRemaining: tournament?.getPlayersRemaining() ?? 0,
          totalPlayers: lobby.registeredPlayers,
          prizePool: lobby.prizePool,
          currentBlindLevel: currentLevel ? { smallBlind: currentLevel.smallBlind, bigBlind: currentLevel.bigBlind } : null,
          tableCount: tournament?.getTableCount() ?? 0,
          tables: tTables,
        };
      });

      // Database check
      let dbConnected = false;
      let userCount = 0;
      try {
        userCount = await prisma.user.count();
        dbConnected = true;
      } catch (e) {
        console.warn('Admin stats: DB connection check failed:', e);
        dbConnected = false;
      }

      const memUsage = process.memoryUsage();

      return {
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        connections: {
          total: sockets.length,
          authenticated: authenticatedCount,
        },
        tables: {
          total: tablesInfo.length,
          regular: regularTables.length,
          fastFold: fastFoldTables.length,
          activeHands,
          details: tableDetails,
        },
        database: {
          connected: dbConnected,
          userCount,
        },
        tournaments: {
          total: tournamentDetails.length,
          details: tournamentDetails,
        },
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          rss: memUsage.rss,
        },
        maintenance: maintenanceService.getStatus(),
        announcement: announcementService.getStatus(),
      };
    });

    // Maintenance mode toggle
    fastify.post('/api/admin/maintenance', async (request) => {
      const { active, message } = request.body as { active: boolean; message?: string };
      return maintenanceService.toggle(active, message || '');
    });

    // Announcement (no play restriction)
    fastify.post('/api/admin/announcement', async (request) => {
      const { message } = request.body as { message?: string };
      if (message) {
        return announcementService.set(message);
      }
      return announcementService.clear();
    });

    // Connected players API
    fastify.get('/api/admin/players', async () => {
      const sockets = Array.from(io.sockets.sockets.values());
      const connectedOdIds = new Set<string>();
      const socketInfos: Array<{
        odId: string;
        isBot: boolean;
        tableId: string | null;
        tableBlinds: string | null;
        seatNumber: number | null;
        chips: number | null;
        connectedAt: number;
      }> = [];

      for (const s of sockets) {
        const authSocket = s as any;
        const odId = authSocket.odId;
        if (!odId) continue;
        connectedOdIds.add(odId);

        const table = tableManager.getPlayerTable(odId);
        let seatNumber: number | null = null;
        let chips: number | null = null;
        if (table) {
          const seats = table.getAdminSeats();
          const seat = seats.find((st: any) => st && st.odId === odId);
          if (seat) {
            seatNumber = seat.seatNumber;
            chips = seat.chips;
          }
        }

        socketInfos.push({
          odId,
          isBot: !!authSocket.odIsBot,
          tableId: table?.id ?? null,
          tableBlinds: table?.blinds ?? null,
          seatNumber,
          chips,
          connectedAt: (authSocket as any).handshake?.issued ?? Date.now(),
        });
      }

      // Fetch user details from DB
      const userIds = Array.from(connectedOdIds);
      const users = userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            include: { bankroll: true },
            })
        : [];
      const userMap = new Map(users.map(u => [u.id, u]));

      const players = socketInfos.map(si => {
        const user = userMap.get(si.odId);
        return {
          odId: si.odId,
          username: user?.username ?? 'Unknown',
          displayName: user?.displayName ?? null,
          avatarUrl: user?.avatarUrl ?? null,
          provider: user?.provider ?? 'unknown',
          isBot: si.isBot,
          balance: user?.bankroll?.balance ?? 0,
          tableId: si.tableId,
          tableBlinds: si.tableBlinds,
          seatNumber: si.seatNumber,
          chips: si.chips,
          connectedAt: si.connectedAt,
        };
      });

      return {
        total: players.length,
        bots: players.filter(p => p.isBot).length,
        humans: players.filter(p => !p.isBot).length,
        seated: players.filter(p => p.tableId !== null).length,
        players,
      };
    });

    // Users API
    fastify.get('/api/admin/users', async (request) => {
      const query = request.query as Record<string, string>;
      const page = Math.max(1, parseInt(query.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50', 10)));
      const search = query.search || '';
      const sort = query.sort || 'createdAt';
      const order = query.order === 'asc' ? 'asc' as const : 'desc' as const;
      const filter = query.filter || 'all'; // 'all' | 'human' | 'bot'

      const conditions: any[] = [];
      if (search) {
        conditions.push({
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { displayName: { contains: search, mode: 'insensitive' as const } },
          ],
        });
      }
      if (filter === 'bot') {
        conditions.push({ provider: 'bot' });
      } else if (filter === 'human') {
        conditions.push({ provider: { not: 'bot' } });
      }

      const where = conditions.length > 0 ? { AND: conditions } : {};

      const orderBy = sort === 'balance'
        ? { bankroll: { balance: order } }
        : sort === 'handsPlayed'
          ? { handHistories: { _count: order } }
          : { [sort]: order };

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          include: {
            bankroll: true,
            _count: { select: { handHistories: true } },
          },
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.user.count({ where }),
      ]);

      return {
        users: users.map(u => ({
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          twitterAvatarUrl: u.twitterAvatarUrl,
          provider: u.provider,
          balance: u.bankroll?.balance ?? 0,
          handsPlayed: u._count.handHistories,
          nameMasked: u.nameMasked,
          useTwitterAvatar: u.useTwitterAvatar,
          createdAt: u.createdAt.toISOString(),
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });

    // HTML Dashboard
    fastify.get('/admin/status', async (request, reply) => {
      return reply.view('dashboard.ejs', {});
    });

    // Users HTML page
    fastify.get('/admin/users', async (request, reply) => {
      return reply.view('users.ejs', {});
    });

    // Connected players HTML page
    fastify.get('/admin/players', async (request, reply) => {
      return reply.view('players.ejs', {});
    });

    // Hand history API
    fastify.get('/api/admin/hands', async (request) => {
      const query = request.query as Record<string, string>;
      const page = Math.max(1, parseInt(query.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50', 10)));
      const search = query.search || '';
      const blinds = query.blinds || '';
      const sort = query.sort || 'createdAt';
      const order = query.order === 'asc' ? 'asc' as const : 'desc' as const;

      const conditions: any[] = [];
      if (search) {
        conditions.push({
          OR: [
            { id: { contains: search, mode: 'insensitive' as const } },
            { players: { some: { username: { contains: search, mode: 'insensitive' as const } } } },
          ],
        });
      }
      if (blinds) {
        conditions.push({ blinds });
      }

      const where = conditions.length > 0 ? { AND: conditions } : {};

      const [hands, total] = await Promise.all([
        prisma.handHistory.findMany({
          where,
          include: { players: { orderBy: { seatPosition: 'asc' } } },
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.handHistory.count({ where }),
      ]);

      return {
        hands: hands.map(h => ({
          id: h.id,
          tableId: h.tableId,
          handNumber: h.handNumber,
          blinds: h.blinds,
          communityCards: h.communityCards,
          potSize: h.potSize,
          rakeAmount: h.rakeAmount,
          winners: h.winners,
          actions: h.actions,
          dealerPosition: h.dealerPosition,
          createdAt: h.createdAt.toISOString(),
          players: h.players.map(p => ({
            username: p.username,
            seatPosition: p.seatPosition,
            holeCards: p.holeCards,
            finalHand: p.finalHand,
            profit: p.profit,
            userId: p.userId,
          })),
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });

    // Hand history detail API
    fastify.get('/api/admin/hands/:handId', async (request, reply) => {
      const { handId } = request.params as { handId: string };
      const hand = await prisma.handHistory.findUnique({
        where: { id: handId },
        include: { players: { orderBy: { seatPosition: 'asc' } } },
      });
      if (!hand) {
        return reply.status(404).send({ error: 'Hand not found' });
      }
      return {
        id: hand.id,
        tableId: hand.tableId,
        handNumber: hand.handNumber,
        blinds: hand.blinds,
        communityCards: hand.communityCards,
        potSize: hand.potSize,
        rakeAmount: hand.rakeAmount,
        winners: hand.winners,
        actions: hand.actions,
        dealerPosition: hand.dealerPosition,
        createdAt: hand.createdAt.toISOString(),
        players: hand.players.map(p => ({
          username: p.username,
          seatPosition: p.seatPosition,
          holeCards: p.holeCards,
          finalHand: p.finalHand,
          profit: p.profit,
          userId: p.userId,
        })),
      };
    });

    // Hand history HTML page
    fastify.get('/admin/hands', async (request, reply) => {
      return reply.view('hands.ejs', {});
    });

    fastify.get('/admin/tournaments', async (request, reply) => {
      return reply.view('tournaments.ejs', { defaults: tournamentDefaults });
    });

    // ============================================
    // Admin Operations API
    // ============================================

    // プレイヤーをキャッシュゲームテーブルからキック（離席＋キャッシュアウト）
    fastify.post('/api/admin/kick', async (request) => {
      const { odId } = request.body as { odId: string };
      if (!odId) return { success: false, error: 'odId is required' };

      const table = tableManager.getPlayerTable(odId);
      if (!table) return { success: false, error: 'Player not found at any table' };

      const result = table.unseatPlayer(odId);
      tableManager.removePlayerFromTracking(odId);
      if (result) {
        await cashOutPlayer(result.odId, result.chips, table.id);
      }

      // ソケットにも通知
      for (const s of io.sockets.sockets.values()) {
        if ((s as any).odId === odId) {
          s.emit('table:left');
          break;
        }
      }

      console.log(`[Admin] Kicked player ${odId} from table ${table.id} (chips: ${result?.chips ?? 0})`);
      return { success: true, tableId: table.id, chips: result?.chips ?? 0 };
    });

    // トーナメントテーブルからプレイヤーをキック（チップ没収＝即バスト扱い）
    fastify.post('/api/admin/tournament/kick', async (request) => {
      const { odId, tournamentId: reqTournamentId } = request.body as { odId: string; tournamentId?: string };
      if (!odId) return { success: false, error: 'odId is required' };

      // トーナメントを特定
      const tid = reqTournamentId ?? tournamentManager.getPlayerTournament(odId);
      if (!tid) return { success: false, error: 'Player not found in any tournament' };

      const tournament = tournamentManager.getTournament(tid);
      if (!tournament) return { success: false, error: 'Tournament not found' };

      const player = tournament.getPlayer(odId);
      if (!player) return { success: false, error: 'Player not in tournament' };

      // テーブルから離席
      if (player.tableId) {
        const table = Array.from(tournament.getTables()).find(t => t.id === player.tableId);
        if (table) {
          table.unseatPlayer(odId);
        }
      }

      // ソケットに通知
      for (const s of io.sockets.sockets.values()) {
        if ((s as any).odId === odId) {
          s.emit('tournament:kicked', { tournamentId: tid, reason: '管理者によるキック' });
          break;
        }
      }

      console.log(`[Admin] Kicked player ${odId} from tournament ${tid}`);
      return { success: true, tournamentId: tid };
    });

    // テーブルの手番プレイヤーを強制フォールド
    fastify.post('/api/admin/force-action', async (request) => {
      const { tableId, tournamentId: reqTournamentId } = request.body as { tableId: string; tournamentId?: string };
      if (!tableId) return { success: false, error: 'tableId is required' };

      // キャッシュゲームテーブルを先に探し、なければトーナメントテーブルを探す
      let table = tableManager.getTable(tableId);
      if (!table && reqTournamentId) {
        const tournament = tournamentManager.getTournament(reqTournamentId);
        const tables = tournament ? Array.from(tournament.getTables()) : [];
        table = tables.find(t => t.id === tableId);
      }
      // トーナメントIDなしでも全トーナメントから探す
      if (!table) {
        for (const lobby of tournamentManager.getActiveTournaments()) {
          const tournament = tournamentManager.getTournament(lobby.id);
          if (!tournament) continue;
          table = Array.from(tournament.getTables()).find(t => t.id === tableId);
          if (table) break;
        }
      }
      if (!table) return { success: false, error: 'Table not found' };

      const state = table.getClientGameState();
      if (!state.isHandInProgress || state.currentPlayerSeat === null) {
        return { success: false, error: 'No active hand or no current player' };
      }

      const seats = table.getAdminSeats();
      const currentSeat = seats[state.currentPlayerSeat];
      if (!currentSeat) return { success: false, error: 'Current seat is empty' };

      const handled = table.handleAction(currentSeat.odId, 'fold', 0);
      console.log(`[Admin] Forced fold on table ${tableId}: seat=${state.currentPlayerSeat}, odId=${currentSeat.odId}, handled=${handled}`);
      return { success: handled, tableId, seat: state.currentPlayerSeat, odId: currentSeat.odId };
    });
  };
}

