import { describe, it, expect } from 'vitest';
import { computeFlopHudIncrement } from '../statsComputation.js';

function a(odId: string, action: string, street: string) {
  return { seatIndex: 0, odId, action, amount: 0, street };
}

// プリフロップ: PFA がレイズ、A と B がコール
const preflop = [a('A', 'call', 'preflop'), a('PFA', 'raise', 'preflop'), a('B', 'call', 'preflop')];

describe('computeFlopHudIncrement', () => {
  it('PFA より先にベットするとドンク', () => {
    const actions = [...preflop, a('A', 'bet', 'flop'), a('PFA', 'call', 'flop'), a('B', 'fold', 'flop')];
    expect(computeFlopHudIncrement('A', actions)).toMatchObject({ donkCount: 1, donkOpportunity: 1 });
  });

  it('PFA より先にチェックするとドンク機会のみ', () => {
    const actions = [...preflop, a('A', 'check', 'flop'), a('PFA', 'check', 'flop'), a('B', 'check', 'flop')];
    expect(computeFlopHudIncrement('A', actions)).toMatchObject({ donkCount: 0, donkOpportunity: 1 });
  });

  it('先に他者がベットしていればドンク機会にならない', () => {
    const actions = [...preflop, a('B', 'bet', 'flop'), a('A', 'call', 'flop'), a('PFA', 'call', 'flop')];
    expect(computeFlopHudIncrement('A', actions)).toMatchObject({ donkOpportunity: 0 });
  });

  it('PFA のチェック後にベットすると BMCB', () => {
    const actions = [...preflop, a('A', 'check', 'flop'), a('PFA', 'check', 'flop'), a('B', 'bet', 'flop'), a('A', 'fold', 'flop'), a('PFA', 'fold', 'flop')];
    expect(computeFlopHudIncrement('B', actions)).toMatchObject({ bmcbCount: 1, bmcbOpportunity: 1, donkOpportunity: 0 });
  });

  it('PFA がベットしたら BMCB 機会にならない', () => {
    const actions = [...preflop, a('A', 'check', 'flop'), a('PFA', 'bet', 'flop'), a('B', 'call', 'flop'), a('A', 'fold', 'flop')];
    expect(computeFlopHudIncrement('B', actions)).toMatchObject({ bmcbOpportunity: 0 });
  });

  it('チェック後にベットを受けてレイズするとチェックレイズ', () => {
    const actions = [...preflop, a('A', 'check', 'flop'), a('PFA', 'bet', 'flop'), a('B', 'fold', 'flop'), a('A', 'raise', 'flop'), a('PFA', 'call', 'flop')];
    expect(computeFlopHudIncrement('A', actions)).toMatchObject({ checkRaiseCount: 1, checkRaiseOpportunity: 1 });
  });

  it('チェック後にベットを受けてコールするとチェックレイズ機会のみ', () => {
    const actions = [...preflop, a('A', 'check', 'flop'), a('PFA', 'bet', 'flop'), a('B', 'fold', 'flop'), a('A', 'call', 'flop')];
    expect(computeFlopHudIncrement('A', actions)).toMatchObject({ checkRaiseCount: 0, checkRaiseOpportunity: 1 });
  });

  it('全員チェックならチェックレイズ機会にならない', () => {
    const actions = [...preflop, a('A', 'check', 'flop'), a('PFA', 'check', 'flop'), a('B', 'check', 'flop')];
    expect(computeFlopHudIncrement('A', actions)).toMatchObject({ checkRaiseOpportunity: 0 });
  });

  it('フロップに参加していなければすべて 0', () => {
    const actions = [...preflop, a('A', 'check', 'flop'), a('PFA', 'check', 'flop')];
    expect(computeFlopHudIncrement('C', actions)).toEqual({
      donkCount: 0, donkOpportunity: 0, checkRaiseCount: 0, checkRaiseOpportunity: 0, bmcbCount: 0, bmcbOpportunity: 0,
    });
  });
});
