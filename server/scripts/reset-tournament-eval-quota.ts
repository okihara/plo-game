/// <reference types="node" />
/**
 * トーナメントAI評価の日次クォータ（User.tournamentEvalConsumedJstDate）をクリアする。
 *
 *   cd server && npx tsx scripts/reset-tournament-eval-quota.ts --userId=<cuid>
 *   cd server && npx tsx scripts/reset-tournament-eval-quota.ts --username=<username>
 *   cd server && npx tsx scripts/reset-tournament-eval-quota.ts --all --confirm
 *   cd server && npx tsx scripts/reset-tournament-eval-quota.ts --prod --userId=<cuid>
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const confirmAll = process.argv.includes('--confirm');

function argValue(prefix: string): string | undefined {
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return undefined;
  const v = raw.slice(prefix.length);
  return v.trim() || undefined;
}

const userId = argValue('--userId=');
const username = argValue('--username=');
const all = process.argv.includes('--all');

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.error('本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  const modes = [userId, username, all].filter(Boolean).length;
  if (modes !== 1) {
    console.error(
      '使い方: 次のいずれか1つを指定してください。\n' +
        '  --userId=<cuid>\n' +
        '  --username=<username>\n' +
        '  --all --confirm   （全ユーザーのクォータをクリア。--confirm が必須）'
    );
    process.exit(1);
  }

  if (all && !confirmAll) {
    console.error('ERROR: --all のときは誤操作防止のため --confirm も付けてください');
    process.exit(1);
  }

  if (userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, tournamentEvalConsumedJstDate: true },
    });
    if (!u) {
      console.error('ERROR: user が見つかりません');
      process.exit(1);
    }
    await prisma.user.update({
      where: { id: userId },
      data: { tournamentEvalConsumedJstDate: null },
    });
    console.log(
      `OK: ${u.username} (${u.id}) のクォータをリセットしました（以前の値: ${u.tournamentEvalConsumedJstDate ?? 'null'}）`
    );
    return;
  }

  if (username) {
    const u = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, tournamentEvalConsumedJstDate: true },
    });
    if (!u) {
      console.error('ERROR: username が見つかりません');
      process.exit(1);
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { tournamentEvalConsumedJstDate: null },
    });
    console.log(
      `OK: ${u.username} (${u.id}) のクォータをリセットしました（以前の値: ${u.tournamentEvalConsumedJstDate ?? 'null'}）`
    );
    return;
  }

  const result = await prisma.user.updateMany({
    where: { tournamentEvalConsumedJstDate: { not: null } },
    data: { tournamentEvalConsumedJstDate: null },
  });
  console.log(`OK: ${result.count} 件のユーザーのクォータをリセットしました`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
