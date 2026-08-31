/// <reference types="node" />
/**
 * 毎日のトナメ運用（作成〜各種Xポスト）の冪等ディスパッチャ。
 *
 * 元は cron から5分毎に呼ぶ想定だったが、**cron 運用は廃止**。
 * 現在は Claude Code の scheduled task（毎日 12:05 JST）から `--only=create` で
 * トナメ作成にだけ使う。告知・結果・ランキングのツイートは `.claude/skills/` の
 * 各スキルが生成・投稿するので、`--only` なしで回すと二重投稿になる。詳細は README.md。
 *
 *   # 本番（トナメ作成のみ）
 *   cd server && npx tsx scripts/ops/daily-ops-tick.ts --prod --only=create
 *
 *   # ローカル検証
 *   cd server && npx tsx scripts/ops/daily-ops-tick.ts --local --dry-run --now=2026-07-02T18:05:00+09:00
 *
 * フラグ:
 *   --prod | --local     必須（どちらか一方）。DB・APIの向き先
 *   --dry-run            すべてのミューテーションを抑止し「would ...」をログ
 *   --now=<ISO>          時計を偽装（検証用）
 *   --only=create        実行ステップを絞る（現行運用は create のみ）
 *
 * ステップ: create / watchdog / announce / start / progress / result / ranking
 *   （create 以外は現在休眠。announce 以降はスキル側へ移行済み）
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
