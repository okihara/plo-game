import { describe, it, expect } from 'vitest';
import { createInitialGameState, startNewHand } from '../gameEngine.js';
import {
  POSITION_LABELS_BY_PLAYER_COUNT,
  createSeatRingComparator,
  getPositionLabel,
  getPositionLabelsBySeat,
  sortSeatsFromDealer,
} from '../types.js';
import type { GameState } from '../types.js';

/** 指定席を空席にして n 人でハンドを開始する */
function startHandWith(playerCount: number, seatCount: number): GameState {
  const state = createInitialGameState(600, seatCount);
  for (let i = playerCount; i < seatCount; i++) {
    state.players[i].isSittingOut = true;
    state.players[i].chips = 0;
  }
  return startNewHand(state);
}

describe('ポジションラベルの単一の真実の源泉', () => {
  it('卓上（エンジン）の割り当てとハンド履歴の表示が 3〜9 人で一致する', () => {
    for (let playerCount = 3; playerCount <= 9; playerCount++) {
      const seatCount = playerCount <= 6 ? 6 : 9;
      const state = startHandWith(playerCount, seatCount);

      const seats = state.players
        .map((p, seat) => ({ p, seat }))
        .filter(({ p }) => !p.isSittingOut)
        .map(({ seat }) => seat);

      for (const seat of seats) {
        expect(
          getPositionLabel(seat, state.dealerPosition, seats),
          `${playerCount}人時の seat ${seat}`,
        ).toBe(state.players[seat].position);
      }
    }
  });

  it('4人時は卓上・履歴とも UTG（表示だけ CO になっていた不整合の回帰）', () => {
    const state = startHandWith(4, 6);
    const seats = [0, 1, 2, 3];
    const labels = seats.map(s => getPositionLabel(s, state.dealerPosition, seats));
    expect(labels).toContain('UTG');
    expect(labels).not.toContain('CO');
    expect(POSITION_LABELS_BY_PLAYER_COUNT[4]).toEqual(['BTN', 'SB', 'BB', 'UTG']);
  });
});

describe('getPositionLabelsBySeat', () => {
  it('9人卓の席 0-8 を BTN 起点のリング順にラベル付けする', () => {
    const seats = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const map = getPositionLabelsBySeat(0, seats);
    expect(seats.map(s => map.get(s))).toEqual([
      'BTN', 'SB', 'BB', 'UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO',
    ]);
  });

  it('ディーラーが席8でも席順が巻き戻る', () => {
    const seats = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const map = getPositionLabelsBySeat(8, seats);
    expect(map.get(8)).toBe('BTN');
    expect(map.get(0)).toBe('SB');
    expect(map.get(7)).toBe('CO');
  });

  it('ヘッズアップのラベルは呼び出し側で切り替えられる', () => {
    const seats = [2, 5];
    expect(getPositionLabel(2, 2, seats)).toBe('SB');
    expect(getPositionLabel(2, 2, seats, { headsUp: ['BTN/SB', 'BB'] })).toBe('BTN/SB');
    expect(getPositionLabel(5, 2, seats)).toBe('BB');
  });

  it('人数が表にないときは 6-max へフォールバックし、無効化もできる', () => {
    const seats = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(getPositionLabel(0, 0, seats)).toBe('BTN');
    expect(getPositionLabel(0, 0, seats, { fallbackTo6Max: false })).toBe('');
  });

  it('ディーラー不明・1人以下では空になる', () => {
    expect(getPositionLabel(0, -1, [0, 1, 2])).toBe('');
    expect(getPositionLabelsBySeat(0, [0]).size).toBe(0);
  });
});

describe('createSeatRingComparator', () => {
  it('BTN 起点で並べる', () => {
    expect(sortSeatsFromDealer([8, 0, 4, 6], 4)).toEqual([4, 6, 8, 0]);
  });

  it('shift=1 で SB 起点になる', () => {
    const compare = createSeatRingComparator(4, [8, 0, 4, 6], 1);
    expect([8, 0, 4, 6].sort(compare)).toEqual([6, 8, 0, 4]);
  });

  it('6人卓の並び順は 9人卓対応の前後で変わらない', () => {
    expect(sortSeatsFromDealer([0, 1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5, 0, 1, 2]);
  });
});
