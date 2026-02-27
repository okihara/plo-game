import { BotManager } from './BotManager.js';

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const BOT_COUNT = parseInt(process.env.BOT_COUNT || '20', 10);
const BLINDS = process.env.BLINDS || '1/3';
const IS_FAST_FOLD = process.env.FAST_FOLD === 'true';
const MID_HAND_DISCONNECT_CHANCE = parseFloat(process.env.MID_HAND_DISCONNECT_CHANCE || '0');

console.log('=================================');
console.log('  PLO Poker Bot Manager');
console.log('=================================');
console.log(`Server URL: ${SERVER_URL}`);
console.log(`Bot Count: ${BOT_COUNT}`);
console.log(`Blinds: ${BLINDS}`);
console.log(`Fast Fold: ${IS_FAST_FOLD}`);
if (MID_HAND_DISCONNECT_CHANCE > 0) {
  console.log(`Mid-hand disconnect: ${(MID_HAND_DISCONNECT_CHANCE * 100).toFixed(0)}%`);
}
console.log('=================================');

const botManager = new BotManager({
  serverUrl: SERVER_URL,
  botCount: BOT_COUNT,
  blinds: BLINDS,
  isFastFold: IS_FAST_FOLD,
  midHandDisconnectChance: MID_HAND_DISCONNECT_CHANCE,
});

// Handle shutdown gracefully
let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down...`);
  await botManager.stop();
  console.log('All bots disconnected cleanly.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

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
