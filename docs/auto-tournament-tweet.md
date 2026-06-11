# トナメ結果ツイートの自動化

## 現状（実装済み）

結果ツイートの文面生成を純関数としてモジュール化し、CLI から dry-run / 投稿できる。

- **`server/src/modules/tournament/tweet/`**
  - `types.ts` — ツイート用データの型（fetch と build の共通契約）
  - `fetchTweetData.ts` — `fetchTournamentTweetData(prisma, { tournamentId?, handsLimit? })`。PrismaClient は注入（本番/ローカル切り替えは呼び出し側）
  - `buildResultTweet.ts` — `buildResultTweet(data, options)` ほか純関数群。`.claude/skills/tournament-tweet/SKILL.md` のルールに準拠（インマネ人数まで列挙、生カード/生チップ数は出さない、役名・BB換算ポット・ダブルボードのスクープは可、リエントリーに触れない）
- **`server/scripts/tournament-tweet.ts`** — CLI。デフォルト dry-run、`--post` 指定時のみ X API v2 で投稿

```bash
# dry-run（文面を stdout に出すだけ）
cd server && npx tsx scripts/tournament-tweet.ts --prod
cd server && npx tsx scripts/tournament-tweet.ts --prod --tournament <id> --lead "休みの中"

# 実投稿（要 TWITTER_* 環境変数）
cd server && npx tsx scripts/tournament-tweet.ts --prod --post
```

- X API クライアントは `server/src/shared/twitterClient.ts`（旧 `modules/quiz/twitterClient.ts` を共通化。daily-quiz と共用）
- 必要な環境変数（`server/.env`、値は会話・ログに出さない）: `DATABASE_PROD_PUBLIC_URL`（`--prod` 時）、`TWITTER_API_KEY` / `TWITTER_API_KEY_SECRET` / `TWITTER_ACCESS_TOKEN` / `TWITTER_ACCESS_TOKEN_SECRET`（`--post` 時）

優勝者コメントはヒューリスティック生成（最終ハンドの役・スクープ・BB換算ポット・終盤の勝率）。より文脈の効いたコメントが欲しい場合は従来どおり `/tournament-tweet` スキル（LLM 生成）を使い、CLI の文面は土台として手直しする運用もできる。

## 将来案: サーバー本体への組み込み（トナメ終了時の自動投稿フック）

未実装。実装する場合の設計:

- **オプトイン**: 環境変数 `TOURNAMENT_AUTO_TWEET=1` のときだけ有効。未設定なら現状どおり何もしない（Railway 本番のみで有効化）
- **フック位置**: `TournamentInstance.completeTournament()`（`tournament:completed` emit 後）から fire-and-forget で呼ぶ。ただし直接 X API を叩くのではなく、`modules/tournament/tweet/` に `autoTweetOnComplete(tournamentId)` のような薄いサービスを置き、依存（prisma / twitterClient）は注入する
- **タイミング**: ハンド履歴は fire-and-forget 保存のため、完了直後は最終ハンドが未保存の可能性がある。60 秒程度遅延してから `fetchTournamentTweetData` を実行する
- **冪等性**: 二重投稿防止のため、投稿済み tweetId を DB（`Tournament` に `resultTweetId` カラム追加など）に記録し、既に値があればスキップ
- **失敗時**: 投稿失敗はゲーム進行に影響させない。エラーは Sentry に送るのみ（リトライは手動で CLI を叩く）
- **検証**: 自動投稿の有効化前に、本番データで `--prod`（dry-run）の文面を数回レビューしてから `TOURNAMENT_AUTO_TWEET` を入れる
