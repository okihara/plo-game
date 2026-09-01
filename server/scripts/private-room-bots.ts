/**
 * プライベートルーム（招待コード）に Bot を着席させる運用スクリプト。
 *
 *   cd server && npx tsx scripts/private-room-bots.ts --code=8F3FG --count=5
 *   （既定の接続先は http://localhost:3001。--url= または SERVER_URL で変更）
 *
 * Ctrl+C で全 Bot が table:leave → 精算してから終了する。
 * 通常のリング戦 Bot（BotManager）とは独立したプロセスで、マッチメイキングには参加しない。
 */
import { BotClient } from '../src/bot/BotClient.js';
import { BOT_NAMES, BOT_AVATARS } from '../src/bot/BotManager.js';

function readArg(name: string): string | undefined {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const inviteCode = (readArg('code') ?? '').toUpperCase().trim();
const count = parseInt(readArg('count') ?? '2', 10);
const serverUrl = readArg('url') ?? process.env.SERVER_URL ?? 'http://localhost:3001';

if (!inviteCode || !Number.isFinite(count) || count < 1) {
  console.error('Usage: npx tsx scripts/private-room-bots.ts --code=<INVITE_CODE> [--count=2] [--url=http://localhost:3001]');
  process.exit(1);
}

/** BOT_NAMES からランダムに重複なく count 件選ぶ */
function pickNames(n: number): string[] {
  const pool = [...BOT_NAMES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const bots: BotClient[] = [];

async function main() {
  console.log('=================================');
  console.log('  Private Room Bots');
  console.log('=================================');
  console.log(`Server URL : ${serverUrl}`);
  console.log(`Invite code: ${inviteCode}`);
  console.log(`Bot count  : ${count}`);
  console.log('=================================');

  for (const name of pickNames(count)) {
    const bot = new BotClient({
      serverUrl,
      name,
      avatarUrl: BOT_AVATARS[Math.floor(Math.random() * BOT_AVATARS.length)],
      // プライベートルームでは勝手に離席・切断させない
      disconnectChance: 0,
      maxHandsPerSession: 0,
      botSecret: process.env.BOT_SECRET,
    });

    try {
      await bot.connect();
      if (bot.isMaintenanceActive) {
        console.warn(`[${name}] メンテナンス中のため着席をスキップ`);
        await bot.disconnect();
        continue;
      }
      await bot.joinPrivateRoom(inviteCode);
      bots.push(bot);
    } catch (err) {
      console.warn(`[${name}] 接続失敗:`, err);
      await bot.disconnect().catch(() => {});
    }

    await sleep(500);
  }

  // 着席結果を確認（table:error はサーバー側から個別に届く）
  await sleep(2000);
  const seated = bots.filter(b => b.getStatus().tableId !== null);
  console.log(`[Result] 着席 ${seated.length}/${bots.length} 人: ${seated.map(b => b.getName()).join(', ') || '(なし)'}`);
  if (seated.length < bots.length) {
    console.warn('[Result] 着席できなかった Bot は満席・残高不足などの可能性あり（上のログを参照）');
  }
  if (seated.length === 0) {
    await shutdown('no-seat');
    return;
  }

  setInterval(() => {
    const active = bots.filter(b => b.getStatus().tableId !== null);
    console.log(`[Stats] 着席中 ${active.length}/${bots.length}`);
  }, 30000);
}

let isShuttingDown = false;
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\nReceived ${signal}, 全 Bot を離席させます...`);
  await Promise.all(bots.map(b => b.disconnect().catch(() => {})));
  console.log('All bots left the room.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(async err => {
  console.error('Failed to start private room bots:', err);
  await shutdown('error');
  process.exit(1);
});
