import { describe, it, expect } from 'vitest';
import {
  computeItmInfo,
  computeOrbitCost,
  computeStackMetrics,
  getAnteMode,
  getBigBlindUnit,
  getMZone,
  rankStandings,
  type BlindLevel,
} from '@plo/shared';

const level = (smallBlind: number, bigBlind: number, ante = 0): BlindLevel => ({
  level: 1,
  smallBlind,
  bigBlind,
  ante,
  durationMinutes: 5,
});

describe('getAnteMode', () => {
  it('PLO 系は ante なし', () => {
    expect(getAnteMode('plo')).toBe('none');
    expect(getAnteMode('plo5')).toBe('none');
    expect(getAnteMode('plo_hilo')).toBe('none');
    expect(getAnteMode('limit_holdem')).toBe('none');
  });

  it('bomb pot と Stud 系は全員が毎ハンド支払う', () => {
    expect(getAnteMode('plo_double_board_bomb')).toBe('all');
    expect(getAnteMode('stud')).toBe('all');
    expect(getAnteMode('razz')).toBe('all');
    expect(getAnteMode('stud_hilo')).toBe('all');
  });

  it('Draw 系は BB 席だけが支払う', () => {
    expect(getAnteMode('no_limit_2-7_single_draw')).toBe('bb');
    expect(getAnteMode('limit_2-7_triple_draw')).toBe('bb');
  });
});

describe('computeOrbitCost', () => {
  it('ante なしは sb + bb', () => {
    expect(computeOrbitCost(level(100, 200), 'plo', 6)).toBe(300);
  });

  it('BB アンティは1周に1回だけ加算する', () => {
    expect(computeOrbitCost(level(100, 200, 200), 'no_limit_2-7_single_draw', 6)).toBe(500);
  });

  it('全員アンティは席数ぶん加算する', () => {
    // bomb pot は sb=bb=0 / ante=N 表現
    expect(computeOrbitCost(level(0, 0, 200), 'plo_double_board_bomb', 6)).toBe(1200);
    expect(computeOrbitCost(level(50, 100, 25), 'stud', 8)).toBe(350);
  });

  it('tableSize が 0 でも 1席として扱う', () => {
    expect(computeOrbitCost(level(0, 0, 200), 'plo_double_board_bomb', 0)).toBe(200);
  });
});

describe('getBigBlindUnit', () => {
  it('通常は bigBlind', () => {
    expect(getBigBlindUnit(level(100, 200, 200))).toBe(200);
  });

  it('bomb pot (bigBlind=0) は ante にフォールバックする', () => {
    expect(getBigBlindUnit(level(0, 0, 300))).toBe(300);
  });

  it('どちらも 0 なら 0', () => {
    expect(getBigBlindUnit(level(0, 0, 0))).toBe(0);
  });
});

describe('getMZone', () => {
  it('境界値でゾーンが切り替わる', () => {
    expect(getMZone(20)).toBe('green');
    expect(getMZone(19.99)).toBe('yellow');
    expect(getMZone(10)).toBe('yellow');
    expect(getMZone(9.99)).toBe('orange');
    expect(getMZone(6)).toBe('orange');
    expect(getMZone(5.99)).toBe('red');
    expect(getMZone(1)).toBe('red');
    expect(getMZone(0.99)).toBe('dead');
  });
});

describe('computeStackMetrics', () => {
  it('BB 数・M・有効M・平均比を計算する', () => {
    const m = computeStackMetrics({
      chips: 30000,
      level: level(100, 200),
      variant: 'plo',
      tableSize: 6,
      averageStack: 20000,
    });
    expect(m.bigBlinds).toBeCloseTo(150, 6);
    expect(m.m).toBeCloseTo(100, 6);            // 30000 / 300
    expect(m.effectiveM).toBeCloseTo(60, 6);    // 100 * 6 / 10
    expect(m.zone).toBe('green');
    expect(m.averageStackRatio).toBeCloseTo(1.5, 6);
  });

  it('bomb pot は ante を BB 単位・M の分母に使う', () => {
    const m = computeStackMetrics({
      chips: 12000,
      level: level(0, 0, 200),
      variant: 'plo_double_board_bomb',
      tableSize: 6,
      averageStack: 12000,
    });
    expect(m.bigBlinds).toBeCloseTo(60, 6);   // 12000 / 200
    expect(m.m).toBeCloseTo(10, 6);           // 12000 / (200 * 6)
    expect(m.averageStackRatio).toBeCloseTo(1, 6);
  });

  it('averageStack が 0 でもゼロ除算しない', () => {
    const m = computeStackMetrics({
      chips: 5000,
      level: level(100, 200),
      variant: 'plo',
      tableSize: 6,
      averageStack: 0,
    });
    expect(m.averageStackRatio).toBe(0);
  });

  it('orbitCost が 0 でもゼロ除算しない', () => {
    const m = computeStackMetrics({
      chips: 5000,
      level: level(0, 0, 0),
      variant: 'plo',
      tableSize: 6,
      averageStack: 5000,
    });
    expect(m.bigBlinds).toBe(0);
    expect(m.m).toBe(0);
    expect(m.zone).toBe('dead');
  });
});

describe('computeItmInfo', () => {
  const payouts = [
    { position: 1, amount: 5000 },
    { position: 2, amount: 3000 },
    { position: 3, amount: 2000 },
  ];

  it('賞金未確定なら全部 0 / null', () => {
    const info = computeItmInfo(20, []);
    expect(info.paidPlaces).toBe(0);
    expect(info.isInTheMoney).toBe(false);
    expect(info.playersToItm).toBe(0);
    expect(info.bustNowPrize).toBe(0);
    expect(info.nextJumpPosition).toBeNull();
    expect(info.playersToNextJump).toBeNull();
  });

  it('バブル前は ITM までの人数と圏外賞金 0 を返す', () => {
    const info = computeItmInfo(10, payouts);
    expect(info.isInTheMoney).toBe(false);
    expect(info.playersToItm).toBe(7);
    expect(info.bustNowPosition).toBe(10);
    expect(info.bustNowPrize).toBe(0);
    // 圏外では「次のジャンプ = 入賞最下位」となり playersToItm と一致する
    expect(info.nextJumpPosition).toBe(3);
    expect(info.nextJumpPrize).toBe(2000);
    expect(info.playersToNextJump).toBe(7);
  });

  it('残り人数が入賞人数まで減ったら ITM 確定', () => {
    const info = computeItmInfo(3, payouts);
    expect(info.isInTheMoney).toBe(true);
    expect(info.playersToItm).toBe(0);
    expect(info.bustNowPrize).toBe(2000);
    expect(info.nextJumpPosition).toBe(2);
    expect(info.nextJumpPrize).toBe(3000);
    expect(info.playersToNextJump).toBe(1);
  });

  it('同額のスラブが隣接していても実際に増える位置まで遡る', () => {
    // 端数丸めで 3位と4位が同額になるケース。「1つ上＝必ずジャンプ」ではない
    const flat = [
      { position: 1, amount: 500 },
      { position: 2, amount: 300 },
      { position: 3, amount: 100 },
      { position: 4, amount: 100 },
    ];
    const info = computeItmInfo(4, flat);
    expect(info.bustNowPrize).toBe(100);
    expect(info.nextJumpPosition).toBe(2);
    expect(info.nextJumpPrize).toBe(300);
    expect(info.playersToNextJump).toBe(2);
  });

  it('残り1人（優勝確定）は次のジャンプが無い', () => {
    const info = computeItmInfo(1, payouts);
    expect(info.isInTheMoney).toBe(true);
    expect(info.bustNowPrize).toBe(5000);
    expect(info.nextJumpPosition).toBeNull();
    expect(info.nextJumpPrize).toBeNull();
    expect(info.playersToNextJump).toBeNull();
  });

  it('payouts が position 昇順でなくても正しく解釈する', () => {
    const shuffled = [payouts[2], payouts[0], payouts[1]];
    expect(computeItmInfo(3, shuffled)).toEqual(computeItmInfo(3, payouts));
  });
});

describe('rankStandings', () => {
  it('chips 降順に並べ替えて順位を付ける', () => {
    const ranked = rankStandings([
      { odId: 'b', chips: 100 },
      { odId: 'a', chips: 300 },
      { odId: 'c', chips: 200 },
    ]);
    expect(ranked.map(r => r.odId)).toEqual(['a', 'c', 'b']);
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3]);
  });

  it('同点は同順位、次はスキップする (1,2,2,4)', () => {
    const ranked = rankStandings([
      { odId: 'a', chips: 300 },
      { odId: 'b', chips: 200 },
      { odId: 'c', chips: 200 },
      { odId: 'd', chips: 100 },
    ]);
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('同点内は odId 昇順で安定する', () => {
    const rows = [
      { odId: 'zzz', chips: 200 },
      { odId: 'aaa', chips: 200 },
    ];
    expect(rankStandings(rows).map(r => r.odId)).toEqual(['aaa', 'zzz']);
    expect(rankStandings([...rows].reverse()).map(r => r.odId)).toEqual(['aaa', 'zzz']);
  });

  it('入力を破壊しない', () => {
    const rows = [
      { odId: 'b', chips: 100 },
      { odId: 'a', chips: 300 },
    ];
    rankStandings(rows);
    expect(rows.map(r => r.odId)).toEqual(['b', 'a']);
  });

  it('空配列は空配列', () => {
    expect(rankStandings([])).toEqual([]);
  });

  it('追加のフィールドを保持する', () => {
    const ranked = rankStandings([{ odId: 'a', chips: 100, name: 'Alice' }]);
    expect(ranked[0].name).toBe('Alice');
  });
});
