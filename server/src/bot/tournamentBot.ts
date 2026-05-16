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

// テスト用高速ブラインドスケジュール（chipUnit=100 倍数で揃えた基準値）。
// DBBP は SB/BB を投稿せず ante のみ、それ以外は SB=unit/2, BB=unit を投稿する形に変換する。
const FAST_BLIND_UNITS = [
  200,    400,    600,     800,     1000,    1200,    1600,    2000,
  2400,   3000,   4000,    5000,    6000,    8000,    10000,   12000,
  16000,  20000,  24000,   30000,   40000,   50000,   60000,   80000,
  100000, 120000, 160000,  200000,  240000,  300000,  400000,  600000,
  1000000, 1600000, 2400000,
];

const isBombPotVariant = GAME_VARIANT === 'plo_double_board_bomb';

const FAST_BLIND_SCHEDULE = FAST_BLIND_UNITS.map((unit, i) => ({
  level: i + 1,
  smallBlind: isBombPotVariant ? 0 : unit / 2,
  bigBlind: isBombPotVariant ? 0 : unit,
  ante: isBombPotVariant ? unit : 0,
  durationMinutes: BLIND_DURATION,
}));

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
