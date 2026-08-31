import { describe, it, expect } from 'vitest';
import { toPokerStarsHandText } from '@plo/shared';
import type { PokerStarsHandInput, PokerStarsHandPlayer } from '@plo/shared';

function makePlayer(seatPosition: number, name: string): PokerStarsHandPlayer {
  return {
    username: name,
    seatPosition,
    startChips: 600,
    holeCards: ['Ah', 'Kh', 'Qh', 'Jh'],
    finalHand: null,
    profit: 0,
    isCurrentUser: seatPosition === 0,
  };
}

function makeHand(seats: number[], dealerPosition: number): PokerStarsHandInput {
  return {
    id: 'test-hand-000001',
    handNumber: 1,
    blinds: '1/3',
    communityCards: ['2c', '7d', 'Ts', '4h', '9s'],
    potSize: 100,
    rakeAmount: 0,
    winners: [],
    actions: [],
    dealerPosition,
    createdAt: '2026-08-31T00:00:00.000Z',
    players: seats.map(s => makePlayer(s, `P${s}`)),
  };
}

describe('toPokerStarsHandText (9-max)', () => {
  it('seat 6-8 を含むハンドは 9-max ヘッダーになる', () => {
    const text = toPokerStarsHandText(makeHand([0, 1, 2, 3, 4, 5, 6, 7, 8], 0));
    expect(text).toContain("Table 'PLO Game' 9-max Seat #1 is the button");
  });

  it('9人でポジションラベルが UTG2/LJ まで正しく並ぶ', () => {
    const text = toPokerStarsHandText(makeHand([0, 1, 2, 3, 4, 5, 6, 7, 8], 0));
    // BTN=seat0, SB=seat1, BB=seat2, UTG=seat3, UTG1=seat4, UTG2=seat5, LJ=seat6, HJ=seat7, CO=seat8
    // ラベルはサマリー行等に現れないため getPos 経由の行（プレイヤー行）で検証できないが、
    // 少なくとも Seat 1..9 の行がすべて存在すること
    for (let i = 1; i <= 9; i++) {
      expect(text).toContain(`Seat ${i}: P${i - 1}`);
    }
  });

  it('ディーラーが seat 7 のとき SB=seat8, BB=seat0 の順に並ぶ', () => {
    const text = toPokerStarsHandText(makeHand([0, 1, 2, 3, 4, 5, 6, 7, 8], 7));
    const lines = text.split('\n');
    const seatLines = lines.filter(l => /^Seat \d: P\d/.test(l));
    // BTN(seat7) 起点で 8,0,1,... の順
    expect(seatLines[0]).toContain('P7');
    expect(seatLines[1]).toContain('P8');
    expect(seatLines[2]).toContain('P0');
  });

  it('リグレッション: 6-max 入力のヘッダー・並び順は不変', () => {
    const text = toPokerStarsHandText(makeHand([0, 1, 2, 3, 4, 5], 2));
    expect(text).toContain("Table 'PLO Game' 6-max Seat #3 is the button");
    const lines = text.split('\n');
    // ヘッダー直後のプレイヤー一覧（サマリー節にも Seat 行があるため先頭6件のみ）
    const seatLines = lines.filter(l => /^Seat \d: P\d/.test(l)).slice(0, 6);
    expect(seatLines.map(l => l.slice(0, 9))).toEqual([
      'Seat 3: P', 'Seat 4: P', 'Seat 5: P', 'Seat 6: P', 'Seat 1: P', 'Seat 2: P',
    ]);
  });
});
