# UI Design Concept - Lobby & Hand History

## コンセプト
上品な白と黒のミニマルデザイン。白背景に黒テキスト、3つのアクセント手法でメリハリをつける。

## カラーパレット
- **背景**: `bg-white`
- **テキスト（主）**: `text-black`, `text-black/70`
- **テキスト（副）**: `text-black/50`, `text-black/40`, `text-black/30`, `text-black/25`
- **ボーダー**: `border-black/20`（通常）, `border-black/25`（強調）, `border-black/30`〜`/40`（hover）
- **損益（プラス）**: `text-green-600`
- **損益（マイナス）**: `text-red-500`
- **カードスーツ**: h=`text-red-500`, d=`text-blue-500`, c=`text-green-700`, s=`text-black`

## アクセント手法

### 1. シャドウ
カードやボタンに立体感を与える。hover時にシャドウを強めてインタラクティブ感を出す。
- カード/ボタン: `shadow-sm hover:shadow-md`
- ミニカード: `shadow`
- ログインボタン: `shadow-md`
- ダイアログ: `shadow-2xl`

### 2. 黒塗りつぶし白文字ラベル
重要なラベルを黒背景で目立たせる。
- ゲームタイプバッジ（PLO）: `bg-black text-white font-bold rounded`
- ポジションバッジ（BTN/SB/BB等）: `bg-black text-white text-xs font-bold px-1.5 py-0.5 rounded`
- ストリートラベル（Preflop/Flop/Turn/River）: `bg-black text-white text-xs font-bold px-1.5 py-0.5 rounded`
- Resultラベル: 同上
- ログインボタン/補填ボタン: `bg-black text-white`

### 3. 大きめテキスト + 下線
セクション区切りや重要情報を強調。
- **タイトル下の黒バー**: `w-[12cqw] h-[0.5cqw] bg-black mx-auto`
- **セクションヘッダー下の黒バー**: `w-[8cqw] h-[0.4cqw] bg-black`
- **ヘッダーの太い下線**: `border-b-2 border-black`
- **自分のプレイヤー名**: `underline decoration-2 underline-offset-2`
- **大きめテキスト**: タイトル `8cqw`、ブラインド `5cqw`、セクション名 `4cqw`、ヘッダー `text-xl`

## 対象ページ
- `src/pages/SimpleLobby.tsx` - ロビー画面
- `src/pages/HandHistory.tsx` - ハンド履歴ページ
- `src/components/HandHistoryPanel.tsx` - ハンド履歴パネル（一覧＋詳細ダイアログ）

## 対象外（ダークテーマのまま）
- ゲーム画面（OnlineGame / PokerTable）
- 観戦画面（SpectatorView）
- ProfilePopup
