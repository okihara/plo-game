import { BotManager } from './BotManager.js';

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const BOT_COUNT = parseInt(process.env.BOT_COUNT || '10', 10);
const BLINDS = process.env.BLINDS || '1/3';

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

// Start bot manager
botManager.start().then(() => {
  // Print stats periodically
  setInterval(() => {
    const stats = botManager.getStats();
    console.log(`[Stats] Bots: ${stats.total} total, ${stats.active} active, ${stats.inGame} in game`);
  }, 30000);
}).catch((err) => {
  console.error('Failed to start BotManager:', err);
  process.exit(1);
});
