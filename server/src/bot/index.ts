import http from 'node:http';
import { BotManager } from './BotManager.js';
import { getDashboardHTML } from './dashboard.js';

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const BOT_COUNT = parseInt(process.env.BOT_COUNT || '10', 10);
const BLINDS = process.env.BLINDS || '1/3';
const DASHBOARD_PORT = parseInt(process.env.BOT_DASHBOARD_PORT || '3002', 10);

console.log('=================================');
console.log('  PLO Poker Bot Manager');
console.log('=================================');
console.log(`Server URL: ${SERVER_URL}`);
console.log(`Bot Count: ${BOT_COUNT}`);
console.log(`Blinds: ${BLINDS}`);
console.log('=================================');

const botManager = new BotManager({
  serverUrl: SERVER_URL,
  botCount: BOT_COUNT,
  blinds: BLINDS,
});

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down...');
  await botManager.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down...');
  await botManager.stop();
  process.exit(0);
});

// Dashboard HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(botManager.getDetailedStats()));
  } else if (req.url === '/' || req.url === '') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getDashboardHTML());
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// Start bot manager
botManager.start().then(() => {
  server.listen(DASHBOARD_PORT, () => {
    console.log(`Bot dashboard: http://localhost:${DASHBOARD_PORT}`);
  });

  // Print stats periodically
  setInterval(() => {
    const stats = botManager.getStats();
    console.log(`[Stats] Bots: ${stats.total} total, ${stats.active} active, ${stats.inGame} in game`);
  }, 30000);
}).catch((err) => {
  console.error('Failed to start BotManager:', err);
  process.exit(1);
});
