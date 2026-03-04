import { BotManager } from './BotManager.js';

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const BOT_COUNT = parseInt(process.env.BOT_COUNT || '20', 10);
const BLINDS = process.env.BLINDS || '1/3';
const VARIANT = process.env.VARIANT || '';
const IS_FAST_FOLD = process.env.FAST_FOLD === 'true';
const MID_HAND_DISCONNECT_CHANCE = parseFloat(process.env.MID_HAND_DISCONNECT_CHANCE || '0');
const MAX_HANDS_PER_SESSION = parseInt(process.env.BOT_MAX_HANDS_PER_SESSION || '80', 10);
const INVITE_CODE = process.env.INVITE_CODE || '';

console.log('=================================');
console.log('  Poker Bot Manager');
console.log('=================================');
console.log(`Server URL: ${SERVER_URL}`);
console.log(`Bot Count: ${BOT_COUNT}`);
console.log(`Blinds: ${BLINDS}`);
if (VARIANT) {
  console.log(`Variant: ${VARIANT}`);
}
console.log(`Fast Fold: ${IS_FAST_FOLD}`);
console.log(`Session limit: ${MAX_HANDS_PER_SESSION} hands`);
if (INVITE_CODE) {
  console.log(`Private table: ${INVITE_CODE}`);
}
if (MID_HAND_DISCONNECT_CHANCE > 0) {
  console.log(`Mid-hand disconnect: ${(MID_HAND_DISCONNECT_CHANCE * 100).toFixed(0)}%`);
}
console.log('=================================');

const botManager = new BotManager({
  serverUrl: SERVER_URL,
  botCount: BOT_COUNT,
  blinds: BLINDS,
  variant: VARIANT || undefined,
  isFastFold: IS_FAST_FOLD,
  midHandDisconnectChance: MID_HAND_DISCONNECT_CHANCE,
  maxHandsPerSession: MAX_HANDS_PER_SESSION,
  inviteCode: INVITE_CODE || undefined,
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
