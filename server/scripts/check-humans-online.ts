// 本番の admin stats から着席中プレイヤーを取得し、DB の provider で人間/Bot を分類する。
// 実行: cd server && npx tsx scripts/check-humans-online.ts --prod
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const isProd = process.argv.includes('--prod');
const prisma = new PrismaClient(
  isProd ? { datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } } : undefined
);

async function main() {
  const base = isProd ? process.env.PROD_API_BASE_URL || 'https://baby-plo.app' : 'http://localhost:3001';
  const secret = isProd ? process.env.PROD_ADMIN_SECRET : process.env.ADMIN_SECRET;
  const res = await fetch(`${base}/api/admin/stats?secret=${secret}`);
  if (!res.ok) throw new Error(`stats fetch failed: ${res.status}`);
  const stats = (await res.json()) as any;

  const seated = new Map<string, { odName: string; connected: boolean; table: string }>();
  for (const t of stats.tables?.details ?? []) {
    for (const p of t.players ?? []) {
      if (p?.odId) seated.set(p.odId, { odName: p.odName, connected: p.isConnected, table: `${t.blinds}${t.isFastFold ? ' FF' : ''}` });
    }
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...seated.keys()] } },
    select: { id: true, provider: true },
  });
  const providerById = new Map(users.map(u => [u.id, u.provider]));

  let humans = 0;
  for (const [odId, info] of seated) {
    const provider = providerById.get(odId) ?? 'unknown';
    const isHuman = provider === 'twitter';
    if (isHuman) {
      humans++;
      console.log(`HUMAN ${info.odName} (${info.table}) connected=${info.connected}`);
    }
  }
  console.log(`---`);
  console.log(`seated total: ${seated.size}, humans: ${humans}, bots/other: ${seated.size - humans}`);
  console.log(`connections: total=${stats.connections?.total}, authenticated=${stats.connections?.authenticated}`);
}

main().finally(() => prisma.$disconnect());
