# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PLOポーカーゲーム - スマートフォン向けPot Limit Omaha実装。プレイヤー1人 vs CPU 5人の6-MAXテーブル形式。

## Development Commands

```bash
npm install      # 依存関係インストール
npm run dev      # 開発サーバー起動（ホットリロード対応）
npm run build    # TypeScriptチェック + 本番ビルド
npm run preview  # 本番ビルドのプレビュー
```

## Tech Stack

- TypeScript (strict mode)
- Vite (ビルドツール)
- Vanilla JS (フレームワークなし)
- CSS-in-JS (styles.ts)

## Architecture

### コアモジュール

- **main.ts** - エントリーポイント。ゲームループ、イベントハンドリング、レンダリング統合
- **gameEngine.ts** - ポーカーロジック。状態管理、アクション処理、ハンド進行
- **cpuAI.ts** - CPU対戦AI。ハンド強度評価、ポジションボーナス、ポットオッズ計算
- **handEvaluator.ts** - PLOハンド評価。必須ルール: ホール2枚 + コミュニティ3枚
- **deck.ts** - カード操作。デッキ作成、シャッフル、配布
- **ui.ts** - UI描画。カード、プレイヤー、アクションパネル
- **styles.ts** - CSSスタイル全体
- **types.ts** - TypeScript型定義

### ゲームフロー

1. 6人プレイヤー初期化（人間1、AI 5）
2. ハンド開始: シャッフル、4枚ずつ配布
3. ベッティングラウンド: preflop → flop → turn → river
4. ショーダウン: PLOハンド評価
5. 勝者決定・ポット分配
6. ディーラーボタン回転して次のハンド

### 設計パターン

- **Immutable state**: GameStateは不変として扱い、新しい状態を返す
- **Pure functions**: ゲームロジックはUIから独立
- **Async CPU**: `scheduleNextCPUAction()`で思考時間をシミュレート（800-2000ms）
