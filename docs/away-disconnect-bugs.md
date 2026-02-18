# 離席・切断周りのバグ調査報告

調査日: 2026-02-19

## 概要

公開テスト中に発見された離席（away/disconnect）周りの潜在的バグ一覧。
タイマー管理・状態同期・切断再接続フローにおける競合状態とメモリリークが主な問題。

---

## 高優先度（実運用で発生しやすい）

### BUG-001: Grace Period中の再接続で二重処理（致命的）

**ファイル:** `server/src/modules/game/socket.ts` disconnect ハンドラ

**問題:**
切断時に30秒の `setTimeout` をセットするが、その間にプレイヤーが再接続して別テーブルに着席した場合、30秒後に旧テーブルの `unseatAndCashOut()` が実行される。

- チップの二重計算
- gameState不整合
- 複数テーブルで同時にunseat処理が走る

**再現シナリオ:**
1. プレイヤーA（odId=user123）がTable1に着席
2. ネットワーク切断 → disconnect発火 → 30秒timer開始
3. 10秒後に再接続 → `matchmaking:join` → Table2に着席
4. 30秒経過 → `unseatAndCashOut(Table1, user123)` 実行
5. Table2の状態が破壊される可能性

**修正案:** per-player state machineを導入し、再接続時に旧timerをキャンセルする。

---

### BUG-002: ActionControllerの二重fold

**ファイル:** `server/src/modules/table/helpers/ActionController.ts` `requestNextAction()`

**問題:**
`requestNextAction()` 内で切断プレイヤーの即時fold処理と、`handleActionTimeout()` のfold処理が同時に走る可能性がある。

- `game:action_taken` が2回発火
- UI側で同じプレイヤーのfoldが2つ表示される

**修正案:** fold処理を統一し、重複防止フラグを設ける。

---

### BUG-003: タイマーのclearTimers()後にコールバック実行

**ファイル:** `server/src/modules/table/helpers/ActionController.ts`

**問題:**
`clearTimers()` で `clearTimeout()` を呼んでも、JSイベントループの関数キューに既にコールバックが登録されている場合、古いコールバックが実行される可能性がある。

`unseatPlayer()` → `clearTimers()` → しかし直前にsetTimeoutのコールバックが実行キューに入っている → 二重処理。

**修正案:** タイマーコールバック内でgeneration counter等を使い、古いコールバックを無視する。

---

### BUG-004: ランアウト中の切断が無視される

**ファイル:** `server/src/modules/table/TableInstance.ts` `handleAllInRunOut()`

**問題:**
全員オールイン → ランアウト演出中にプレイヤーが切断しても、タイマーが継続実行される。gameState内のプレイヤー情報が古いまま最終結果が送信される。

**再現シナリオ:**
1. 全員オールイン → ランアウト開始
2. フロップ表示中にプレイヤーA切断
3. `unseatPlayer(A)` 実行 → しかし `isRunOutInProgress` なので中途半端
4. hand_complete送信時に存在しないプレイヤーの情報が含まれる

**修正案:** ランアウト中の切断時はプレイヤー情報を保持しつつ、完了後にunseat処理を行う。

---

### BUG-005: MatchmakingPoolのメモリリーク

**ファイル:** `server/src/modules/fastfold/MatchmakingPool.ts`

**問題:**
切断されたプレイヤーが `continue` でスキップされるだけでキューに残り続ける。

- メモリリーク（長時間運用で蓄積）
- `getQueueStatus()` の統計情報（avgWaitMs等）が不正確

**修正案:** `processQueue()` 内で切断済みエントリを削除する、またはdisconnectイベントでキューから即座に除去する。

---

### BUG-006: Spectatorのlistener二重登録

**ファイル:** `server/src/modules/table/TableInstance.ts` `addSpectator()`

**問題:**
同じsocketで `addSpectator()` が複数回呼ばれると、`disconnect` リスナーが重複登録される。メモリリークとMaxListeners警告の原因。

**修正案:** 登録前に既存リスナーをチェック、または `once()` を使用する。

---

## 中優先度（エッジケース）

### BUG-007: unseatPlayer()のcurrentPlayer判定タイミング

**ファイル:** `server/src/modules/table/TableInstance.ts` `unseatPlayer()`

**問題:**
`unseatPlayer()` が呼ばれる前に別のplayerがcurrentPlayerIndexに遷移している場合、`wasCurrentPlayer` が `false` になるが、ActionController内の `actionTimer` が旧プレイヤー用のまま残る可能性。

---

### BUG-008: ActionTimeout時のrace condition

**ファイル:** `server/src/modules/table/TableInstance.ts` `handleActionTimeout()`

**問題:**
タイムアウトによる `handleAction(odId, 'fold', 0)` と、同時にプレイヤーがSocketから `game:action` を送信した場合、二重処理になる可能性。`handleAction` 内でcurrentPlayerIndexチェックがあるため2番目は失敗するが、`game:action_taken` が2回発火する場合がある。

---

### BUG-009: cashOutPlayerのDB原子性なし

**ファイル:** `server/src/modules/game/socket.ts` `cashOutPlayer()`

**問題:**
`bankroll.update` と `transaction.create` が別々のDB操作で、トランザクションで囲まれていない。片方だけ成功する可能性がある。

**修正案:** `prisma.$transaction()` で囲む。

---

### BUG-010: pendingStartHand中の人数減少

**ファイル:** `server/src/modules/table/TableInstance.ts` `maybeStartHand()`

**問題:**
delay中に複数プレイヤーが切断される可能性。`startNewHand()` 内で再チェックはあるが、明示的なガードが弱い。

---

### BUG-011: Bustedプレイヤーの同時削除競合

**ファイル:** `server/src/modules/table/TableInstance.ts`

**問題:**
bustedチェック後にすぐ `unseatPlayer()` を呼ぶが、同時にクライアント側が `table:leave` を送信している場合、2つの `unseatPlayer()` が同時に走る。

---

## 低優先度（設計上の改善点）

### BUG-012: 再接続時のchips同期不完全

**ファイル:** `server/src/modules/table/TableInstance.ts` `reconnectPlayer()`

**問題:**
ハンド中に長時間切断→その間にハンド完了→新ハンド開始→再接続の場合、クライアントが古いハンドの状態と新しいハンドのholeCardsが混合する可能性。

---

### BUG-013: Socket.io roomの自動離脱なし

**ファイル:** `server/src/modules/game/socket.ts` disconnect ハンドラ

**問題:**
disconnectイベント内で `socket.leave(roomName)` が明示的に呼ばれない。grace period中のbroadcastが切断済みsocketへ送信試行される。

---

## 修正優先順序

1. **BUG-001** - Grace Periodロジックの根本修正（per-player timer管理）
2. **BUG-002 / BUG-003** - fold処理の統一、タイマー世代管理
3. **BUG-005** - MatchmakingPool キュークリーンアップ
4. **BUG-004** - ランアウト中の切断ハンドリング
5. **BUG-006** - Spectator listener重複防止
6. **BUG-009** - cashOut DBトランザクション
7. その他
