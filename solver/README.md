# PLO プリフロップソルバー

PLO (Pot Limit Omaha) のプリフロップ戦略を CFR (Counterfactual Regret Minimization) で計算する自前ソルバー。

## 構成

```
solver/
├── src/
│   ├── enumerate.ts    # ハンドクラスタ列挙（C(52,4)→16,432クラスタ）
│   ├── equity.ts       # エクイティ計算エンジン（5枚評価+モンテカルロ）
│   ├── testEquity.ts   # エクイティエンジンのテスト
│   ├── gameTree.ts     # 6maxプリフロップゲームツリー
│   ├── solve.ts        # CFRソルバー（正確なMCエクイティ版、低速）
│   └── solveFast.ts    # CFRソルバー（近似エクイティ版、高速）
└── data/               # 生成データ（.gitignore対象）
    ├── handClusters.json
    └── solverResult.json
```

## 実行方法

```bash
cd solver
npm install

# ステップ1: ハンドクラスタ列挙
npx tsx src/enumerate.ts

# ステップ2: ゲームツリー分析
npx tsx src/gameTree.ts

# ステップ3: CFR実行（高速版、約3分）
npx tsx src/solveFast.ts

# ステップ3': CFR実行（正確版、約40分）
npx tsx src/solve.ts
```

## アーキテクチャ

### ステップ1: ハンドクラスタ列挙

52枚から4枚を選ぶ全組み合わせ C(52,4) = 270,725 通りを、スート同型性（24通りの置換）で正規化し、16,432 のカノニカルクラスタに圧縮する。既存の `@plo/shared` の `preflopEquity.json` と同じキー形式を使用し、完全一致を確認済み。

### ステップ2: エクイティ計算

PLOのハンド評価エンジン。5枚ハンドを整数1つにエンコードして高速比較し、ホール4枚×ボード5枚の PLO 評価（C(4,2)×C(5,3)=60通り）を行う。モンテカルロでハンド A vs ハンド B のオールインエクイティを計算。

### ステップ3: ゲームツリー

6max PLO プリフロップのアクションツリーを構築。Pot Limit のレイズサイズ制約のもと、fold/call/raise(pot) の選択肢で完全なツリーを展開。

- 6max: 539,338 ノード / 250,270 情報セット
- HU (SB vs BB): ソルバー実行に使用

### ステップ4: CFR (Counterfactual Regret Minimization)

ヘッズアップ（SB vs BB）でナッシュ均衡に近似する戦略を計算。

**2つのバージョン:**

| | `solveFast.ts` | `solve.ts` |
|--|--|--|
| エクイティ | `eqA/(eqA+eqB)` 近似 | モンテカルロ (500回/ペア) |
| 速度 | ~3分 (500K iter) | ~40分 (50K iter) |
| 精度 | 低（近似エクイティ） | 中（MC分散あり） |

**高速版の結果 (500K iterations):**

```
SB Open:     Raise 42% | Limp 43% | Fold 15%
BB vs Raise: 3Bet 26%  | Call 67% | Fold 7%
SB EV: -0.05bb/hand
```

## 制限事項と今後の改善

1. **エクイティ精度**: 近似版は `eqA/(eqA+eqB)` で粗い。ペアワイズエクイティの前計算テーブル（~256MB）を作れば O(1) で正確な値が得られる
2. **ヘッズアップのみ**: 現在は SB vs BB のみ。6max 拡張にはハンド抽象化（クラスタリング）が必要
3. **収束**: 500K イテレーションではまだ完全収束していない。特に低頻度のアクション履歴で戦略がノイジー
4. **速度**: ペアワイズエクイティの前計算バッチを Rust で書けば桁違いに高速化可能

## 技術的背景

- PLO の Starting hand: C(52,4) = 270,725 通り → スート同型性で 16,432 クラスタ
- ペアワイズエクイティ: 16,432² / 2 ≈ 1.35 億ペア
- CFR: ナッシュ均衡を求める反復アルゴリズム。正の regret に比例した確率でアクションを選び（regret matching）、反復により戦略が均衡に収束する
