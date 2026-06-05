import { describe, it, expect } from 'vitest';
import { VariantAdapter } from '../VariantAdapter.js';
import { startDrawHand, getDrawValidActions } from '../../../../shared/logic/drawEngine.js';

// =========================================================================
//  Draw variants: ブラインドの扱い
//
//  - No-Limit Single Draw: ブラインド表の SB/BB をそのまま使う
//  - Fixed-Limit Triple Draw: SB/BB を small bet / big bet (big bet = SB×2) の
//    ラダーとして使うため、createGameState では SB×2 が維持される
// =========================================================================

describe('VariantAdapter - draw 系のブラインド', () => {
  it('NL 2-7 Single Draw はブラインド表の bigBlind をそのまま反映する', () => {
    const adapter = new VariantAdapter('no_limit_2-7_single_draw');
    // SB:BB が 1:2 でないスケジュール (例: 200/300)
    const state = adapter.createGameState(30000, 200, 300);

    expect(state.smallBlind).toBe(200);
    expect(state.bigBlind).toBe(300);
  });

  it('NL Single Draw: 配ったハンドで実 BB が投稿され、最小ベットが BB になる', () => {
    const adapter = new VariantAdapter('no_limit_2-7_single_draw');
    const started = startDrawHand(adapter.createGameState(30000, 200, 300));

    // currentBet（= BB）は 300
    expect(started.currentBet).toBe(300);
    expect(started.bigBlind).toBe(300);

    // 先頭プレイヤーのベット下限が BB(=300) になっている（NL）
    const actions = getDrawValidActions(started, started.currentPlayerIndex);
    const callOrRaise = actions.find(a => a.action === 'call' || a.action === 'raise');
    expect(callOrRaise).toBeDefined();
  });

  it('Fixed-Limit Triple Draw はベットラダー (big bet = SB×2) を維持する', () => {
    const adapter = new VariantAdapter('limit_2-7_triple_draw');
    // bigBlind に変な値を渡しても small bet/big bet ラダーは SB から導出される
    const state = adapter.createGameState(30000, 200, 999);

    expect(state.smallBlind).toBe(200);
    expect(state.bigBlind).toBe(400); // SB×2 を維持（引数の 999 は無視）
  });
});
