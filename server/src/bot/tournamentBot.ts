import { TournamentBotManager } from './TournamentBotManager.js';

// --- 設定 ---
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const BOT_COUNT = parseInt(process.env.BOT_COUNT || '9', 10);
const NO_DELAY = process.env.NO_DELAY === 'true';
const TOURNAMENT_NAME = process.env.TOURNAMENT_NAME || 'BabyPLO Daily Turbo';
const BUY_IN = parseInt(process.env.BUY_IN || '100', 10);
const STARTING_CHIPS = parseInt(process.env.STARTING_CHIPS || '30000', 10);
const BLIND_DURATION = parseFloat(process.env.BLIND_DURATION || '10.15'); // 15秒
const TOURNAMENT_ID = process.env.TOURNAMENT_ID || ''; // 既存トーナメントに参加する場合
const JOIN_ACTIVE = process.env.JOIN_ACTIVE === 'true'; // 進行中のトーナメントを自動検索して参加
const CHAOS_MODE = process.env.CHAOS_MODE === 'true'; // ランダム切断→再接続で不具合を再現する
const GAME_VARIANT = process.env.GAME_VARIANT || 'plo_double_board_bomb';

// テスト用高速ブラインドスケジュール（DBBP 用、ante=200 スタート）
// bot は plo_double_board_bomb トーナメントを作るため、SB/BB は投稿せず
// アンテのみ。schedule の ante フィールドに値を入れ、smallBlind/bigBlind は 0。
// 全 ante を chipUnit (=100) の倍数で揃える。
const FAST_BLIND_SCHEDULE = [
  { level: 1,  smallBlind: 0, bigBlind: 0, ante: 200,     durationMinutes: BLIND_DURATION },
  { level: 2,  smallBlind: 0, bigBlind: 0, ante: 400,     durationMinutes: BLIND_DURATION },
  { level: 3,  smallBlind: 0, bigBlind: 0, ante: 600,     durationMinutes: BLIND_DURATION },
  { level: 4,  smallBlind: 0, bigBlind: 0, ante: 800,     durationMinutes: BLIND_DURATION },
  { level: 5,  smallBlind: 0, bigBlind: 0, ante: 1000,    durationMinutes: BLIND_DURATION },
  { level: 6,  smallBlind: 0, bigBlind: 0, ante: 1200,    durationMinutes: BLIND_DURATION },
  { level: 7,  smallBlind: 0, bigBlind: 0, ante: 1600,    durationMinutes: BLIND_DURATION },
  { level: 8,  smallBlind: 0, bigBlind: 0, ante: 2000,    durationMinutes: BLIND_DURATION },
  { level: 9,  smallBlind: 0, bigBlind: 0, ante: 2400,    durationMinutes: BLIND_DURATION },
  { level: 10, smallBlind: 0, bigBlind: 0, ante: 3000,    durationMinutes: BLIND_DURATION },
  { level: 11, smallBlind: 0, bigBlind: 0, ante: 4000,    durationMinutes: BLIND_DURATION },
  { level: 12, smallBlind: 0, bigBlind: 0, ante: 5000,    durationMinutes: BLIND_DURATION },
  { level: 13, smallBlind: 0, bigBlind: 0, ante: 6000,    durationMinutes: BLIND_DURATION },
  { level: 14, smallBlind: 0, bigBlind: 0, ante: 8000,    durationMinutes: BLIND_DURATION },
  { level: 15, smallBlind: 0, bigBlind: 0, ante: 10000,   durationMinutes: BLIND_DURATION },
  { level: 16, smallBlind: 0, bigBlind: 0, ante: 12000,   durationMinutes: BLIND_DURATION },
  { level: 17, smallBlind: 0, bigBlind: 0, ante: 16000,   durationMinutes: BLIND_DURATION },
  { level: 18, smallBlind: 0, bigBlind: 0, ante: 20000,   durationMinutes: BLIND_DURATION },
  { level: 19, smallBlind: 0, bigBlind: 0, ante: 24000,   durationMinutes: BLIND_DURATION },
  { level: 20, smallBlind: 0, bigBlind: 0, ante: 30000,   durationMinutes: BLIND_DURATION },
  { level: 21, smallBlind: 0, bigBlind: 0, ante: 40000,   durationMinutes: BLIND_DURATION },
  { level: 22, smallBlind: 0, bigBlind: 0, ante: 50000,   durationMinutes: BLIND_DURATION },
  { level: 23, smallBlind: 0, bigBlind: 0, ante: 60000,   durationMinutes: BLIND_DURATION },
  { level: 24, smallBlind: 0, bigBlind: 0, ante: 80000,   durationMinutes: BLIND_DURATION },
  { level: 25, smallBlind: 0, bigBlind: 0, ante: 100000,  durationMinutes: BLIND_DURATION },
  { level: 26, smallBlind: 0, bigBlind: 0, ante: 120000,  durationMinutes: BLIND_DURATION },
  { level: 27, smallBlind: 0, bigBlind: 0, ante: 160000,  durationMinutes: BLIND_DURATION },
  { level: 28, smallBlind: 0, bigBlind: 0, ante: 200000,  durationMinutes: BLIND_DURATION },
  { level: 29, smallBlind: 0, bigBlind: 0, ante: 240000,  durationMinutes: BLIND_DURATION },
  { level: 30, smallBlind: 0, bigBlind: 0, ante: 300000,  durationMinutes: BLIND_DURATION },
  { level: 31, smallBlind: 0, bigBlind: 0, ante: 400000,  durationMinutes: BLIND_DURATION },
  { level: 32, smallBlind: 0, bigBlind: 0, ante: 600000,  durationMinutes: BLIND_DURATION },
  { level: 33, smallBlind: 0, bigBlind: 0, ante: 1000000, durationMinutes: BLIND_DURATION },
  { level: 34, smallBlind: 0, bigBlind: 0, ante: 1600000, durationMinutes: BLIND_DURATION },
  { level: 35, smallBlind: 0, bigBlind: 0, ante: 2400000, durationMinutes: BLIND_DURATION },
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
        gameVariant: GAME_VARIANT,
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
