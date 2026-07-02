/// <reference types="node" />
/**
 * 毎日のトナメ運用（作成〜各種Xポスト）を自動化する冪等ディスパッチャ。
 * cron から5分毎に実行される想定（daily-ops-tick.sh 経由）。
 *
 *   # 本番（cron が使う形）
 *   cd server && npx tsx scripts/ops/daily-ops-tick.ts --prod
 *
 *   # ローカル検証
 *   cd server && npx tsx scripts/ops/daily-ops-tick.ts --local --dry-run --now=2026-07-02T18:05:00+09:00
 *
 * フラグ:
 *   --prod | --local     必須（どちらか一方）。DB・APIの向き先
 *   --dry-run            すべてのミューテーションを抑止し「would ...」をログ
 *   --now=<ISO>          時計を偽装（検証用）
 *   --only=create,start  実行ステップを絞る（段階的有効化用）
 *
 * ステップ: create / watchdog / announce / start / progress / result / ranking
 * 冪等性は TweetDraft の unique 制約（kind, tournamentId）が最終ガード。
 */
import { createContext } from './lib/context.js';
import { runTick } from './lib/steps.js';

async function main() {
  const ctx = createContext(process.argv);
  try {
    const ok = await runTick(ctx);
    if (!ok) process.exitCode = 1;
  } finally {
    await ctx.prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
