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

    it('破壊対象卓がハンド中ならアクションは返さない', () => {
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

    it('人数最大卓がハンド中なら均等化移動はしない', () => {
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

  describe('checkBalance with maxTotalForBreak (レイト登録中)', () => {
    it('残り5人 (3+2) なら統合する', () => {
      // 2テーブル: 3+2=5人 → 5 ≤ maxTotalForBreak=5 で統合
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 3, isHandInProgress: false },
          { tableId: 't2', playerCount: 2, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1', 'p2', 'p3'] : ['p4', 'p5'],
        6,
        { maxTotalForBreak: 5 }
      );

      expect(actions).toHaveLength(2);
      expect(actions.every(a => a.fromTableId === 't2')).toBe(true);
      expect(actions.every(a => a.toTableId === 't1')).toBe(true);
    });

    it('残り5人 (1+4) なら統合する', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 1, isHandInProgress: false },
          { tableId: 't2', playerCount: 4, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1'] : ['p2', 'p3', 'p4', 'p5'],
        6,
        { maxTotalForBreak: 5 }
      );

      expect(actions).toHaveLength(1);
      expect(actions[0].fromTableId).toBe('t1');
      expect(actions[0].toTableId).toBe('t2');
    });

    it('残り6人 (4+2) は統合せず move-balance のみ', () => {
      // 6 > maxTotalForBreak=5 → 破壊しない
      // diff = 4 - 2 = 2 → 1人移動して 3+3 に
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 4, isHandInProgress: false },
          { tableId: 't2', playerCount: 2, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1', 'p2', 'p3', 'p4'] : ['p5', 'p6'],
        6,
        { maxTotalForBreak: 5 }
      );

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('move');
      expect(actions[0].fromTableId).toBe('t1');
      expect(actions[0].toTableId).toBe('t2');
    });

    it('残り6人 (3+3) は何もしない', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 3, isHandInProgress: false },
          { tableId: 't2', playerCount: 3, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1', 'p2', 'p3'] : ['p4', 'p5', 'p6'],
        6,
        { maxTotalForBreak: 5 }
      );
      expect(actions).toEqual([]);
    });

    it('残り4人 (2+2) なら統合する (両卓idle)', () => {
      // レイト中、両テーブルでほぼ同時にバストして 2-2 になったケース。
      // totalPlayers=4 ≤ maxTotalForBreak=5 で統合発火する。
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 2, isHandInProgress: false },
          { tableId: 't2', playerCount: 2, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1', 'p2'] : ['p3', 'p4'],
        6,
        { maxTotalForBreak: 5 }
      );

      // 破壊対象は人数同点なので最初のテーブル (t1) が選ばれる
      expect(actions).toHaveLength(2);
      expect(actions.every(a => a.type === 'break')).toBe(true);
      expect(actions.every(a => a.fromTableId === 't1')).toBe(true);
      expect(actions.every(a => a.toTableId === 't2')).toBe(true);
      expect(actions.map(a => a.odId).sort()).toEqual(['p1', 'p2']);
    });

    it('残り4人 (2+2) で片方ハンド中なら、idle 側を破壊して統合する', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 2, isHandInProgress: true },
          { tableId: 't2', playerCount: 2, isHandInProgress: false },
        ],
        (id) => id === 't1' ? ['p1', 'p2'] : ['p3', 'p4'],
        6,
        { maxTotalForBreak: 5 }
      );

      // sort で isHandInProgress=false を優先 → t2 が破壊対象
      expect(actions).toHaveLength(2);
      expect(actions.every(a => a.fromTableId === 't2')).toBe(true);
      expect(actions.every(a => a.toTableId === 't1')).toBe(true);
    });

    it('残り4人 (2+2) で両卓ハンド中なら、移動は保留する', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 2, isHandInProgress: true },
          { tableId: 't2', playerCount: 2, isHandInProgress: true },
        ],
        (id) => id === 't1' ? ['p1', 'p2'] : ['p3', 'p4'],
        6,
        { maxTotalForBreak: 5 }
      );

      // 両方ハンド中 → 次のハンド完了後に再チェックされるはず
      expect(actions).toEqual([]);
    });

    it('残り12人 (5+4+3) は本来3→2卓に統合可能だが、レイト中なら維持', () => {
      // (3-1)*6=12, totalPlayers=12 → 通常なら破壊可能
      // が maxTotalForBreak=5 で阻止される
      // diff = 5 - 3 = 2 → move-balance で 4+4+4 に近づく
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 5, isHandInProgress: false },
          { tableId: 't2', playerCount: 4, isHandInProgress: false },
          { tableId: 't3', playerCount: 3, isHandInProgress: false },
        ],
        (id) => {
          if (id === 't1') return ['p1', 'p2', 'p3', 'p4', 'p5'];
          if (id === 't2') return ['p6', 'p7', 'p8', 'p9'];
          return ['p10', 'p11', 'p12'];
        },
        6,
        { maxTotalForBreak: 5 }
      );

      // 破壊ではなく move（diff=2 で max→min へ1人）
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('move');
      expect(actions[0].fromTableId).toBe('t1');
      expect(actions[0].toTableId).toBe('t3');
    });

    // バグ報告 (tournamentId=46HiV79XbW5L) 再現:
    // レイト中に複数卓が minPlayersToStart 未満になり全卓 stuck したケース。
    // TournamentInstance 側で maxTotalForBreak 制約を外した呼び出しを想定し、
    // checkBalance が統合 action を返すことを確認する。
    it('5卓×2人 (合計10人) を options なしで呼ぶと統合される', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 2, isHandInProgress: false },
          { tableId: 't2', playerCount: 2, isHandInProgress: false },
          { tableId: 't3', playerCount: 2, isHandInProgress: false },
          { tableId: 't4', playerCount: 2, isHandInProgress: false },
          { tableId: 't5', playerCount: 2, isHandInProgress: false },
        ],
        (id) => {
          const map: Record<string, string[]> = {
            t1: ['p1', 'p2'], t2: ['p3', 'p4'], t3: ['p5', 'p6'],
            t4: ['p7', 'p8'], t5: ['p9', 'p10'],
          };
          return map[id] ?? [];
        },
        6
      );

      // canReduceTable: 10 ≤ (5-1)*6 = 24 → true → 統合 action が返る
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every(a => a.type === 'break')).toBe(true);
    });

    it('5卓×2人 でも maxTotalForBreak=5 が指定されると統合しない (バグの旧挙動)', () => {
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 2, isHandInProgress: false },
          { tableId: 't2', playerCount: 2, isHandInProgress: false },
          { tableId: 't3', playerCount: 2, isHandInProgress: false },
          { tableId: 't4', playerCount: 2, isHandInProgress: false },
          { tableId: 't5', playerCount: 2, isHandInProgress: false },
        ],
        (id) => {
          const map: Record<string, string[]> = {
            t1: ['p1', 'p2'], t2: ['p3', 'p4'], t3: ['p5', 'p6'],
            t4: ['p7', 'p8'], t5: ['p9', 'p10'],
          };
          return map[id] ?? [];
        },
        6,
        { maxTotalForBreak: 5 }
      );

      // 10 > maxTotalForBreak=5 で破壊不可、 diff=0 で move-balance も走らない
      // → 何もしない (これが旧挙動: 全卓 stuck の原因)
      expect(actions).toEqual([]);
    });

    it('オプション未指定なら従来通り破壊する', () => {
      // 12人 5+4+3 → (3-1)*6=12, 収まる → 破壊
      const actions = TableBalancer.checkBalance(
        [
          { tableId: 't1', playerCount: 5, isHandInProgress: false },
          { tableId: 't2', playerCount: 4, isHandInProgress: false },
          { tableId: 't3', playerCount: 3, isHandInProgress: false },
        ],
        (id) => {
          if (id === 't1') return ['p1', 'p2', 'p3', 'p4', 'p5'];
          if (id === 't2') return ['p6', 'p7', 'p8', 'p9'];
          return ['p10', 'p11', 'p12'];
        },
        6
      );

      // t3(最少) が破壊対象
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every(a => a.fromTableId === 't3')).toBe(true);
      expect(actions.every(a => a.type === 'break')).toBe(true);
    });
  });
});
