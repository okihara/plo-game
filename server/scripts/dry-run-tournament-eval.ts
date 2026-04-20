/// <reference types="node" />
/**
 * 新プロンプト（PROMPT_VERSION=3）でトーナメント評価を dry-run 生成する。
 * DB には書き込まず、日次クォータも消費しない。LLM 呼び出しコストだけ発生する。
 *
 *   cd server && npx tsx scripts/dry-run-tournament-eval.ts --prod --tournamentId=<id> --userId=<id>
 *
 * 直近の完了トーナメントを一覧するとき:
 *   cd server && npx tsx scripts/dry-run-tournament-eval.ts --prod --list-recent
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const listRecent = process.argv.includes('--list-recent');
const tournamentIdArg = process.argv.find(a => a.startsWith('--tournamentId='))?.split('=')[1];
const userIdArg = process.argv.find(a => a.startsWith('--userId='))?.split('=')[1];

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
  process.exit(1);
}
if (isProd) console.error('本番DBに接続します');

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function listRecentTournaments() {
  const rows = await prisma.tournament.findMany({
    where: { status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      name: true,
      buyIn: true,
      completedAt: true,
      results: {
        select: {
          position: true,
          userId: true,
          user: { select: { username: true, displayName: true } },
        },
        orderBy: { position: 'asc' },
        take: 3,
      },
    },
  });
  console.log('=== 直近の完了トーナメント ===');
  for (const t of rows) {
    console.log(`\n${t.id}  ${t.name}  buyIn=${t.buyIn}  completedAt=${t.completedAt?.toISOString()}`);
    for (const r of t.results) {
      const name = r.user?.displayName || r.user?.username || '(unknown)';
      console.log(`  ${r.position}位  userId=${r.userId}  ${name}`);
    }
  }
}

async function dryRun(tournamentId: string, userId: string) {
  const { fetchTournamentHandsForUser } = await import(
    '../src/modules/history/tournamentHandsForUser.js'
  );
  const { generateTournamentEvaluationMarkdown } = await import(
    '../src/modules/tournamentEvaluation/callEvalLlm.js'
  );

  const [tournament, result] = await Promise.all([
    prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true, status: true, buyIn: true },
    }),
    prisma.tournamentResult.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
      select: { position: true, prize: true, reentries: true },
    }),
  ]);

  if (!tournament) {
    console.error('ERROR: トーナメントが見つかりません');
    process.exit(1);
  }
  if (tournament.status !== 'COMPLETED') {
    console.error(`ERROR: ステータスが COMPLETED ではありません (${tournament.status})`);
    process.exit(1);
  }
  if (!result) {
    console.error('ERROR: このユーザーの確定結果がありません');
    process.exit(1);
  }

  const hands = await fetchTournamentHandsForUser(prisma, tournamentId, userId);
  if (hands.length === 0) {
    console.error('ERROR: ハンド履歴がありません');
    process.exit(1);
  }

  console.error(`トーナメント: ${tournament.name}`);
  console.error(`入力ハンド数: ${hands.length}`);
  console.error(`順位: ${result.position}位 / 賞金: ${result.prize} / 再エントリー: ${result.reentries}`);
  console.error('--- LLM 呼び出し開始 ---');

  const t0 = Date.now();
  const out = await generateTournamentEvaluationMarkdown({
    tournamentName: tournament.name,
    buyIn: tournament.buyIn,
    position: result.position,
    prize: result.prize,
    reentries: result.reentries,
    hands,
  });
  const elapsedMs = Date.now() - t0;
  console.error(`--- 完了 ${elapsedMs}ms / model=${out.model} / promptVersion=${out.promptVersion} ---\n`);

  console.log(out.markdown);

  console.error('\n--- 簡易集計 ---');
  console.error(`出力文字数: ${out.markdown.length}`);
  const h2Headings = out.markdown.match(/^##\s+/gm)?.length ?? 0;
  const h3Headings = out.markdown.match(/^###\s+/gm)?.length ?? 0;
  console.error(`## 見出し数: ${h2Headings}`);
  console.error(`### 見出し数: ${h3Headings}`);
  const handMentions = out.markdown.match(/ハンド\s*#?\s*\d+|Hand\s*#?\s*\d+/gi)?.length ?? 0;
  console.error(`ハンド番号への言及（概算）: ${handMentions}`);
}

async function main() {
  if (listRecent) {
    await listRecentTournaments();
    return;
  }
  if (!tournamentIdArg || !userIdArg) {
    console.error('ERROR: --tournamentId=<id> --userId=<id> を指定してください（--list-recent で候補一覧）');
    process.exit(1);
  }
  await dryRun(tournamentIdArg, userIdArg);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
