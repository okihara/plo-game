import type { BotStatus } from './BotClient.js';

interface DashboardData {
  summary: {
    total: number;
    connected: number;
    playing: number;
    matchmaking: number;
    disconnected: number;
    targetCount: number;
  };
  bots: BotStatus[];
}

export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; }
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
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .stat {
      font-size: 36px;
      font-weight: 700;
      color: #f8fafc;
    }
    .stat.green { color: #22c55e; }
    .stat.blue { color: #3b82f6; }
    .stat.yellow { color: #f59e0b; }
    .stat.red { color: #ef4444; }
    .bot-table {
      width: 100%;
      border-collapse: collapse;
      background: #1e293b;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #334155;
    }
    .bot-table th {
      background: #334155;
      padding: 12px 16px;
      text-align: left;
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .bot-table td {
      padding: 10px 16px;
      border-bottom: 1px solid #334155;
      font-size: 14px;
    }
    .bot-table tr:last-child td { border-bottom: none; }
    .bot-table tr:hover td { background: #334155; }
    .badge {
      display: inline-block;
      font-size: 11px;
      padding: 2px 10px;
      border-radius: 9999px;
      font-weight: 600;
    }
    .badge-playing { background: #22c55e; color: #052e16; }
    .badge-matchmaking { background: #3b82f6; color: #eff6ff; }
    .badge-disconnected { background: #64748b; color: #f1f5f9; }
    .mono { font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; color: #94a3b8; }
    .refresh-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #64748b;
      font-size: 12px;
      margin-top: 16px;
    }
    .refresh-bar select {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    }
    .last-update {
      font-size: 14px;
      color: #64748b;
      margin-left: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>
      <div class="status-dot" id="statusDot"></div>
      Bot Dashboard
      <span class="last-update" id="lastUpdate"></span>
    </h1>

    <div class="grid">
      <div class="card">
        <h2>Total / Target</h2>
        <div class="stat" id="totalBots">-</div>
      </div>
      <div class="card">
        <h2>Playing</h2>
        <div class="stat green" id="playingBots">-</div>
      </div>
      <div class="card">
        <h2>Matchmaking</h2>
        <div class="stat blue" id="matchmakingBots">-</div>
      </div>
      <div class="card">
        <h2>Disconnected</h2>
        <div class="stat red" id="disconnectedBots">-</div>
      </div>
    </div>

    <table class="bot-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>State</th>
          <th>Table</th>
          <th>Seat</th>
          <th>Hands</th>
          <th>Connected</th>
          <th>Last Action</th>
        </tr>
      </thead>
      <tbody id="botList">
        <tr><td colspan="7" style="text-align:center;color:#64748b">Loading...</td></tr>
      </tbody>
    </table>

    <div class="refresh-bar">
      <span>Auto-refresh:</span>
      <select id="refreshInterval" onchange="changeInterval(this.value)">
        <option value="1000">1s</option>
        <option value="2000" selected>2s</option>
        <option value="5000">5s</option>
        <option value="10000">10s</option>
        <option value="0">Off</option>
      </select>
    </div>
  </div>

  <script>
    function formatDuration(ms) {
      if (!ms || ms <= 0) return '-';
      var sec = Math.floor(ms / 1000);
      if (sec < 60) return sec + 's';
      var min = Math.floor(sec / 60);
      sec = sec % 60;
      if (min < 60) return min + 'm ' + sec + 's';
      var hr = Math.floor(min / 60);
      min = min % 60;
      return hr + 'h ' + min + 'm';
    }

    function formatTimeAgo(ts) {
      if (!ts) return '-';
      var ago = Date.now() - ts;
      if (ago < 1000) return 'just now';
      if (ago < 60000) return Math.floor(ago / 1000) + 's ago';
      if (ago < 3600000) return Math.floor(ago / 60000) + 'm ago';
      return Math.floor(ago / 3600000) + 'h ago';
    }

    var stateLabels = {
      playing: '<span class="badge badge-playing">Playing</span>',
      matchmaking: '<span class="badge badge-matchmaking">Matchmaking</span>',
      disconnected: '<span class="badge badge-disconnected">Disconnected</span>',
    };

    async function fetchStatus() {
      try {
        var res = await fetch('/api/status');
        var data = await res.json();
        updateUI(data);
        document.getElementById('statusDot').classList.remove('error');
      } catch (err) {
        console.error('Fetch error:', err);
        document.getElementById('statusDot').classList.add('error');
      }
    }

    function updateUI(data) {
      document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('ja-JP');
      document.getElementById('totalBots').textContent = data.summary.total + ' / ' + data.summary.targetCount;
      document.getElementById('playingBots').textContent = data.summary.playing;
      document.getElementById('matchmakingBots').textContent = data.summary.matchmaking;
      document.getElementById('disconnectedBots').textContent = data.summary.disconnected;

      var now = Date.now();
      var rows = data.bots
        .sort(function(a, b) {
          var order = { playing: 0, matchmaking: 1, disconnected: 2 };
          return (order[a.state] || 9) - (order[b.state] || 9);
        })
        .map(function(bot) {
          var connDuration = bot.connectedAt ? formatDuration(now - bot.connectedAt) : '-';
          var lastAction = formatTimeAgo(bot.lastActionAt);
          var tableId = bot.tableId ? '<span class="mono">' + bot.tableId.slice(0, 8) + '</span>' : '-';
          var seat = bot.seatNumber >= 0 ? (bot.seatNumber + 1) : '-';
          return '<tr>' +
            '<td><strong>' + bot.name + '</strong></td>' +
            '<td>' + (stateLabels[bot.state] || bot.state) + '</td>' +
            '<td>' + tableId + '</td>' +
            '<td>' + seat + '</td>' +
            '<td>' + bot.handsPlayed + '</td>' +
            '<td>' + connDuration + '</td>' +
            '<td>' + lastAction + '</td>' +
          '</tr>';
        }).join('');

      document.getElementById('botList').innerHTML = rows || '<tr><td colspan="7" style="text-align:center;color:#64748b">No bots</td></tr>';
    }

    var intervalId = null;

    function changeInterval(ms) {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
      ms = parseInt(ms, 10);
      if (ms > 0) {
        intervalId = setInterval(fetchStatus, ms);
      }
    }

    fetchStatus();
    changeInterval(2000);
  </script>
</body>
</html>`;
}
