// 本番/ローカルのメンテナンスモードを切り替える。
// 実行: cd server && npx tsx scripts/set-maintenance.ts --prod --on "メンテ中です"
//       cd server && npx tsx scripts/set-maintenance.ts --prod --off
//       cd server && npx tsx scripts/set-maintenance.ts --prod            (状態表示のみ)
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const argv = process.argv.slice(2);
const isProd = argv.includes('--prod');
const turnOn = argv.includes('--on');
const turnOff = argv.includes('--off');

if (turnOn && turnOff) {
  console.error('--on と --off は同時に指定できません');
  process.exit(1);
}

const base = isProd ? process.env.PROD_API_BASE_URL || 'https://baby-plo.app' : 'http://localhost:3001';
const secret = isProd ? process.env.PROD_ADMIN_SECRET : process.env.ADMIN_SECRET;

/** 既定のメンテ文言。--on の直後に文字列があればそれを使う */
function readMessage(): string {
  const i = argv.indexOf('--on');
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) return next;
  return 'メンテナンス中です。しばらくお待ちください。';
}

async function fetchStatus(): Promise<unknown> {
  const res = await fetch(`${base}/api/admin/stats?secret=${secret}`);
  if (!res.ok) throw new Error(`stats fetch failed: ${res.status}`);
  const stats = (await res.json()) as any;
  return stats.maintenance;
}

async function main() {
  if (!turnOn && !turnOff) {
    console.log('maintenance:', await fetchStatus());
    return;
  }

  const active = turnOn;
  const res = await fetch(`${base}/api/admin/maintenance?secret=${secret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active, message: active ? readMessage() : '' }),
  });
  if (!res.ok) throw new Error(`maintenance toggle failed: ${res.status}`);

  console.log(`maintenance -> ${active ? 'ON' : 'OFF'}`);
  console.log('current:', await fetchStatus());
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
