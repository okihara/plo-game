# PLO Poker Game

スマートフォン向けのPot Limit Omaha (PLO) ポーカーゲーム。

## 特徴

- 6-MAX テーブル
- CPU対戦（5人のAIプレイヤー）
- モバイルファーストのUI（GG Poker風デザイン）
- Pot Limit Omaha ルール（4枚のホールカード、2枚+3枚でハンドを作る）

## 開発

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev

# ビルド
npm run build
```

## 技術スタック

- TypeScript
- Vite
- Vanilla JS (フレームワークなし)

## ゲームルール

PLO (Pot Limit Omaha) は、テキサスホールデムの派生ゲームです。

- 各プレイヤーに4枚のホールカードが配られる
- 5枚のコミュニティカードが場に出る
- **必ず**ホールカードから2枚、コミュニティカードから3枚を使って5枚のハンドを作る
- ベットはポットリミット（最大ベット額はポットサイズまで）
