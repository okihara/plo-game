import { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { TableManager } from '../table/TableManager.js';
import { FastFoldPool } from '../fastfold/FastFoldPool.js';
import { redis } from '../../config/redis.js';
import { prisma } from '../../config/database.js';

interface AdminDependencies {
  io: Server;
  tableManager: TableManager;
  fastFoldPool: FastFoldPool;
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
    isHuman: boolean;
    isConnected: boolean;
    folded: boolean;
    isAllIn: boolean;
  }>;
}

interface ServerStats {
  timestamp: string;
  uptime: number;
  connections: {
    total: number;
    authenticated: number;
    guests: number;
  };
  tables: {
    total: number;
    regular: number;
    fastFold: number;
    activeHands: number;
    details: TableStats[];
  };
  fastFoldQueues: Array<{
    blinds: string;
    count: number;
    avgWaitMs: number;
  }>;
  database: {
    connected: boolean;
    userCount: number;
  };
  redis: {
    connected: boolean;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
}

const startTime = Date.now();

export function adminRoutes(deps: AdminDependencies) {
  const { io, tableManager, fastFoldPool } = deps;

  return async function (fastify: FastifyInstance) {
    // JSON API for stats
    fastify.get('/api/admin/stats', async (): Promise<ServerStats> => {
      const sockets = Array.from(io.sockets.sockets.values());
      const authenticatedCount = sockets.filter((s: any) => s.odId && !s.odId.startsWith('guest_')).length;
      const guestCount = sockets.filter((s: any) => s.odId?.startsWith('guest_')).length;

      const tablesInfo = tableManager.getTablesInfo();
      const tableDetails: TableStats[] = [];

      for (const info of tablesInfo) {
        const table = tableManager.getTable(info.id);
        if (table) {
          const gameState = table.getClientGameState();
          tableDetails.push({
            id: info.id,
            blinds: info.blinds,
            isFastFold: info.isFastFold,
            playerCount: info.players,
            maxPlayers: info.maxPlayers,
            isHandInProgress: gameState?.isHandInProgress ?? false,
            currentStreet: gameState?.currentStreet ?? null,
            pot: gameState?.pot ?? 0,
            players: gameState?.players?.filter((p): p is NonNullable<typeof p> => p !== null).map(p => ({
              odId: p.odId,
              odName: p.odName,
              seatNumber: p.seatNumber,
              chips: p.chips,
              isHuman: p.odIsHuman,
              isConnected: p.isConnected,
              folded: p.folded,
              isAllIn: p.isAllIn,
            })) ?? [],
          });
        }
      }

      const regularTables = tableDetails.filter(t => !t.isFastFold);
      const fastFoldTables = tableDetails.filter(t => t.isFastFold);
      const activeHands = tableDetails.filter(t => t.isHandInProgress).length;

      // Get fast fold queue status for common blind levels
      const blindLevels = ['1/3', '2/5', '5/10'];
      const fastFoldQueues = blindLevels.map(blinds => ({
        blinds,
        ...fastFoldPool.getQueueStatus(blinds),
      }));

      // Database check
      let dbConnected = false;
      let userCount = 0;
      try {
        userCount = await prisma.user.count();
        dbConnected = true;
      } catch {
        dbConnected = false;
      }

      // Redis check
      let redisConnected = false;
      try {
        await redis.ping();
        redisConnected = true;
      } catch {
        redisConnected = false;
      }

      const memUsage = process.memoryUsage();

      return {
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        connections: {
          total: sockets.length,
          authenticated: authenticatedCount,
          guests: guestCount,
        },
        tables: {
          total: tablesInfo.length,
          regular: regularTables.length,
          fastFold: fastFoldTables.length,
          activeHands,
          details: tableDetails,
        },
        fastFoldQueues,
        database: {
          connected: dbConnected,
          userCount,
        },
        redis: {
          connected: redisConnected,
        },
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          rss: memUsage.rss,
        },
      };
    });

    // HTML Dashboard
    fastify.get('/admin/status', async (request, reply) => {
      reply.type('text/html');
      return getDashboardHTML();
    });
  };
}

function getDashboardHTML(): string {
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
      min-height: 60px;
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
          <span class="stat-label">Redis</span>
          <span class="stat-value" id="redisStatus">-</span>
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
        <h2>Fast Fold キュー</h2>
        <div id="fastFoldQueues"></div>
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
        const res = await fetch('/api/admin/stats');
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
        '認証: ' + data.connections.authenticated + ' / ゲスト: ' + data.connections.guests;

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
      document.getElementById('redisStatus').textContent = data.redis.connected ? '接続中' : 'エラー';
      document.getElementById('redisStatus').className =
        'stat-value ' + (data.redis.connected ? 'success' : 'error');
      document.getElementById('userCount').textContent = data.database.userCount.toLocaleString();

      // Memory
      const memPercent = Math.round((data.memory.heapUsed / data.memory.heapTotal) * 100);
      document.getElementById('memoryBar').style.width = memPercent + '%';
      document.getElementById('memoryBar').textContent = memPercent + '%';
      document.getElementById('heapUsed').textContent = formatBytes(data.memory.heapUsed);
      document.getElementById('rss').textContent = formatBytes(data.memory.rss);

      // Fast Fold Queues
      const queuesHtml = data.fastFoldQueues.map(q => {
        const barWidth = Math.min(q.count * 10, 100);
        return '<div class="stat-row">' +
          '<span class="stat-label">' + q.blinds + '</span>' +
          '<span class="stat-value">' + q.count + '人待機' + '</span>' +
          '</div>' +
          '<div class="queue-bar"><div class="queue-fill" style="width:' + barWidth + '%"></div></div>';
      }).join('');
      document.getElementById('fastFoldQueues').innerHTML = queuesHtml || '<p style="color:#64748b">キューなし</p>';

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
          if (player.isHuman) classes.push('human');
          else classes.push('cpu');
          if (player.folded) classes.push('folded');

          let status = player.isHuman ? '👤' : '🤖';
          if (player.folded) status += ' Fold';
          else if (player.isAllIn) status += ' All-In';

          return '<div class="' + classes.join(' ') + '">' +
            '<div class="player-name">' + player.odName + '</div>' +
            '<div class="player-chips">' + formatChips(player.chips) + '</div>' +
            '<div class="player-status">' + status + '</div>' +
            '</div>';
        }).join('');

        return '<div class="table-card">' +
          '<div class="table-header">' +
            '<div class="table-title">' +
              '<span>' + table.blinds + '</span>' +
              (table.isFastFold ? '<span class="badge badge-ff">Fast Fold</span>' : '') +
              (table.isHandInProgress ? '<span class="badge badge-active">' + streetLabel + '</span>' : '<span class="badge badge-waiting">待機中</span>') +
            '</div>' +
            '<div>' +
              '<span style="color:#fbbf24;font-weight:600">Pot: ' + formatChips(table.pot) + '</span>' +
              '<span style="color:#64748b;margin-left:12px">' + table.playerCount + '/' + table.maxPlayers + '人</span>' +
            '</div>' +
          '</div>' +
          '<div class="players-grid">' + playersHtml + '</div>' +
        '</div>';
      }).join('');

      document.getElementById('tablesList').innerHTML = tablesHtml || '<p style="color:#64748b">テーブルなし</p>';
    }

    // Initial fetch and start polling
    fetchStats();
    setInterval(fetchStats, 2000);
  </script>
</body>
</html>`;
}
