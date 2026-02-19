# バックエンド監査レポート

作成日: 2026-02-19

## CRITICAL（即座に対応すべき）

### 1. disconnect時にマッチメイキングキューからの除去・リファンドがない

**ファイル:** `server/src/modules/game/socket.ts` L322-329

```typescript
socket.on('disconnect', async () => {
    const table = tableManager.getPlayerTable(socket.odId!);
    if (table) {
        await unseatAndCashOut(table, socket.odId!);
    }
    // ← matchmakingPool からの除去がない！
});
```

**問題:** `matchmaking:join` でバイインが差し引かれた後、テーブル着席前にソケットが切断すると、キューに残ったままチップが永遠に失われる。`processQueue` は `socket.connected === false` でスキップするだけでリファンドしない（`MatchmakingPool.ts` L101-103）。

**修正方針:** disconnect ハンドラで全キューから除去し、チップをリファンドする。

---

### 2. table:join のバイイン差し引きと着席が非原子的

**ファイル:** `server/src/modules/game/socket.ts` L180-213

**問題:** バイインの `bankroll.update` → `transaction.create` → `seatPlayer` が別々のDB操作。着席失敗時のリファンド（L209）も別トランザクション。同一プレイヤーの同時 `table:join` でダブル差し引きが起きる可能性がある。

**修正方針:** Prisma の `$transaction` で原子化する。

---

### 3. ボット認証にシークレット検証がない

**ファイル:** `server/src/modules/game/socket.ts` L94-107

```typescript
const isBot = socket.handshake.auth.isBot === true;  // クライアントの自己申告のみ
```

**問題:** 誰でも `{isBot: true, botName: "FakeBot"}` で接続すれば100,000チップのボットユーザーが作成される。

**修正方針:** 環境変数 `BOT_AUTH_SECRET` を設け、ボット接続時にシークレット検証を必須にする。

---

## HIGH（早期に対応すべき）

### 4. 複数のasyncイベントハンドラにtry/catchがない

**ファイル:** `server/src/modules/game/socket.ts`

- L222-228 `table:leave` — try/catchなし
- L311-318 `matchmaking:leave` — try/catchなし
- L322-329 `disconnect` — try/catchなし

**問題:** `unseatAndCashOut` 内のDB操作が失敗した場合、unhandled rejection でサーバーがクラッシュする。

**修正方針:** 全 async ハンドラを try/catch で囲む。

---

### 5. /api/auth/me の preHandler で return がない

**ファイル:** `server/src/modules/auth/routes.ts` L243-248

```typescript
preHandler: async (request, reply) => {
    try {
        await request.jwtVerify();
    } catch (err) {
        reply.code(401).send({ error: 'Unauthorized' });
        // ← return がないため、後続のハンドラが実行される
    }
},
```

**問題:** 未認証時に `request.user` が未定義のまま後続処理が走り、`userId` が `undefined` で Prisma エラーが発生する。

**修正方針:** `return reply.code(401).send(...)` に修正。

---

### 6. game:action の入力バリデーション不足

**ファイル:** `server/src/modules/game/socket.ts` L231-242

**問題:** `data.action` の型チェックなし、`data.amount` の負数/NaN/非数値チェックなし。TypeScript の型は実行時には効かない。

**修正方針:** action の enum チェックと amount の数値・範囲バリデーションを追加。

---

### 7. Spectator リスナーの重複登録

**ファイル:** `server/src/modules/table/TableInstance.ts` L579-585

```typescript
public addSpectator(socket: Socket): void {
    this.spectators.add(socket);
    socket.join(this.roomName);
    socket.on('disconnect', () => {  // 呼ぶたびにリスナーが追加される
        this.spectators.delete(socket);
    });
}
```

**問題:** 同一ソケットで `table:spectate` を複数回送信すると disconnect リスナーが蓄積。テーブル切り替え時に前テーブルから `removeSpectator` もされない（`socket.ts` L338-354）。

**修正方針:** 既に登録済みならスキップ、`socket.once` を使用、テーブル切り替え時に前テーブルから除去。

---

### 8. handleHandComplete 内のバスト処理で unseatPlayer が呼ばれる

**ファイル:** `server/src/modules/table/TableInstance.ts` L554-562

**問題:** `isHandInProgress = false` の後に `unseatPlayer` を呼び、その中で `processFold` → `advanceToNextPlayer` が実行される可能性がある。ハンドが終わっているのにゲーム進行ロジックが動く。

**修正方針:** バスト処理を `handleHandComplete` の外に分離し、ハンド完了後に安全に実行。

---

### 9. ログインボーナスの TOCTOU

**ファイル:** `server/src/modules/auth/bankroll.ts`

**問題:** `isLoginBonusAvailable` チェックとボーナス適用が別トランザクションのため、同時2リクエストで二重付与される。

**修正方針:** Prisma `$transaction` で check と apply を原子化する。

---

## MEDIUM（改善推奨）

### 10. blinds パースにバリデーションなし

**ファイル:** `server/src/modules/game/socket.ts` L262

```typescript
const [, bb] = blinds.split('/').map(Number);
const minBuyIn = bb * 100;
```

**問題:** 不正な blinds 文字列で bb が `undefined` → `NaN * 100 = NaN` → バランスチェック `bankroll.balance < NaN` が常に `false` → チェック通過。

---

### 11. pendingTokens マップに上限なし

**ファイル:** `server/src/modules/auth/routes.ts` L86

**問題:** OAuth フロー開始ごとにエントリが追加される。10分の TTL はあるが、大量リクエストでメモリを圧迫可能。クリーンアップは `/twitter` エンドポイント呼び出し時のみ実行。

---

### 12. TableManager.removeTable で playerTables がクリーンアップされない

**ファイル:** `server/src/modules/table/TableManager.ts`

**問題:** テーブル削除時に `playerTables` Map のエントリが残り、ゴーストエントリが蓄積する。

---

### 13. グレースフルシャットダウン時にプレイヤーのキャッシュアウトなし

**ファイル:** `server/src/index.ts`

**問題:** SIGTERM/SIGINT で `fastify.close()` → `prisma.$disconnect()` のみ。進行中テーブルのプレイヤーやキュー内プレイヤーのチップが失われる。

---

### 14. Math.random() による非暗号学的シャッフル

**ファイル:** `server/src/shared/logic/deck.ts`

**問題:** `Math.random()` は暗号学的に安全ではない。理論上はシャッフル結果が予測可能。`crypto.getRandomValues` の使用を推奨。
