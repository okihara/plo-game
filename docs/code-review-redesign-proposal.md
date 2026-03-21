# コードベースのみからの再設計案

> 既存ドキュメント（CLAUDE.md 等）に頼らず、コード構造から把握した内容に基づく再設計のメモ。  
> より包括的な案は [architecture-redesign.md](./architecture-redesign.md)（Actor / ステートマシン / Zustand 等）を参照。

## 1. アーキテクチャ方針

### 1.1 状態の一本化（ClientGameState の廃止）

**現状**

- サーバー: `GameState` → `StateTransformer` → `ClientGameState`
- クライアント: `ClientGameState` + `holeCards` → `convertClientStateToGameState` → `GameState`

`ClientGameState` と `GameState` の変換が二重にあり、`OnlinePlayer` ↔ `Player` の変換ロジックも重複している。

**再設計案**

- **プロトコル層を一つにする**: サーバーが送る payload を「クライアント用の正規形」として定義し、それをクライアントがそのまま使う。
- `ClientGameState` を中心にし、`Player` は使わない。表示用の `ViewPlayer` などを導出するだけにする。
- 変換を一箇所に寄せ、`@plo/shared` の `protocol.ts` で「サーバー→クライアントの型」を一元管理する。

### 1.2 型・プロトコルの一元化

**現状**

- `packages/shared/protocol.ts` と `server/shared/types/websocket.ts` が重複
- フロントの `src/logic/*` はほぼ `@plo/shared` の re-export

**再設計案**

- `@plo/shared` を唯一の型ソースにし、`protocol.ts` に C2S/S2C イベントと payload 型を集約する。
- `server/shared/types/websocket.ts` は廃止し、`@plo/shared` を参照するだけにする。
- フロントは `@plo/shared` を直接 import し、`src/logic/` の re-export 層をやめる。

---

## 2. モジュール分割

### 2.1 TableInstance の分解（サーバー）

**現状**: `TableInstance` が約 970 行で、ハンド進行・HORSE・FastFold・showdown/run-out・ブロードキャスト・タイマー・履歴などが同居。

**再設計案**

```
TableInstance（薄いコントローラ）
  ├── HandRunner         # ストリート進行・アクション受理
  ├── BroadcastAdapter   # イベント配信の集約
  ├── VariantAdapter     # 既存（維持）
  └── TableCoordinator   # マッチング・FF・HORSE 等の「テーブル外」の流れ
```

イベント駆動にし、`HandRunner` が `street_complete` などを emit し、`TableInstance` がそれに応じて `BroadcastAdapter` や次ハンド開始を制御する構成にすると責務分離しやすい。

### 2.2 useOnlineGameState の分解（フロント）

**現状**: 400 行超で接続・マッチメイキング・状態変換・アニメーション（`lastActions`, `showdownHandNames`, `isDealingCards` 等）・タイマー・サウンドが混在。

**再設計案**

- `useWebSocketConnection` … 接続・切断・`connection:established`
- `useTableSession` … マッチング参加・離脱、`table:joined` / `table:left`
- `useGameState` … `game:state` / `game:hole_cards` の購読と、受け取った payload をそのまま保持（変換ロジックを削減）
- `useActionFeedback` … `lastActions`, `showdownHandNames`, サウンド再生、アニメーション用フラグ
- `useActionTimeout` … アクションタイムアウト

ページコンポーネント側はこれらを組み合わせるだけにし、1 フックに責務を集中させない。

### 2.3 OnlineGame の分割

**現状**: 1 画面に多くの責務が詰め込まれている。

**再設計案**

- `OnlineGameLayout` … レイアウトのみ
- `GameHeader` … ブラインド・バリアント・設定・履歴ボタン
- `GameTable` … PokerTable + CommunityCards のコンテナ
- `GameActionBar` … ActionPanel + MyCards
- `GameOverlays` … Connecting, Searching, Busted, HandAnalysis などのオーバーレイ

ロジックは上記のフック群に寄せ、画面コンポーネントは「フックを使う + 子コンポーネントを並べる」だけにする。

---

## 3. ルーティング

**現状**: `main.tsx` の `App` で `pathname` ベースに手動でページを切り替え。

**再設計案**

- **React Router** を導入し、ルート定義をコンポーネント単位で分離する。
- 画面ごとに `lazy()` して code-splitting し、履歴・プロフィールなどは初回ロードを軽くする。
- プライベートテーブル `/private/:code` などはルート定義として明示する。

---

## 4. バリアント対応の整理

**現状**: フロントの variant 分岐が `OnlineGame` やコンポーネントに散在（`evaluateCurrentHand`, `isDrawStreet`, `getVariantConfig` 等）。

**再設計案**

- `@plo/shared` の `VARIANT_CONFIGS` を拡張し、バリアントごとの「表示名・評価関数・ストリート判定」を登録できるようにする。
- フロントは「variant → config」で取りに行くだけにし、分岐を減らす。
- `ActionPanel` のバリアント分岐（PLO / Stud / Draw / Limit）は、config からコンポーネントを引くようにする。

---

## 5. ディレクトリ構成イメージ

```
plo-game/
├── packages/
│   └── shared/                 # 唯一の型・プロトコル・評価
│       ├── types.ts
│       ├── protocol.ts         # C2S/S2C + ClientGameState 等
│       ├── deck.ts
│       ├── handEvaluator.ts
│       └── variantConfig.ts    # バリアント→評価・UI のマッピング
│
├── apps/
│   ├── web/                    # フロント（現 src/）
│   │   ├── routes/             # ページコンポーネント + ルート定義
│   │   ├── components/
│   │   ├── hooks/              # 細かく分割した hooks
│   │   └── services/
│   │
│   └── server/                 # バックエンド
│       └── modules/
│           ├── table/
│           │   ├── TableInstance.ts      # 薄い
│           │   ├── HandRunner.ts
│           │   ├── BroadcastAdapter.ts
│           │   └── helpers/
│           └── game/
│
└── pnpm-workspace.yaml
```

`src/logic` や `server/shared/logic` の再エクスポートは廃止し、`@plo/shared` のみを型・ロジックのソースにする。

---

## 6. 段階的リファクタの優先順位

1. **プロトコル・型の一元化** — `protocol.ts` を正とし、`ClientGameState` を中心にクライアントを書き換え、変換ロジックを削る。
2. **useOnlineGameState の分割** — 接続・テーブル・ゲーム状態・アクションフィードバックを別フックにし、`OnlineGame` の肥大化を抑える。
3. **TableInstance の責務分離** — `HandRunner` のような「ハンド進行専用クラス」を切り出し、`TableInstance` は組み合わせ役にする。
4. **React Router 導入** — ルート定義を明確にし、パスごとの分割ロードで初期表示を軽くする。

---

## 7. 意図して変えないもの

- **サーバーオーソリティ**: ゲームの正はサーバーの `GameState` のまま
- **VariantAdapter の方向性**: バリアントごとのエンジン切り替えは維持
- **Socket.io + ルーム**: 現状のリアルタイム設計を活用
- **@plo/shared**: 共有パッケージは維持し、責務をさらに明確にする

---

## 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [architecture-redesign.md](./architecture-redesign.md) | Actor パターン、純粋ステートマシン、Zustand、FastFold ライフサイクル、DB 正規化などより広い再設計案 |
