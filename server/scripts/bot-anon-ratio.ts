/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } });
async function main() {
  const bots = await prisma.user.findMany({ where: { provider: 'bot' }, select: { username: true, avatarUrl: true } });
  const anon = bots.filter(b => b.avatarUrl === null || (b.avatarUrl && b.avatarUrl.includes('anonymous')));
  const preset = bots.filter(b => b.avatarUrl && !b.avatarUrl.includes('anonymous'));
  console.log(`Bot総数: ${bots.length}`);
  console.log(`anonymous: ${anon.length} (${Math.round(anon.length / bots.length * 100)}%)`);
  console.log(`プリセット: ${preset.length} (${Math.round(preset.length / bots.length * 100)}%)`);
  console.log(`\nanonymous一覧:`);
  for (const b of anon.sort((a, c) => a.username.localeCompare(c.username))) {
    console.log(`  ${b.username}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
