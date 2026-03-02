# ポーカールームメタファー（サーバー内部構造）

サーバー内部のデータ構造とフローを、実際のポーカールームに例えた対応表。

## 全体像

```
┌─────────────────────────────────────────────────┐
│  ポーカールーム（setupGameSocket）                │
│                                                 │
│  受付名簿（activeConnections: Map<odId, socket>）│
│     「山田さん → 今店内にいる本人」              │
│                                                 │
│  フロアマネージャー（TableManager）              │
│     手帳（playerTables: Map<odId, tableId>）     │
│        「山田さん → 3番テーブル」                │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Table 1  │  │ Table 2  │  │ Table 3  │      │
│  │ 1/3 通常 │  │ 1/3 FF   │  │ 1/2 通常 │      │
│  │(Instance)│  │(Instance)│  │(Instance)│      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                 │
│  キャッシャー（bankroll / cashOutPlayer）         │
└─────────────────────────────────────────────────┘
```

## 対応表

| コード | ポーカールーム | 補足 |
|--------|---------------|------|
| `socket` | お客さんの**体** | タブごとに別の体。物理的存在 |
| `odId` | **会員証** | 同一人物なら全タブで同じ（PrismaのUser.id） |
| `socket.id` | **入館証番号** | Socket.ioが自動発行、タブごとにユニーク |
| `activeConnections` | 入口の**受付名簿** | 会員証 → 今店内にいる体 |
| `TableManager` | **フロアマネージャー** | テーブル管理・案内係 |
| `playerTables` | フロアの**手帳** | 誰がどのテーブルにいるか |
| `TableInstance` | 個別の**ポーカーテーブル** | ディーラー付き |
| `SeatInfo` | テーブルの**椅子** | 座っている人の体（socket）への参照 |
| `BroadcastService` | ディーラーの**声** | テーブル全員に聞こえる |
| `emitToSocket` | ディーラーが**個人にこっそり囁く** | ホールカード配布等 |
| `Socket.io Room` | テーブルの**周囲** | そこにいる人だけ聞こえる範囲 |
| `cashOutPlayer` | **キャッシャー** | チップ→残高に換金 |

## 入店〜着席の流れ

```
1. 入口で会員証を見せる（authMiddleware）
   → 会員証OK → 入店許可
   → 会員証NG → 入店拒否

2. 受付名簿をチェック（activeConnections）
   → 「山田さん、もう店内にいますね？」
   → 前の体を追い出す（connection:displaced）
   → 名簿を新しい体に更新

3. フロアに声をかける「席ある？」（matchmaking:join）
   → フロアが手帳を見る「山田さん、今どこかに座ってる？」
   → 座ってたら先にその席を立たせる（unseatAndCashOut）

4. フロアが空き席を探す（getOrCreateTable）
   → 「3番テーブルに空きがあります、どうぞ」
   → 手帳に記録「山田さん → 3番テーブル」（setPlayerTable）

5. テーブルに座る（seatPlayer）
   → 椅子に体を紐づける（SeatInfo.socket = socket）
   → テーブルの周囲に入る（socket.join(room)）
   → ディーラー「新しいお客様です」（table:joined）
```

## ゲーム中

```
ディーラーがテーブル全員に：
  「フロップです ♠A ♥K ♦Q」（game:state → room全体にブロードキャスト）

ディーラーが個人にこっそり：
  「あなたのカードです」（game:hole_cards → emitToSocket）

ディーラーが特定の人に：
  「山田さん、あなたの番ですよ」（game:action_required → seat.socketに送信）
```

## 退席〜退店

```
「帰ります」（table:leave / disconnect）
  → 椅子から立つ（unseatPlayer）
  → テーブルの周囲から離れる（socket.leave(room)）
  → キャッシャーでチップを換金（cashOutPlayer）
  → フロアが手帳から消す（removePlayerFromTracking）
  → 受付名簿から消す（activeConnections.delete）
```

## FastFold = 高速テーブル移動

```
普通のテーブル：フォールドしても同じ席で次のハンドを待つ

FastFoldテーブル：フォールドした瞬間フロアが飛んでくる
  「お客様、別テーブルへどうぞ！」（handleFastFoldMove）
  → 今のテーブルから静かに立つ（unseatForFastFold）
  → チップを持ったまま別テーブルへ移動（movePlayerToNewTable）
  → 新しい椅子に座る
  → 即座に新しいハンドに参加

ハンド終了時も全員移動（onFastFoldReassign）
  → 全プレイヤーがチップを持って一斉に別テーブルへ
```

## 同一ユーザー単一接続（displaced）

```
変更前（バグあり）：
  山田さんが正面入口から入店（TabA）→ 3番テーブルに着席
  山田さんが裏口からも入店（TabB）→ もう1人の山田さんが5番テーブルに着席
  → フロアの手帳は「山田さん → 5番テーブル」に上書き
  → 3番テーブルの山田さんはゴースト化（誰も管理していない）

変更後（修正済み）：
  山田さんが正面入口から入店（TabA）→ 受付名簿に登録 → 3番テーブルに着席
  山田さんが裏口からも入店（TabB）→ 受付が名簿をチェック
  → 「山田さん、もう店内にいらっしゃいますね」
  → 前の山田さんに「別の入口から来た方を優先します」と通知（displaced）
  → 前の山田さんを退店させる（ただし椅子の片付けはしない）
  → 新しい山田さんがフロアに「席ある？」→ 手帳で3番テーブル発見
  → 3番テーブルの椅子を片付けてから新しい席に案内
```

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `server/src/modules/game/socket.ts` | ポーカールーム全体（受付名簿、入店フロー） |
| `server/src/modules/game/authMiddleware.ts` | 入口の会員証チェック |
| `server/src/modules/game/handlers.ts` | フロアマネージャーの仕事（案内・退席処理） |
| `server/src/modules/table/TableManager.ts` | フロアの手帳 |
| `server/src/modules/table/TableInstance.ts` | 個別テーブル（ディーラー） |
| `server/src/modules/table/helpers/PlayerManager.ts` | 椅子の管理 |
| `server/src/modules/table/helpers/BroadcastService.ts` | ディーラーの声 |
| `server/src/modules/game/fastFoldService.ts` | 高速テーブル移動フロー |
| `server/src/modules/auth/bankroll.ts` | キャッシャー |
