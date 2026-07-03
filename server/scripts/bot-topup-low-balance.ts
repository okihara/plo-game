/// <reference types="node" />
/**
 * 残高が閾値以下の Bot を 3000 に補充するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-topup-low-balance.ts                  # ローカルDB / ドライラン
 *   cd server && npx tsx scripts/bot-topup-low-balance.ts --apply          # ローカルDB / 適用
 *   cd server && npx tsx scripts/bot-topup-low-balance.ts --prod           # 本番DB / ドライラン
 *   cd server && npx tsx scripts/bot-topup-low-balance.ts --prod --apply   # 本番DB / 適用
 *
 * 閾値は --threshold=N で指定可能（既定 300）。例: --threshold=3000
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const TOPUP_TO = 3000;

const isProd = process.argv.includes('--prod');
const apply = process.argv.includes('--apply');

const thresholdArg = process.argv.find(a => a.startsWith('--threshold='));
const THRESHOLD = thresholdArg ? Number(thresholdArg.split('=')[1]) : 300;
if (!Number.isFinite(THRESHOLD)) {
  console.error('ERROR: --threshold=N の N が数値ではありません');
  process.exit(1);
}

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
    process.exit(1);
  }
  console.log('🔗 本番DBに接続します');
}
console.log(`mode: ${apply ? 'APPLY (更新)' : 'DRY-RUN (表示のみ)'}\n`);

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

async function main() {
  const targets = await prisma.user.findMany({
    where: {
      provider: 'bot',
      bankroll: { balance: { lte: THRESHOLD } },
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      bankroll: { select: { balance: true } },
    },
    orderBy: { bankroll: { balance: 'asc' } },
  });

  console.log(`=== 対象 Bot: ${targets.length} 件 (balance <= ${THRESHOLD}) ===\n`);
  if (targets.length === 0) {
    console.log('対象なし。終了します。');
    return;
  }

  for (const u of targets) {
    const before = u.bankroll?.balance ?? 0;
    console.log(
      `  ${u.id}  ${(u.displayName ?? u.username).padEnd(20)}  ${before
        .toString()
        .padStart(6)} -> ${TOPUP_TO}`
    );
  }

  if (!apply) {
    console.log('\n(ドライラン: 更新は行いませんでした。--apply で適用)');
    return;
  }

  const ids = targets.map(t => t.id);
  const result = await prisma.bankroll.updateMany({
    where: { userId: { in: ids } },
    data: { balance: TOPUP_TO },
  });
  console.log(`\n✅ 更新完了: ${result.count} 件`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
