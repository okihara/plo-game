import { TournamentBotManager } from './TournamentBotManager.js';

// --- 設定 ---
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const BOT_COUNT = parseInt(process.env.BOT_COUNT || '9', 10);
const NO_DELAY = process.env.NO_DELAY === 'true';
const TOURNAMENT_NAME = process.env.TOURNAMENT_NAME || 'Bot Tournament';
const BUY_IN = parseInt(process.env.BUY_IN || '100', 10);
const STARTING_CHIPS = parseInt(process.env.STARTING_CHIPS || '1500', 10);
const BLIND_DURATION = parseFloat(process.env.BLIND_DURATION || '0.75'); // 分（デフォルト45秒）

// テスト用高速ブラインドスケジュール（50/100 スタート）
const FAST_BLIND_SCHEDULE = [
  { level: 1,  smallBlind: 50,   bigBlind: 100,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 2,  smallBlind: 75,   bigBlind: 150,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 3,  smallBlind: 100,  bigBlind: 200,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 4,  smallBlind: 150,  bigBlind: 300,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 5,  smallBlind: 200,  bigBlind: 400,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 6,  smallBlind: 300,  bigBlind: 600,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 7,  smallBlind: 400,  bigBlind: 800,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 8,  smallBlind: 500,  bigBlind: 1000, ante: 0, durationMinutes: BLIND_DURATION },
  { level: 9,  smallBlind: 750,  bigBlind: 1500, ante: 0, durationMinutes: BLIND_DURATION },
  { level: 10, smallBlind: 1000, bigBlind: 2000, ante: 0, durationMinutes: BLIND_DURATION },
];

async function main(): Promise<void> {
  console.log('=================================');
  console.log('  Tournament Bot Runner');
  console.log('=================================');
  console.log(`Server:      ${SERVER_URL}`);
  console.log(`Bots:        ${BOT_COUNT}`);
  console.log(`Buy-in:      ${BUY_IN}`);
  console.log(`Chips:       ${STARTING_CHIPS}`);
  console.log(`Blind dur:   ${BLIND_DURATION}min`);
  console.log(`No delay:    ${NO_DELAY}`);
  console.log('=================================');

  // 1. トーナメント作成
  console.log('\n[Step 1] Creating tournament...');
  const createRes = await fetch(`${SERVER_URL}/api/tournaments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: TOURNAMENT_NAME,
      buyIn: BUY_IN,
      startingChips: STARTING_CHIPS,
      minPlayers: 2,
      maxPlayers: Math.max(BOT_COUNT + 2, 18),
      blindSchedule: FAST_BLIND_SCHEDULE,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create tournament: ${err}`);
  }

  const { tournamentId } = await createRes.json() as { tournamentId: string };
  console.log(`Tournament created: ${tournamentId}`);

  // 2. ボット接続＆登録
  console.log(`\n[Step 2] Connecting ${BOT_COUNT} bots...`);
  const manager = new TournamentBotManager({
    serverUrl: SERVER_URL,
    botCount: BOT_COUNT,
    tournamentId,
    noDelay: NO_DELAY,
  });

  await manager.connectAndRegister();

  // 登録完了を少し待ってからスタート
  await sleep(1000);

  // 3. トーナメント開始
  console.log('\n[Step 3] Starting tournament...');
  const startRes = await fetch(`${SERVER_URL}/api/tournaments/${tournamentId}/start`, {
    method: 'POST',
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    console.error(`Failed to start: ${err}`);
    await manager.disconnectAll();
    process.exit(1);
  }

  console.log('Tournament started! Waiting for completion...\n');

  // 4. 完了を待つ
  const startTime = Date.now();
  await manager.waitForCompletion();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\nTournament completed in ${elapsed}s`);

  // 5. クリーンアップ
  await manager.disconnectAll();
  console.log('Done!');
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
let isShuttingDown = false;
process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\nInterrupted, cleaning up...');
  process.exit(1);
});

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
