/// <reference types="node" />
/**
 * 指定ユーザーの role を変更するスクリプト（プライベートルーム一覧ページの権限付与など）
 *
 * 実行:
 *   cd server && npx tsx scripts/set-user-role.ts --username=NAME --role=ADMIN                 # ローカルDB / ドライラン
 *   cd server && npx tsx scripts/set-user-role.ts --username=NAME --role=ADMIN --apply         # ローカルDB / 適用
 *   cd server && npx tsx scripts/set-user-role.ts --username=NAME --role=ADMIN --prod          # 本番DB / ドライラン
 *   cd server && npx tsx scripts/set-user-role.ts --username=NAME --role=ADMIN --prod --apply  # 本番DB / 適用
 *
 * --username は大文字小文字を無視して完全一致で検索する。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient, Role } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const apply = process.argv.includes('--apply');

const usernameArg = process.argv.find(a => a.startsWith('--username='));
const roleArg = process.argv.find(a => a.startsWith('--role='));
const username = usernameArg?.split('=')[1];
const role = roleArg?.split('=')[1] as Role | undefined;

if (!username || !role) {
  console.error('ERROR: --username=NAME と --role=ADMIN|PLAYER|GUEST を指定してください');
  process.exit(1);
}
if (!Object.values(Role).includes(role)) {
  console.error(`ERROR: 不正な role: ${role}（ADMIN | PLAYER | GUEST）`);
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
  const users = await prisma.user.findMany({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true, username: true, displayName: true, provider: true, role: true, lastLoginAt: true },
  });

  if (users.length === 0) {
    console.error(`ユーザーが見つかりません: ${username}`);
    process.exit(1);
  }
  if (users.length > 1) {
    console.error(`複数ユーザーが一致しました。username を正確に指定してください:`);
    for (const u of users) console.error(`  ${u.username} (${u.provider}, id=${u.id})`);
    process.exit(1);
  }

  const user = users[0];
  console.log(`対象: ${user.username} (displayName=${user.displayName ?? '—'}, provider=${user.provider}, id=${user.id})`);
  console.log(`role: ${user.role} → ${role}`);
  console.log(`最終ログイン: ${user.lastLoginAt?.toISOString() ?? '—'}`);

  if (!apply) {
    console.log('\nDRY-RUN のため更新していません。--apply を付けて実行してください。');
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role } });
  console.log('\n✅ 更新しました');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
