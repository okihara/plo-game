/// <reference types="node" />
/**
 * 特定ユーザーのトーナメント評価（AIレビュー）内容を表示する。
 *
 *   cd server && npx tsx scripts/show-tournament-eval.ts --prod --userId=<userId>
 *   cd server && npx tsx scripts/show-tournament-eval.ts --prod --userId=<userId> --limit=3
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const userIdArg = process.argv.find((a) => a.startsWith('--userId='))?.split('=')[1];
const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1];
const limit = limitArg ? Number(limitArg) : 5;

if (!userIdArg) {
  console.error('ERROR: --userId=<userId> を指定してください');
  process.exit(1);
}

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
  const rows = await prisma.tournamentUserEvaluation.findMany({
    where: { userId: userIdArg },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      createdAt: true,
      tournamentId: true,
      model: true,
      promptVersion: true,
      errorMessage: true,
      content: true,
      user: { select: { username: true, displayName: true } },
      tournament: { select: { name: true } },
    },
  });

  if (rows.length === 0) {
    console.log('該当レコードなし');
    return;
  }

  const name = rows[0].user.displayName || rows[0].user.username;
  console.log(`userId=${userIdArg} | ${name} | 件数=${rows.length}（最新${limit}件）`);

  for (const r of rows) {
    console.log('\n' + '='.repeat(80));
    console.log(
      `id=${r.id}\nstatus=${r.status}\ncreatedAt=${r.createdAt.toISOString()}\ntournament=${r.tournament.name} (${r.tournamentId})\nmodel=${r.model} | promptVersion=${r.promptVersion}`
    );
    if (r.errorMessage) {
      console.log(`errorMessage=${r.errorMessage}`);
    }
    console.log('--- content ---');
    const content = r.content as { markdown?: string } | null;
    if (content && typeof content === 'object' && typeof content.markdown === 'string') {
      console.log(content.markdown);
    } else {
      console.log(JSON.stringify(r.content, null, 2));
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
