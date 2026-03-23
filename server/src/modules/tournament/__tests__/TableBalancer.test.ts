import { describe, it, expect } from 'vitest';
import { TableBalancer } from '../TableBalancer.js';

describe('TableBalancer', () => {
  describe('initialAssignment', () => {
    it('プレイヤーを均等にテーブルに分配する', () => {
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const tables = TableBalancer.initialAssignment(playerIds, 6);

      // 8人÷6 = 2テーブル
      expect(tables).toHaveLength(2);
      // 全プレイヤーが割り当てられている
      const allPlayers = tables.flat();
      expect(allPlayers).toHaveLength(8);
      expect(new Set(allPlayers).size).toBe(8);
      // 各テーブルの差が1以内
      expect(Math.abs(tables[0].length - tables[1].length)).toBeLessThanOrEqual(1);
    });

    it('定員ぴったりの場合は1テーブル', () => {
      const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
      const tables = TableBalancer.initialAssignment(playerIds, 6);
      expect(tables).toHaveLength(1);
      expect(tables[0]).toHaveLength(6);
    });

    it('12人を6人テーブルに割り当て → 2テーブル×6人', () => {
      const playerIds = Array.from({ length: 12 }, (_, i) => `p${i}`);
      const tables = TableBalancer.initialAssignment(playerIds, 6);
      expect(tables).toHaveLength(2);
      expect(tables[0]).toHaveLength(6);
      expect(tables[1]).toHaveLength(6);
    });

    it('7人を6人テーブルに割り当て → 2テーブル (4人+3人)', () => {
      const playerIds = Array.from({ length: 7 }, (_, i) => `p${i}`);
      const tables = TableBalancer.initialAssignment(playerIds, 6);
      expect(tables).toHaveLength(2);
      // ラウンドロビンなので 4+3 か 3+4
      const sizes = tables.map(t => t.length).sort();
      expect(sizes).toEqual([3, 4]);
    });
  });

  describe('checkBalance', () => {
    it('テーブル1つなら何もしない', () => {
      const actions = TableBalancer.checkBalance(
        [{ tableId: 't1', playerCount: 4, isHandInProgress: false }],
        () => ['p1', 'p2', 'p3', 'p4'],
        6
      );
      expect(actions).toEqual([]);
    });

    it('テーブルを破壊できる場合は最少人数テーブルのプレイヤーを移動', () => {
      // 2テーブル: 5人 + 1人 → 6人は1テーブルに収まる
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 5, isHandInProgress: false },
          { tableId: 't2', playerCount: 1, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1', 'p2', 'p3', 'p4', 'p5'] : ['p6'],
        6
      );

      expect(actions).toHaveLength(1);
      expect(actions[0].fromTableId).toBe('t2');
      expect(actions[0].toTableId).toBe('t1');
      expect(actions[0].odId).toBe('p6');
    });

    it('ハンド中のテーブルからは移動しない', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 5, isHandInProgress: true },
          { tableId: 't2', playerCount: 1, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1', 'p2', 'p3', 'p4', 'p5'] : ['p6'],
        6
      );

      // t2(1人)を破壊したいが、t2はハンド中でないのでOK
      expect(actions).toHaveLength(1);
      expect(actions[0].fromTableId).toBe('t2');
    });

    it('破壊対象テーブルがハンド中の場合、ハンド中でないテーブルを破壊対象にする', () => {
      // 2テーブル: 5人(idle) + 1人(ハンド中)
      // t2(1人)が最少だがハンド中 → ソートでt1(idle)が破壊対象に選ばれる
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 5, isHandInProgress: false },
          { tableId: 't2', playerCount: 1, isHandInProgress: true },
        ],
        (id) => id === 't1' ? ['p1', 'p2', 'p3', 'p4', 'p5'] : ['p6'],
        6
      );

      // t1(idle)が破壊対象 → 5人をt2へ移動
      expect(actions).toHaveLength(5);
      expect(actions[0].fromTableId).toBe('t1');
      expect(actions[0].toTableId).toBe('t2');
    });

    it('全テーブルがハンド中なら破壊しない', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 5, isHandInProgress: true },
          { tableId: 't2', playerCount: 1, isHandInProgress: true },
        ],
        (id) => id === 't1' ? ['p1', 'p2', 'p3', 'p4', 'p5'] : ['p6'],
        6
      );

      expect(actions).toEqual([]);
    });

    it('プレイヤー差≥2で均等化のため移動する', () => {
      // 2テーブル: 5人 + 3人 (差=2)
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 5, isHandInProgress: false },
          { tableId: 't2', playerCount: 3, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1', 'p2', 'p3', 'p4', 'p5'] : ['p6', 'p7', 'p8'],
        6
      );

      // 全体8人、2テーブルに収まらない → テーブル破壊ではなくバランシング
      // (tables.length - 1) * 6 = 6、totalPlayers=8 > 6 → 破壊不可
      expect(actions).toHaveLength(1);
      expect(actions[0].fromTableId).toBe('t1');
      expect(actions[0].toTableId).toBe('t2');
    });

    it('プレイヤー差<2なら移動しない', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 4, isHandInProgress: false },
          { tableId: 't2', playerCount: 4, isHandInProgress: false },
        ],
        () => [],
        6
      );
      expect(actions).toEqual([]);
    });

    it('バランシング対象テーブルがハンド中なら移動しない', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 5, isHandInProgress: true },
          { tableId: 't2', playerCount: 3, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1', 'p2', 'p3', 'p4', 'p5'] : ['p6', 'p7', 'p8'],
        6
      );
      expect(actions).toEqual([]);
    });
  });
});
