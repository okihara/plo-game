import { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { TableManager } from '../table/TableManager.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import type { MessageLog, PendingAction } from '../table/TableInstance.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';

interface AdminDependencies {
  io: Server;
  tableManager: TableManager;
}

interface TableStats {
  id: string;
  blinds: string;
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
  maintenance: {
    isActive: boolean;
    message: string;
    activatedAt: string | null;
  };
}

const startTime = Date.now();

export function adminRoutes(deps: AdminDependencies) {
  const { io, tableManager } = deps;

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
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          rss: memUsage.rss,
        },
        maintenance: maintenanceService.getStatus(),
      };
    });

    // Maintenance mode toggle
    fastify.post('/api/admin/maintenance', async (request) => {
      const { active, message } = request.body as { active: boolean; message?: string };
      return maintenanceService.toggle(active, message || '');
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

      const where = search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {};

      const orderBy = sort === 'balance'
        ? { bankroll: { balance: order } }
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
          email: u.email,
          avatarUrl: u.avatarUrl,
          provider: u.provider,
          balance: u.bankroll?.balance ?? 0,
          handsPlayed: u._count.handHistories,
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
      const spectateBaseUrl = env.CLIENT_URL || '';
      return reply.view('dashboard.ejs', { spectateBaseUrl });
    });

    // Users HTML page
    fastify.get('/admin/users', async (request, reply) => {
      return reply.view('users.ejs', {});
    });

    // Connected players HTML page
    fastify.get('/admin/players', async (request, reply) => {
      return reply.view('players.ejs', {});
    });
  };
}

