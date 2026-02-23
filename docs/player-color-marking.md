# プレイヤーカラーマーキング機能

## 概要
他プレイヤーのプロフィールポップアップから色タグを付与し、テーブル上のアバターに色ドットを表示する。データはlocalStorageに永続化。

## 4色
| 色名 | Hex |
|------|-----|
| Red | `#E05555` |
| Blue | `#4A90D9` |
| Green | `#45B06B` |
| Orange | `#E8943A` |

## 変更ファイル

### 1. 新規: `src/hooks/usePlayerColors.ts`
- `PlayerColor` 型 (`'red' | 'blue' | 'green' | 'orange'`)
- `PLAYER_COLORS` 配列、`PLAYER_COLOR_MAP` (色名→hex)
- `usePlayerColors()` フック: `useState` + localStorage (`plo-player-colors`)
  - `getColor(userId)` → `PlayerColor | null`
  - `setColor(userId, color | null)` → state & localStorage同時更新

### 2. `src/components/ProfilePopup.tsx`
- Props追加: `currentColor?: PlayerColor | null`, `onColorChange?: (color: PlayerColor | null) => void`
- Badgesセクション（118行目）の下、Statsセクション（144行目）の上にカラーピッカー行を追加
- `!isSelf && userId && onColorChange` の場合のみ表示
- 4色の丸ボタン (`w-[8cqw] h-[8cqw]`) + 選択時にクリアボタン（×）
- 選択中: `border-cream-900 scale-110 shadow-md`、未選択: `border-cream-300 opacity-60`
- 同じ色タップでトグル解除

### 3. `src/components/Player.tsx`
- Props追加: `colorMark?: string | null` (hex値)
- アバターの左上にカラードット表示
  - `absolute top-[-2cqw] left-[-2cqw] w-[6cqw] h-[6cqw] rounded-full`
  - `border-[0.5cqw] border-white/80 z-[25] shadow-sm`
  - Dealer Button（右上 `top-[-3cqw] right-[-3cqw]`）と干渉しない位置

### 4. `src/components/PokerTable.tsx`
- Props追加: `playerColorMarks?: Record<string, string>` (odId → hex)
- `Player` に `colorMark={player.odId ? playerColorMarks?.[player.odId] : undefined}` を渡す

### 5. `src/pages/OnlineGame.tsx`
- `usePlayerColors` をインポート・使用
- `playerColorMarks` を `useMemo` で `colors` → hex Mapに変換してPokerTableに渡す
- `ProfilePopup` に `currentColor` と `onColorChange` を渡す

### 6. `src/pages/SpectatorView.tsx`
- OnlineGameと同パターンで `usePlayerColors` を統合

## データフロー

```
usePlayerColors (hook)
  │
  ├── colors (state) ←→ localStorage('plo-player-colors')
  │
  ├──→ playerColorMarks (useMemo: odId → hex変換)
  │     └──→ PokerTable (prop: playerColorMarks)
  │           └──→ Player (prop: colorMark)
  │                 └──→ <div> カラードット表示
  │
  ├──→ getColor(odId) → currentColor
  │     └──→ ProfilePopup (prop: currentColor)
  │
  └──→ setColor(odId, color)
        └──→ ProfilePopup (prop: onColorChange)
```

## 注意事項
- ゲストプレイヤーやボットには `odId` がない場合がある → カラーピッカー非表示、ドットも非表示
- 自分自身（`isSelf=true`）にはカラーピッカーを表示しない
- ALL-INマーカー（左上 `top-[-4cqw] left-[-4cqw]`）とカラードットは重なる可能性あるが、ALL-INの方が大きいのでカラードットはその下に見える形

## 検証方法
1. `npm run dev` + `cd server && npm run dev` で起動
2. 他プレイヤーのアバターをタップ → カラーピッカー表示を確認
3. 色を選択 → テーブル上のアバター左上にドット表示を確認
4. 同じ色を再タップ → 解除を確認
5. ページリロード後もカラーが保持されていることを確認
6. 自分のプロフィールにはカラーピッカーが表示されないことを確認
7. `npm run build` でビルドエラーがないことを確認
