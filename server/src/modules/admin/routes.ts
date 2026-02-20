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
      reply.type('text/html');
      return getDashboardHTML(env.CLIENT_URL);
    });

    // Users HTML page
    fastify.get('/admin/users', async (request, reply) => {
      reply.type('text/html');
      return getUsersPageHTML();
    });
  };
}

function getDashboardHTML(clientUrl: string): string {
  // 開発環境ではCLIENT_URL（Vite dev server）を使う、本番では相対パス
  const spectateBaseUrl = clientUrl || '';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PLO Server Status</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 {
      font-size: 24px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #22c55e;
      animation: pulse 2s infinite;
    }
    .status-dot.error { background: #ef4444; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 20px;
      border: 1px solid #334155;
    }
    .card h2 {
      font-size: 14px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .stat {
      font-size: 32px;
      font-weight: 700;
      color: #f8fafc;
    }
    .stat-small {
      font-size: 14px;
      color: #64748b;
      margin-top: 4px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #334155;
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: #94a3b8; }
    .stat-value { font-weight: 600; }
    .stat-value.success { color: #22c55e; }
    .stat-value.error { color: #ef4444; }
    .stat-value.warning { color: #f59e0b; }
    .tables-section { margin-top: 24px; }
    .table-card {
      background: #1e293b;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      border: 1px solid #334155;
    }
    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .table-title {
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 9999px;
      font-weight: 500;
    }
    .badge-ff { background: #7c3aed; color: white; }
    .badge-active { background: #22c55e; color: white; }
    .badge-waiting { background: #64748b; color: white; }
    .players-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 8px;
    }
    .player-slot {
      background: #0f172a;
      border-radius: 8px;
      padding: 8px;
      text-align: center;
      font-size: 12px;
      min-height: 80px;
    }
    .player-slot.occupied { background: #334155; }
    .player-slot.human { border: 2px solid #3b82f6; }
    .player-slot.cpu { border: 2px solid #64748b; }
    .player-slot.folded { opacity: 0.5; }
    .player-name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .player-chips { color: #fbbf24; font-size: 11px; }
    .player-status { font-size: 10px; color: #64748b; }
    .player-details { font-size: 10px; color: #94a3b8; margin-top: 2px; line-height: 1.4; }
    .player-details span { margin-right: 4px; }
    .player-position { color: #60a5fa; font-weight: 600; }
    .player-bet { color: #f97316; }
    .player-flag { color: #a78bfa; }
    .player-sitting-out { color: #ef4444; }
    .table-footer {
      display: flex;
      gap: 12px;
      margin-top: 12px;
    }
    .pending-action {
      background: #422006;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 12px;
      flex: 0 0 200px;
      min-height: 60px;
    }
    .pending-action:empty {
      border-color: #334155;
      background: #1e293b;
    }
    .pending-action-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .pending-action-title {
      color: #fbbf24;
      font-weight: 600;
      font-size: 13px;
    }
    .pending-action-timer {
      color: #f59e0b;
      font-size: 12px;
    }
    .pending-action-player {
      font-size: 14px;
      margin-bottom: 4px;
    }
    .pending-action-options {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .action-option {
      background: #334155;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    .message-log {
      background: #0f172a;
      border-radius: 8px;
      padding: 12px;
      flex: 1;
      max-height: 200px;
      overflow-y: auto;
    }
    .message-log-title {
      color: #94a3b8;
      font-size: 12px;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .message-item {
      font-size: 11px;
      padding: 4px 0;
      border-bottom: 1px solid #1e293b;
      display: flex;
      gap: 8px;
    }
    .message-item:last-child { border-bottom: none; }
    .message-time { color: #64748b; min-width: 70px; }
    .message-event { color: #60a5fa; min-width: 140px; }
    .message-target { color: #a78bfa; min-width: 80px; }
    .message-data { color: #94a3b8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queue-bar {
      height: 8px;
      background: #334155;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 8px;
    }
    .queue-fill {
      height: 100%;
      background: linear-gradient(90deg, #7c3aed, #a855f7);
      transition: width 0.3s;
    }
    .refresh-info {
      text-align: center;
      color: #64748b;
      font-size: 12px;
      margin-top: 16px;
    }
    .memory-bar {
      height: 20px;
      background: #334155;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 8px;
    }
    .memory-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
      transition: width 0.3s;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>
      <div class="status-dot" id="statusDot"></div>
      PLO Server Status
      <span style="font-size: 14px; color: #64748b; margin-left: auto;" id="lastUpdate"></span>
    </h1>

    <div class="grid">
      <div class="card">
        <h2>接続状況</h2>
        <div class="stat" id="totalConnections">-</div>
        <div class="stat-small" id="connectionBreakdown">-</div>
      </div>

      <div class="card">
        <h2>テーブル</h2>
        <div class="stat" id="totalTables">-</div>
        <div class="stat-small" id="tableBreakdown">-</div>
      </div>

      <div class="card">
        <h2>アクティブハンド</h2>
        <div class="stat" id="activeHands">-</div>
        <div class="stat-small">進行中のゲーム</div>
      </div>

      <div class="card">
        <h2>稼働時間</h2>
        <div class="stat" id="uptime">-</div>
        <div class="stat-small" id="startTime">-</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>サービス状態</h2>
        <div class="stat-row">
          <span class="stat-label">PostgreSQL</span>
          <span class="stat-value" id="dbStatus">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">登録ユーザー数</span>
          <span class="stat-value" id="userCount">-</span>
        </div>
      </div>

      <div class="card">
        <h2>メモリ使用量</h2>
        <div class="memory-bar">
          <div class="memory-fill" id="memoryBar">-</div>
        </div>
        <div class="stat-row" style="margin-top: 12px;">
          <span class="stat-label">Heap Used</span>
          <span class="stat-value" id="heapUsed">-</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">RSS</span>
          <span class="stat-value" id="rss">-</span>
        </div>
      </div>

      <div class="card">
        <h2>メンテナンスモード</h2>
        <div id="maintenanceStatus" style="margin-bottom:12px"></div>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="maintenanceOn" onclick="toggleMaintenance(true)"
            style="padding:8px 16px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600">
            ON (停止)
          </button>
          <button id="maintenanceOff" onclick="toggleMaintenance(false)"
            style="padding:8px 16px;background:#22c55e;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600">
            OFF (再開)
          </button>
        </div>
        <input id="maintenanceMessage" placeholder="メンテナンスメッセージ（任意）"
          style="margin-top:12px;width:100%;padding:8px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;box-sizing:border-box" />
      </div>
    </div>

    <div class="tables-section">
      <h2 style="margin-bottom: 16px; font-size: 18px;">テーブル詳細</h2>
      <div id="tablesList"></div>
    </div>

    <div class="refresh-info">
      自動更新: 2秒ごと
    </div>
  </div>

  <script>
    var SPECTATE_BASE_URL = '${spectateBaseUrl}';
    var ADMIN_SECRET = new URLSearchParams(window.location.search).get('secret') || '';
    function apiUrl(path) {
      return path + (ADMIN_SECRET ? '?secret=' + encodeURIComponent(ADMIN_SECRET) : '');
    }
    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatUptime(seconds) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      if (hours > 0) return hours + '時間 ' + minutes + '分';
      if (minutes > 0) return minutes + '分 ' + secs + '秒';
      return secs + '秒';
    }

    function formatChips(chips) {
      return '$' + chips.toLocaleString();
    }

    async function fetchStats() {
      try {
        const res = await fetch(apiUrl('/api/admin/stats'));
        const data = await res.json();
        updateUI(data);
        document.getElementById('statusDot').classList.remove('error');
      } catch (err) {
        console.error('Failed to fetch stats:', err);
        document.getElementById('statusDot').classList.add('error');
      }
    }

    function updateUI(data) {
      // Last update
      document.getElementById('lastUpdate').textContent =
        '最終更新: ' + new Date(data.timestamp).toLocaleTimeString('ja-JP');

      // Connections
      document.getElementById('totalConnections').textContent = data.connections.total;
      document.getElementById('connectionBreakdown').textContent =
        '認証済み: ' + data.connections.authenticated;

      // Tables
      document.getElementById('totalTables').textContent = data.tables.total;
      document.getElementById('tableBreakdown').textContent =
        '通常: ' + data.tables.regular + ' / Fast Fold: ' + data.tables.fastFold;

      // Active hands
      document.getElementById('activeHands').textContent = data.tables.activeHands;

      // Uptime
      document.getElementById('uptime').textContent = formatUptime(data.uptime);

      // Services
      document.getElementById('dbStatus').textContent = data.database.connected ? '接続中' : 'エラー';
      document.getElementById('dbStatus').className =
        'stat-value ' + (data.database.connected ? 'success' : 'error');
      document.getElementById('userCount').textContent = data.database.userCount.toLocaleString();

      // Memory
      const memPercent = Math.round((data.memory.heapUsed / data.memory.heapTotal) * 100);
      document.getElementById('memoryBar').style.width = memPercent + '%';
      document.getElementById('memoryBar').textContent = memPercent + '%';
      document.getElementById('heapUsed').textContent = formatBytes(data.memory.heapUsed);
      document.getElementById('rss').textContent = formatBytes(data.memory.rss);

      // Maintenance
      var maint = data.maintenance;
      var maintEl = document.getElementById('maintenanceStatus');
      if (maint.isActive) {
        maintEl.innerHTML = '<span class="stat-value error">ON - メンテナンス中</span>' +
          (maint.message ? '<div class="stat-small">' + maint.message + '</div>' : '');
      } else {
        maintEl.innerHTML = '<span class="stat-value success">OFF - 通常運用</span>';
      }

      // Tables list
      const tablesHtml = data.tables.details.map(table => {
        const streetLabel = table.currentStreet ? {
          preflop: 'プリフロップ',
          flop: 'フロップ',
          turn: 'ターン',
          river: 'リバー',
          showdown: 'ショーダウン'
        }[table.currentStreet] || table.currentStreet : '待機中';

        const playersHtml = Array.from({length: 6}, (_, i) => {
          const player = table.players.find(p => p.seatNumber === i);
          if (!player) {
            return '<div class="player-slot"><div style="color:#475569">空席</div><div class="player-status">Seat ' + (i + 1) + '</div></div>';
          }
          const classes = ['player-slot', 'occupied'];
          if (player.folded) classes.push('folded');

          let status = player.isConnected ? '🟢' : '🔴';
          if (player.folded) status += ' Fold';
          else if (player.isAllIn) status += ' All-In';
          if (player.isSittingOut) status += ' 💤';
          if (player.waitingForNextHand) status += ' ⏸';

          // Highlight if this player has pending action
          const isPending = table.pendingAction && table.pendingAction.seatNumber === i;
          if (isPending) classes.push('pending');

          // Player detail attributes
          var detailParts = [];
          if (player.position) detailParts.push('<span class="player-position">' + player.position + '</span>');
          detailParts.push('<span>BuyIn:' + formatChips(player.buyIn) + '</span>');
          if (player.currentBet > 0) detailParts.push('<span class="player-bet">Bet:' + formatChips(player.currentBet) + '</span>');
          if (player.totalBetThisRound > 0) detailParts.push('<span class="player-bet">Rnd:' + formatChips(player.totalBetThisRound) + '</span>');
          if (player.hasActed) detailParts.push('<span class="player-flag">Acted</span>');

          return '<div class="' + classes.join(' ') + '"' + (isPending ? ' style="border-color:#f59e0b;box-shadow:0 0 8px rgba(245,158,11,0.5)"' : '') + '>' +
            '<div class="player-name">' + player.odName + '</div>' +
            '<div class="player-chips">' + formatChips(player.chips) + '</div>' +
            '<div class="player-status">' + status + (isPending ? ' ⏳' : '') + '</div>' +
            '<div class="player-details">' + detailParts.join('') + '</div>' +
            '</div>';
        }).join('');

        // Pending action section
        let pendingActionHtml = '<div class="pending-action"></div>';
        if (table.pendingAction) {
          const pa = table.pendingAction;
          const elapsed = Date.now() - pa.requestedAt;
          const remaining = Math.max(0, pa.timeoutMs - elapsed);
          const remainingSec = Math.ceil(remaining / 1000);
          const actionsHtml = pa.validActions.map(a => {
            let label = a.action;
            if (a.minAmount > 0) {
              label += ' $' + a.minAmount;
              if (a.maxAmount !== a.minAmount) label += '-$' + a.maxAmount;
            }
            return '<span class="action-option">' + label + '</span>';
          }).join('');

          pendingActionHtml = '<div class="pending-action">' +
            '<div class="pending-action-header">' +
              '<span class="pending-action-title">⏳ アクション待機中</span>' +
              '<span class="pending-action-timer">' + remainingSec + '秒</span>' +
            '</div>' +
            '<div class="pending-action-player">' + pa.playerName + ' (Seat ' + (pa.seatNumber + 1) + ')</div>' +
            '<div class="pending-action-options">' + actionsHtml + '</div>' +
          '</div>';
        }

        // Message log section
        let messageLogHtml = '<div class="message-log"><div class="message-log-title">直近のメッセージ</div></div>';
        if (table.recentMessages && table.recentMessages.length > 0) {
          const messagesHtml = table.recentMessages.slice().reverse().map(msg => {
            const time = new Date(msg.timestamp).toLocaleTimeString('ja-JP');
            const target = msg.target === 'all' ? 'broadcast' : msg.target.slice(0, 8) + '...';
            const dataStr = JSON.stringify(msg.data).slice(0, 50);
            return '<div class="message-item">' +
              '<span class="message-time">' + time + '</span>' +
              '<span class="message-event">' + msg.event + '</span>' +
              '<span class="message-target">' + target + '</span>' +
              '<span class="message-data">' + dataStr + '</span>' +
            '</div>';
          }).join('');

          messageLogHtml = '<div class="message-log">' +
            '<div class="message-log-title">直近のメッセージ</div>' +
            messagesHtml +
          '</div>';
        }

        return '<div class="table-card">' +
          '<div class="table-header">' +
            '<div class="table-title">' +
              '<span>' + table.blinds + '</span>' +
              (table.isFastFold ? '<span class="badge badge-ff">Fast Fold</span>' : '') +
              (table.isHandInProgress ? '<span class="badge badge-active">' + streetLabel + '</span>' : '<span class="badge badge-waiting">待機中</span>') +
            '</div>' +
            '<div>' +
              '<a href="' + SPECTATE_BASE_URL + '/spectate/' + table.id + '" target="_blank" style="color:#60a5fa;font-size:12px;margin-right:12px">👁 観戦</a>' +
              '<span style="color:#fbbf24;font-weight:600">Pot: ' + formatChips(table.pot) + '</span>' +
              '<span style="color:#64748b;margin-left:12px">' + table.playerCount + '/' + table.maxPlayers + '人</span>' +
            '</div>' +
          '</div>' +
          '<div class="players-grid">' + playersHtml + '</div>' +
          '<div class="table-footer">' + pendingActionHtml + messageLogHtml + '</div>' +
        '</div>';
      }).join('');

      document.getElementById('tablesList').innerHTML = tablesHtml || '<p style="color:#64748b">テーブルなし</p>';
    }

    async function toggleMaintenance(active) {
      var message = document.getElementById('maintenanceMessage').value;
      try {
        await fetch(apiUrl('/api/admin/maintenance'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: active, message: message }),
        });
        fetchStats();
      } catch (err) {
        alert('Failed: ' + err.message);
      }
    }

    // Initial fetch and start polling
    fetchStats();
    setInterval(fetchStats, 2000);
  </script>
</body>
</html>`;
}

function getUsersPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PLO Users</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 {
      font-size: 24px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .nav {
      margin-bottom: 20px;
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .nav a {
      color: #60a5fa;
      text-decoration: none;
      font-size: 14px;
    }
    .nav a:hover { text-decoration: underline; }
    .toolbar {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      align-items: center;
      flex-wrap: wrap;
    }
    .search-input {
      padding: 8px 12px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 14px;
      width: 280px;
    }
    .search-input::placeholder { color: #64748b; }
    .summary {
      font-size: 14px;
      color: #94a3b8;
      margin-left: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #1e293b;
      border-radius: 12px;
      overflow: hidden;
    }
    thead th {
      padding: 12px 16px;
      text-align: left;
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #334155;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    thead th:hover { color: #e2e8f0; }
    thead th.sorted { color: #60a5fa; }
    thead th .arrow { margin-left: 4px; font-size: 10px; }
    tbody tr {
      border-bottom: 1px solid #1e293b;
      transition: background 0.15s;
    }
    tbody tr:hover { background: #334155; }
    tbody td {
      padding: 10px 16px;
      font-size: 13px;
      white-space: nowrap;
    }
    .avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      vertical-align: middle;
      margin-right: 8px;
    }
    .username { font-weight: 600; }
    .provider-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 9999px;
      font-weight: 500;
      background: #334155;
      color: #94a3b8;
    }
    .provider-badge.twitter { background: #1d4ed8; color: white; }
    .chips { color: #fbbf24; font-weight: 600; }
    .hands { color: #a78bfa; }
    .date { color: #64748b; }
    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
    }
    .pagination button {
      padding: 6px 14px;
      background: #334155;
      border: none;
      border-radius: 6px;
      color: #e2e8f0;
      cursor: pointer;
      font-size: 13px;
    }
    .pagination button:hover:not(:disabled) { background: #475569; }
    .pagination button:disabled { opacity: 0.3; cursor: default; }
    .pagination .page-info { font-size: 13px; color: #94a3b8; }
    .loading {
      text-align: center;
      padding: 40px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="nav">
      <a href="status" id="backLink">&larr; ダッシュボードに戻る</a>
    </div>
    <h1>ユーザー一覧</h1>

    <div class="toolbar">
      <input type="text" class="search-input" id="searchInput" placeholder="ユーザー名 / メールで検索...">
      <div class="summary" id="summary"></div>
    </div>

    <table>
      <thead>
        <tr>
          <th data-sort="username">ユーザー名 <span class="arrow"></span></th>
          <th data-sort="email">メール <span class="arrow"></span></th>
          <th data-sort="provider">認証 <span class="arrow"></span></th>
          <th data-sort="balance">チップ <span class="arrow"></span></th>
          <th>ハンド数</th>
          <th data-sort="lastLoginAt">最終ログイン <span class="arrow"></span></th>
          <th data-sort="createdAt">登録日 <span class="arrow"></span></th>
        </tr>
      </thead>
      <tbody id="usersBody">
        <tr><td colspan="7" class="loading">読み込み中...</td></tr>
      </tbody>
    </table>

    <div class="pagination" id="pagination"></div>
  </div>

  <script>
    var ADMIN_SECRET = new URLSearchParams(window.location.search).get('secret') || '';
    var currentPage = 1;
    var currentSort = 'createdAt';
    var currentOrder = 'desc';
    var searchTimeout = null;

    // Preserve secret in nav link
    if (ADMIN_SECRET) {
      document.getElementById('backLink').href = 'status?secret=' + encodeURIComponent(ADMIN_SECRET);
    }

    function apiUrl(path) {
      return path + (ADMIN_SECRET ? '&secret=' + encodeURIComponent(ADMIN_SECRET) : '');
    }

    function formatDate(iso) {
      if (!iso) return '-';
      var d = new Date(iso);
      return d.toLocaleDateString('ja-JP') + ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }

    function formatChips(n) {
      return '$' + n.toLocaleString();
    }

    async function fetchUsers() {
      var search = document.getElementById('searchInput').value;
      var url = '/api/admin/users?page=' + currentPage +
        '&sort=' + currentSort +
        '&order=' + currentOrder +
        (search ? '&search=' + encodeURIComponent(search) : '');
      try {
        var res = await fetch(apiUrl(url));
        var data = await res.json();
        renderUsers(data);
      } catch (err) {
        document.getElementById('usersBody').innerHTML =
          '<tr><td colspan="7" class="loading" style="color:#ef4444">読み込みエラー</td></tr>';
      }
    }

    function renderUsers(data) {
      document.getElementById('summary').textContent =
        data.total + '人中 ' + ((data.page - 1) * data.limit + 1) + '-' +
        Math.min(data.page * data.limit, data.total) + '人表示';

      var html = data.users.map(function(u) {
        var avatarHtml = u.avatarUrl
          ? '<img class="avatar" src="' + u.avatarUrl + '" alt="">'
          : '';
        var providerClass = u.provider === 'twitter' ? ' twitter' : '';
        return '<tr>' +
          '<td>' + avatarHtml + '<span class="username">' + escapeHtml(u.username) + '</span></td>' +
          '<td>' + escapeHtml(u.email) + '</td>' +
          '<td><span class="provider-badge' + providerClass + '">' + u.provider + '</span></td>' +
          '<td class="chips">' + formatChips(u.balance) + '</td>' +
          '<td class="hands">' + u.handsPlayed.toLocaleString() + '</td>' +
          '<td class="date">' + formatDate(u.lastLoginAt) + '</td>' +
          '<td class="date">' + formatDate(u.createdAt) + '</td>' +
        '</tr>';
      }).join('');

      if (data.users.length === 0) {
        html = '<tr><td colspan="7" class="loading">該当ユーザーなし</td></tr>';
      }

      document.getElementById('usersBody').innerHTML = html;

      // Pagination
      var pagHtml = '<button ' + (data.page <= 1 ? 'disabled' : '') + ' onclick="goPage(' + (data.page - 1) + ')">前へ</button>' +
        '<span class="page-info">' + data.page + ' / ' + data.totalPages + '</span>' +
        '<button ' + (data.page >= data.totalPages ? 'disabled' : '') + ' onclick="goPage(' + (data.page + 1) + ')">次へ</button>';
      document.getElementById('pagination').innerHTML = pagHtml;

      // Update sort headers
      document.querySelectorAll('thead th[data-sort]').forEach(function(th) {
        var s = th.getAttribute('data-sort');
        th.classList.toggle('sorted', s === currentSort);
        th.querySelector('.arrow').textContent = s === currentSort ? (currentOrder === 'asc' ? '▲' : '▼') : '';
      });
    }

    function escapeHtml(str) {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function goPage(p) {
      currentPage = p;
      fetchUsers();
    }

    // Sort click
    document.querySelectorAll('thead th[data-sort]').forEach(function(th) {
      th.addEventListener('click', function() {
        var s = th.getAttribute('data-sort');
        if (currentSort === s) {
          currentOrder = currentOrder === 'desc' ? 'asc' : 'desc';
        } else {
          currentSort = s;
          currentOrder = 'desc';
        }
        currentPage = 1;
        fetchUsers();
      });
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(function() {
        currentPage = 1;
        fetchUsers();
      }, 300);
    });

    fetchUsers();
  </script>
</body>
</html>`;
}
