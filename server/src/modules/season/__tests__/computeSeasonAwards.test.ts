import { describe, it, expect } from 'vitest';
import { isAllInRunoutHand } from '../computeSeasonAwards.js';

const act = (action: string, street?: string) => ({ action, street });

describe('isAllInRunoutHand', () => {
  it('リバー前のオールインがコールされてランナウトしたら対象', () => {
    const actions = [act('raise', 'preflop'), act('allin', 'preflop'), act('call', 'preflop')];
    expect(isAllInRunoutHand(actions, 5, 2)).toBe(true);
  });

  it('全額コール（call 記録）で終わりリバーのアクションが無ければ対象', () => {
    const actions = [act('bet', 'flop'), act('call', 'flop')];
    expect(isAllInRunoutHand(actions, 5, 2)).toBe(true);
  });

  it('リバー前にオールインした人を残して他がリバーまで打ち合っても対象', () => {
    const actions = [act('allin', 'turn'), act('call', 'turn'), act('call', 'turn'), act('bet', 'river'), act('call', 'river')];
    expect(isAllInRunoutHand(actions, 5, 3)).toBe(true);
  });

  it('リバーでのオールインは対象外（ランナウトが無い）', () => {
    const actions = [act('check', 'turn'), act('allin', 'river'), act('call', 'river')];
    expect(isAllInRunoutHand(actions, 5, 2)).toBe(false);
  });

  it('リバーまで普通に打ち切ったハンドは対象外', () => {
    const actions = [act('call', 'preflop'), act('check', 'flop'), act('check', 'turn'), act('check', 'river')];
    expect(isAllInRunoutHand(actions, 5, 2)).toBe(false);
  });

  it('全員フォールドで終わったオールインは対象外', () => {
    const actions = [act('allin', 'preflop'), act('fold', 'preflop')];
    expect(isAllInRunoutHand(actions, 0, 0)).toBe(false);
    expect(isAllInRunoutHand(actions, 5, 1)).toBe(false);
  });

  it('street が無い古い履歴は対象外', () => {
    expect(isAllInRunoutHand([act('allin'), act('call')], 5, 2)).toBe(false);
  });
});
