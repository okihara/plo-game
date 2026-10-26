import { describe, it, expect } from 'vitest';
import { computeHandHud } from '../hudStats.js';

// 6人卓・ディーラー席0: BTN=0, SB=1, BB=2, UTG=3, HJ=4, CO=5（odId は位置名）
const NAMES = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
const players = NAMES.map((odId, seatIndex) => ({ seatIndex, odId }));

function act(odId: string, action: string, amount = 0, street = 'preflop') {
  return { seatIndex: NAMES.indexOf(odId), odId, action, amount, street };
}
const flop = (odId: string, action: string, amount = 0) => act(odId, action, amount, 'flop');
const folds = (...ids: string[]) => ids.map(id => act(id, 'fold'));

function hud(actions: ReturnType<typeof act>[], odId: string) {
  return computeHandHud({ actions, dealerPosition: 0, players, smallBlind: 1, bigBlind: 2 }).get(odId)!;
}

describe('computeHandHud', () => {
  it('BB ウォークでも BB にハンド数が付く', () => {
    const h = hud(folds('UTG', 'HJ', 'CO', 'BTN', 'SB'), 'BB');
    expect(h.hands).toBe(1);
    expect(h.vpip).toEqual({ n: 0, d: 1 });
  });

  it('Steal: 前が全員降りた CO のオープン', () => {
    const actions = [...folds('UTG', 'HJ'), act('CO', 'raise', 7), ...folds('BTN', 'SB', 'BB')];
    expect(hud(actions, 'CO').steal).toEqual({ n: 1, d: 1 });
    // BTN は前にオープンがあるので機会なし
    expect(hud(actions, 'BTN').steal).toEqual({ n: 0, d: 0 });
  });

  it('BB vs オープン: 1人のオープン以外全員降りたときのフォールド / 3bet', () => {
    const fold = [...folds('UTG', 'HJ'), act('CO', 'raise', 7), ...folds('BTN', 'SB', 'BB')];
    expect(hud(fold, 'BB')).toMatchObject({ bbFoldVsOpen: { n: 1, d: 1 }, bb3BetVsOpen: { n: 0, d: 1 } });
    const threeBet = [...folds('UTG', 'HJ'), act('CO', 'raise', 7), ...folds('BTN', 'SB'), act('BB', 'raise', 22), act('CO', 'fold')];
    expect(hud(threeBet, 'BB')).toMatchObject({ bbFoldVsOpen: { n: 0, d: 1 }, bb3BetVsOpen: { n: 1, d: 1 } });
  });

  it('BB vs オープン: リンパーがいれば機会なし', () => {
    const actions = [act('UTG', 'call', 2), act('HJ', 'fold'), act('CO', 'raise', 9), ...folds('BTN', 'SB', 'BB', 'UTG')];
    expect(hud(actions, 'BB').bbFoldVsOpen).toEqual({ n: 0, d: 0 });
  });

  it('Fold to 3B / 4Bet と Fold to 4B（オールインの 4bet も数える）', () => {
    const actions = [
      ...folds('UTG', 'HJ'), act('CO', 'raise', 7), act('BTN', 'raise', 25), ...folds('SB', 'BB'),
      act('CO', 'allin', 193), act('BTN', 'fold'),
    ];
    expect(hud(actions, 'CO')).toMatchObject({ foldTo3Bet: { n: 0, d: 1 }, fourBet: { n: 1, d: 1 } });
    expect(hud(actions, 'BTN')).toMatchObject({ threeBet: { n: 1, d: 1 }, foldTo4Bet: { n: 1, d: 1 } });
  });

  it('自分がオープンしていない 4bet は 4Bet に数えない', () => {
    const actions = [...folds('UTG', 'HJ'), act('CO', 'raise', 7), act('BTN', 'raise', 25), act('SB', 'raise', 80), ...folds('BB', 'CO', 'BTN')];
    expect(hud(actions, 'SB').fourBet).toEqual({ n: 0, d: 0 });
    // CO は 3bet に応じる前に 4bet が入ったので Fold to 3B の機会なし
    expect(hud(actions, 'CO').foldTo3Bet).toEqual({ n: 0, d: 0 });
  });

  it('CB / Fold to CB: シングルレイズドポットのヘッズアップ', () => {
    const actions = [
      ...folds('UTG', 'HJ'), act('CO', 'raise', 7), act('BTN', 'call', 7), ...folds('SB', 'BB'),
      flop('CO', 'bet', 10), flop('BTN', 'fold'),
    ];
    expect(hud(actions, 'CO').cbet).toEqual({ n: 1, d: 1 });
    expect(hud(actions, 'BTN').foldToCbet).toEqual({ n: 1, d: 1 });
    expect(hud(actions, 'BTN').donk).toEqual({ n: 0, d: 0 });
  });

  it('CB: マルチウェイは機会なし', () => {
    const actions = [
      ...folds('UTG', 'HJ'), act('CO', 'raise', 7), act('BTN', 'call', 7), act('SB', 'fold'), act('BB', 'call', 5),
      flop('BB', 'check'), flop('CO', 'bet', 10), ...['BTN', 'BB'].map(id => flop(id, 'fold')),
    ];
    expect(hud(actions, 'CO').cbet).toEqual({ n: 0, d: 0 });
  });

  it('3Bet CB と、レイザーより先に行動したコーラーのドンク機会', () => {
    const actions = [
      ...folds('UTG', 'HJ'), act('CO', 'raise', 7), act('BTN', 'raise', 25), ...folds('SB', 'BB'), act('CO', 'call', 18),
      flop('CO', 'check'), flop('BTN', 'bet', 30), flop('CO', 'fold'),
    ];
    expect(hud(actions, 'BTN').threeBetCbet).toEqual({ n: 1, d: 1 });
    expect(hud(actions, 'CO').donk).toEqual({ n: 0, d: 1 });
    expect(hud(actions, 'CO').checkRaise).toEqual({ n: 0, d: 1 });
  });

  it('Donk: レイザーより先にベット', () => {
    const actions = [
      ...folds('UTG', 'HJ'), act('CO', 'raise', 7), ...folds('BTN', 'SB'), act('BB', 'call', 5),
      flop('BB', 'bet', 10), flop('CO', 'fold'),
    ];
    expect(hud(actions, 'BB').donk).toEqual({ n: 1, d: 1 });
  });

  it('XR: チェックしてベットを受けてからのレイズ', () => {
    const actions = [
      ...folds('UTG', 'HJ'), act('CO', 'raise', 7), ...folds('BTN', 'SB'), act('BB', 'call', 5),
      flop('BB', 'check'), flop('CO', 'bet', 10), flop('BB', 'raise', 40), flop('CO', 'fold'),
    ];
    expect(hud(actions, 'BB').checkRaise).toEqual({ n: 1, d: 1 });
  });

  it('BMCB: レイザーのチェック後にベット', () => {
    const actions = [
      ...folds('UTG', 'HJ'), act('CO', 'raise', 7), act('BTN', 'call', 7), ...folds('SB', 'BB'),
      flop('CO', 'check'), flop('BTN', 'bet', 10), flop('CO', 'fold'),
    ];
    expect(hud(actions, 'BTN').bmcb).toEqual({ n: 1, d: 1 });
    expect(hud(actions, 'CO').foldToCbet).toEqual({ n: 0, d: 0 });
  });

  it('VPIP / PFR / 3Bet', () => {
    const actions = [act('UTG', 'call', 2), act('HJ', 'raise', 9), act('CO', 'raise', 30), ...folds('BTN', 'SB', 'BB', 'UTG', 'HJ')];
    expect(hud(actions, 'UTG')).toMatchObject({ vpip: { n: 1, d: 1 }, pfr: { n: 0, d: 1 }, threeBet: { n: 0, d: 0 } });
    expect(hud(actions, 'CO')).toMatchObject({ vpip: { n: 1, d: 1 }, pfr: { n: 1, d: 1 }, threeBet: { n: 1, d: 1 } });
    expect(hud(actions, 'BB').vpip).toEqual({ n: 0, d: 1 });
  });
});
