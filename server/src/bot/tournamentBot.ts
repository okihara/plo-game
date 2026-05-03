import { TournamentBotManager } from './TournamentBotManager.js';

// --- 設定 ---
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const BOT_COUNT = parseInt(process.env.BOT_COUNT || '9', 10);
const NO_DELAY = process.env.NO_DELAY === 'true';
const TOURNAMENT_NAME = process.env.TOURNAMENT_NAME || 'BabyPLO Daily Turbo';
const BUY_IN = parseInt(process.env.BUY_IN || '100', 10);
// チップは内部 1/100 単位 (chipUnit=100、UI が ×100 で表示)
const STARTING_CHIPS = parseInt(process.env.STARTING_CHIPS || '300', 10);
const BLIND_DURATION = parseFloat(process.env.BLIND_DURATION || '0.15'); // 15秒
const TOURNAMENT_ID = process.env.TOURNAMENT_ID || ''; // 既存トーナメントに参加する場合
const JOIN_ACTIVE = process.env.JOIN_ACTIVE === 'true'; // 進行中のトーナメントを自動検索して参加
const CHAOS_MODE = process.env.CHAOS_MODE === 'true'; // ランダム切断→再接続で不具合を再現する

// テスト用高速ブラインドスケジュール（1/2 スタート、内部 1/100 単位）
// 表示は ×100 (UI 側で乗算)。1/100 で整数化できないステップ (旧 50/75/750/...) は除外。
const FAST_BLIND_SCHEDULE = [
  { level: 1,  smallBlind: 1,     bigBlind: 2,     ante: 0, durationMinutes: BLIND_DURATION },
  { level: 2,  smallBlind: 2,     bigBlind: 4,     ante: 0, durationMinutes: BLIND_DURATION },
  { level: 3,  smallBlind: 3,     bigBlind: 6,     ante: 0, durationMinutes: BLIND_DURATION },
  { level: 4,  smallBlind: 4,     bigBlind: 8,     ante: 0, durationMinutes: BLIND_DURATION },
  { level: 5,  smallBlind: 5,     bigBlind: 10,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 6,  smallBlind: 6,     bigBlind: 12,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 7,  smallBlind: 8,     bigBlind: 16,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 8,  smallBlind: 10,    bigBlind: 20,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 9,  smallBlind: 12,    bigBlind: 24,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 10, smallBlind: 15,    bigBlind: 30,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 11, smallBlind: 20,    bigBlind: 40,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 12, smallBlind: 25,    bigBlind: 50,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 13, smallBlind: 30,    bigBlind: 60,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 14, smallBlind: 40,    bigBlind: 80,    ante: 0, durationMinutes: BLIND_DURATION },
  { level: 15, smallBlind: 50,    bigBlind: 100,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 16, smallBlind: 60,    bigBlind: 120,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 17, smallBlind: 80,    bigBlind: 160,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 18, smallBlind: 100,   bigBlind: 200,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 19, smallBlind: 120,   bigBlind: 240,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 20, smallBlind: 150,   bigBlind: 300,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 21, smallBlind: 200,   bigBlind: 400,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 22, smallBlind: 250,   bigBlind: 500,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 23, smallBlind: 300,   bigBlind: 600,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 24, smallBlind: 400,   bigBlind: 800,   ante: 0, durationMinutes: BLIND_DURATION },
  { level: 25, smallBlind: 500,   bigBlind: 1000,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 26, smallBlind: 600,   bigBlind: 1200,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 27, smallBlind: 800,   bigBlind: 1600,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 28, smallBlind: 1000,  bigBlind: 2000,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 29, smallBlind: 1200,  bigBlind: 2400,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 30, smallBlind: 1500,  bigBlind: 3000,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 31, smallBlind: 2000,  bigBlind: 4000,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 32, smallBlind: 3000,  bigBlind: 6000,  ante: 0, durationMinutes: BLIND_DURATION },
  { level: 33, smallBlind: 5000,  bigBlind: 10000, ante: 0, durationMinutes: BLIND_DURATION },
  { level: 34, smallBlind: 8000,  bigBlind: 16000, ante: 0, durationMinutes: BLIND_DURATION },
  { level: 35, smallBlind: 12000, bigBlind: 24000, ante: 0, durationMinutes: BLIND_DURATION },
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
  console.log(`Chaos mode:  ${CHAOS_MODE}`);
  if (TOURNAMENT_ID) console.log(`Join ID:     ${TOURNAMENT_ID}`);
  console.log('=================================');

  let tournamentId: string;

  if (TOURNAMENT_ID) {
    // 指定IDのトーナメントに参加
    tournamentId = TOURNAMENT_ID;
    console.log(`\n[Step 1] Joining existing tournament: ${tournamentId}`);
  } else if (JOIN_ACTIVE) {
    // 進行中 or 開始待ちのトーナメントを検索
    console.log('\n[Step 1] Finding active tournament...');
    const listRes = await fetch(`${SERVER_URL}/api/tournaments`);
    if (!listRes.ok) throw new Error('Failed to fetch tournament list');
    const { tournaments } = await listRes.json() as { tournaments: { id: string; name: string; status: string }[] };
    const target = tournaments.find(t => t.status === 'running' || t.status === 'waiting');
    if (!target) {
      console.error('No active tournament found');
      process.exit(1);
    }
    tournamentId = target.id;
    console.log(`Found: ${target.name} (${target.status}) → ${tournamentId}`);
  } else {
    // 新規トーナメント作成
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
        registrationLevels: 30,
        allowReentry: true,
        maxReentries: 3,
        reentryDeadlineLevel: 30,
        gameVariant: "plo_double_board_bomb",
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create tournament: ${err}`);
    }

    const data = await createRes.json() as { tournamentId: string };
    tournamentId = data.tournamentId;
    console.log(`Tournament created: ${tournamentId}`);

    // トーナメント開始
    console.log('\n[Step 2] Starting tournament...');
    const startRes = await fetch(`${SERVER_URL}/api/tournaments/${tournamentId}/start`, {
      method: 'POST',
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      console.error(`Failed to start: ${err}`);
      process.exit(1);
    }

    console.log('Tournament started!');
  }

  // 3. ボット接続＆参加
  console.log(`\n[Step 3] Connecting ${BOT_COUNT} bots...`);
  const manager = new TournamentBotManager({
    serverUrl: SERVER_URL,
    botCount: BOT_COUNT,
    tournamentId,
    noDelay: NO_DELAY,
    chaosMode: CHAOS_MODE,
  });

  await manager.connectAndRegister();
  console.log('All bots entered. Waiting for completion...\n');

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
