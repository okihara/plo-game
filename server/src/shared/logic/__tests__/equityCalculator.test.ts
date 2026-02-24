import { describe, it, expect } from 'vitest';
import { calculateEquities, calculateAllInEVProfits, SidePot } from '../equityCalculator.js';
import type { Card } from '../types.js';

// ヘルパー: カード文字列をCardオブジェクトに変換 (例: "Ah" → { rank: 'A', suit: 'h' })
function c(str: string): Card {
  return { rank: str[0] as Card['rank'], suit: str[1] as Card['suit'] };
}

describe('calculateEquities', () => {
  it('プレイヤーが1人なら equity = 1.0', () => {
    const equities = calculateEquities(
      [c('Ah'), c('Kd'), c('Qc'), c('Js'), c('Th')],
      [{ playerId: 0, holeCards: [c('9h'), c('8h'), c('7h'), c('6h')] }],
    );
    expect(equities.get(0)).toBe(1.0);
  });

  it('プレイヤーが0人なら空Map', () => {
    const equities = calculateEquities(
      [c('Ah'), c('Kd'), c('Qc'), c('Js'), c('Th')],
      [],
    );
    expect(equities.size).toBe(0);
  });

  it('ボード完成済み（5枚）で勝者を正しく判定', () => {
    // P0: ナッツフラッシュ (Ah使用), P1: ペア程度
    const board = [c('2h'), c('5h'), c('9h'), c('Kc'), c('3d')];
    const equities = calculateEquities(board, [
      { playerId: 0, holeCards: [c('Ah'), c('Th'), c('Jc'), c('Qc')] }, // ハートフラッシュ
      { playerId: 1, holeCards: [c('Kd'), c('Ks'), c('4c'), c('6c')] }, // キングスリーカード
    ]);
    expect(equities.get(0)).toBe(1.0);
    expect(equities.get(1)).toBe(0.0);
  });

  it('ボード完成済みでチョップの場合 equity = 0.5', () => {
    // 両者同ランクのホールカード → PLOでもチョップ
    const board = [c('2h'), c('5d'), c('9c'), c('Kh'), c('3s')];
    const equities = calculateEquities(board, [
      { playerId: 0, holeCards: [c('Ah'), c('As'), c('Jc'), c('Tc')] }, // AA
      { playerId: 1, holeCards: [c('Ad'), c('Ac'), c('Jd'), c('Td')] }, // AA（同ランク）
    ]);
    expect(equities.get(0)).toBe(0.5);
    expect(equities.get(1)).toBe(0.5);
  });

  it('リバー（4枚）で完全列挙して合理的なequityを返す', () => {
    const board = [c('Ah'), c('Kh'), c('Qh'), c('2d')]; // 4枚
    const equities = calculateEquities(board, [
      { playerId: 0, holeCards: [c('Jh'), c('Th'), c('3c'), c('4c')] }, // フラッシュ+ストレート完成
      { playerId: 1, holeCards: [c('As'), c('Ad'), c('5c'), c('6c')] }, // ペア
    ]);
    // P0はすでにフラッシュ完成しているので高いequity
    const eq0 = equities.get(0)!;
    const eq1 = equities.get(1)!;
    expect(eq0 + eq1).toBeCloseTo(1.0, 5);
    expect(eq0).toBeGreaterThan(0.5);
  });

  it('equityの合計が1.0になる（3人）', () => {
    const board = [c('Ah'), c('Kd'), c('Qc'), c('Js'), c('Th')];
    const equities = calculateEquities(board, [
      { playerId: 0, holeCards: [c('9h'), c('8h'), c('2c'), c('3c')] },
      { playerId: 1, holeCards: [c('9d'), c('8d'), c('4c'), c('5c')] },
      { playerId: 2, holeCards: [c('9c'), c('8c'), c('6d'), c('7d')] },
    ]);
    const total = (equities.get(0) ?? 0) + (equities.get(1) ?? 0) + (equities.get(2) ?? 0);
    expect(total).toBeCloseTo(1.0, 5);
  });
});

describe('calculateAllInEVProfits', () => {
  it('2人のシンプルなオールイン: メインポットのみ', () => {
    const board = [c('Ah'), c('Kd'), c('Qc'), c('Js'), c('Th')];
    // P0: ストレート (9使用), P1: ワンペア
    const allPlayers = [
      { playerId: 0, holeCards: [c('9h'), c('8h'), c('2c'), c('3c')], folded: false },
      { playerId: 1, holeCards: [c('Ad'), c('5d'), c('4c'), c('6c')], folded: false },
    ];
    const sidePots: SidePot[] = [{ amount: 200, eligiblePlayers: [0, 1] }];
    const totalBets = new Map([[0, 100], [1, 100]]);

    const profits = calculateAllInEVProfits(board, allPlayers, sidePots, totalBets);

    // P0はストレート完成で勝ち → equity≈1.0 → EV profit ≈ 100
    expect(profits.get(0)).toBe(100);
    expect(profits.get(1)).toBe(-100);
  });

  it('フォールド済みプレイヤーはEV計算から除外', () => {
    const board = [c('Ah'), c('Kd'), c('Qc'), c('Js'), c('Th')];
    const allPlayers = [
      { playerId: 0, holeCards: [c('9h'), c('8h'), c('2c'), c('3c')], folded: false },
      { playerId: 1, holeCards: [c('Ad'), c('5d'), c('4c'), c('6c')], folded: true },
      { playerId: 2, holeCards: [c('2d'), c('3d'), c('4d'), c('5s')], folded: false },
    ];
    // P1が100ベットしてフォールド済み、ポットにP1の分も含まれる
    const sidePots: SidePot[] = [{ amount: 300, eligiblePlayers: [0, 2] }];
    const totalBets = new Map([[0, 100], [2, 100]]);

    const profits = calculateAllInEVProfits(board, allPlayers, sidePots, totalBets);

    // P1はフォールド済み → profitsに含まれない
    expect(profits.has(1)).toBe(false);
    // P0とP2のEV利益合計 = ポット(300) - P0ベット(100) - P2ベット(100) = 100（P1のデッドマネー分）
    expect((profits.get(0) ?? 0) + (profits.get(2) ?? 0)).toBe(100);
  });

  it('uncontested pot（対象者1人）は全額そのプレイヤーに', () => {
    const board = [c('Ah'), c('Kd'), c('Qc'), c('Js'), c('Th')];
    const allPlayers = [
      { playerId: 0, holeCards: [c('9h'), c('8h'), c('2c'), c('3c')], folded: false },
      { playerId: 1, holeCards: [c('Ad'), c('5d'), c('4c'), c('6c')], folded: false },
    ];
    // P0はショートスタック: メインポット100, サイドポット50はP1のみ
    const sidePots: SidePot[] = [
      { amount: 100, eligiblePlayers: [0, 1] },
      { amount: 50, eligiblePlayers: [1] },
    ];
    const totalBets = new Map([[0, 50], [1, 100]]);

    const profits = calculateAllInEVProfits(board, allPlayers, sidePots, totalBets);

    // P1のサイドポット50は無条件で獲得
    // メインポット100はP0が勝つ（ストレート）
    // P0: 100 - 50 = 50, P1: 50 - 100 = -50
    expect(profits.get(0)).toBe(50);
    expect(profits.get(1)).toBe(-50);
  });

  it('サイドポット構造でのEV計算（3人、異なるスタック）', () => {
    // ボード完成済みで確定的な結果
    const board = [c('2h'), c('5d'), c('9c'), c('Kh'), c('3s')];
    const allPlayers = [
      { playerId: 0, holeCards: [c('Ah'), c('As'), c('Jc'), c('Tc')], folded: false }, // AA
      { playerId: 1, holeCards: [c('Kd'), c('Ks'), c('Qd'), c('Qc')], folded: false }, // KK（ボードのKでスリーカード）
      { playerId: 2, holeCards: [c('7h'), c('7d'), c('8h'), c('8d')], folded: false }, // 77/88
    ];
    // P0: 30投入, P1: 70投入, P2: 100投入
    // メインポット: 90 (30*3, 全員eligible)
    // サイドポット1: 80 (40*2, P1,P2 eligible)
    // サイドポット2: 30 (30*1, P2のみ eligible)
    const sidePots: SidePot[] = [
      { amount: 90, eligiblePlayers: [0, 1, 2] },
      { amount: 80, eligiblePlayers: [1, 2] },
      { amount: 30, eligiblePlayers: [2] },
    ];
    const totalBets = new Map([[0, 30], [1, 70], [2, 100]]);

    const profits = calculateAllInEVProfits(board, allPlayers, sidePots, totalBets);

    // profit合計 = 0（ゼロサム）
    const total = (profits.get(0) ?? 0) + (profits.get(1) ?? 0) + (profits.get(2) ?? 0);
    expect(total).toBe(0);

    // P2のuncontested pot(30)は確実に獲得
    // メインポットとサイドポット1はエクイティに基づく
    expect(profits.has(0)).toBe(true);
    expect(profits.has(1)).toBe(true);
    expect(profits.has(2)).toBe(true);
  });

  it('ホールカードが4枚未満のプレイヤーは除外', () => {
    const board = [c('Ah'), c('Kd'), c('Qc'), c('Js'), c('Th')];
    const allPlayers = [
      { playerId: 0, holeCards: [c('9h'), c('8h'), c('2c'), c('3c')], folded: false },
      { playerId: 1, holeCards: [c('Ad'), c('5d')], folded: false }, // 2枚しかない
    ];
    const sidePots: SidePot[] = [{ amount: 200, eligiblePlayers: [0, 1] }];
    const totalBets = new Map([[0, 100], [1, 100]]);

    const profits = calculateAllInEVProfits(board, allPlayers, sidePots, totalBets);

    // P1はカード不足で除外 → P0がuncontestedで全取り
    expect(profits.get(0)).toBe(100);
    expect(profits.has(1)).toBe(false);
  });
});
