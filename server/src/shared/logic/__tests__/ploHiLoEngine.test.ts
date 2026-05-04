// PLO Hi-Lo (PLO8) はエンジンとしては既存 PLO の gameEngine をそのまま使い、
// determineWinner のみ Hi-Lo split パスへ分岐する。
// このテストは「variant='plo_hilo' で動作すること」と「ショーダウンで
// hi-lo split が正しく起きること」を確認する最低限のスモークテスト。

import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  startNewHand,
  getValidActions,
  determineWinner,
} from '../gameEngine.js';
import type { GameState, Card } from '../types.js';

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

function createPLOHiLoState(chips = 1000): GameState {
  const state = createInitialGameState(chips);
  state.variant = 'plo_hilo';
  state.smallBlind = 1;
  state.bigBlind = 2;
  return state;
}

describe('PLO Hi-Lo (plo_hilo): hand setup', () => {
  it('startNewHand で 4 枚のホールカードが配られる', () => {
    const state = startNewHand(createPLOHiLoState());
    for (const p of state.players) {
      if (p.isSittingOut) continue;
      expect(p.holeCards).toHaveLength(4);
    }
  });

  it('preflop で BB がポストされ currentBet === bigBlind になる', () => {
    const state = startNewHand(createPLOHiLoState());
    expect(state.currentStreet).toBe('preflop');
    expect(state.currentBet).toBe(state.bigBlind);
  });

  it('Pot Limit のベット計算が動く（raise の minAmount < maxAmount）', () => {
    const state = startNewHand(createPLOHiLoState());
    const actions = getValidActions(state, state.currentPlayerIndex);
    const raise = actions.find(a => a.action === 'raise' || a.action === 'bet');
    expect(raise).toBeDefined();
    // pot limit では min と max が異なる（Fixed Limit なら同じ）
    expect(raise!.maxAmount).toBeGreaterThan(raise!.minAmount);
  });
});

/**
 * ショーダウン直前の手詰まり状態を直接構築する。
 * 全員 totalBetThisRound = stake で 1 つのメインポットになる。
 */
function buildShowdownState(opts: {
  community: Card[];
  initialChips?: number;
  playersConfig: Array<{ holeCards: Card[]; stake: number; folded?: boolean } | null>;
}): GameState {
  const initialChips = opts.initialChips ?? 1000;
  const state = createPLOHiLoState(initialChips);
  state.communityCards = opts.community;
  state.currentStreet = 'river';

  let pot = 0;
  for (let i = 0; i < 6; i++) {
    const cfg = opts.playersConfig[i];
    const p = state.players[i];
    if (!cfg) {
      p.isSittingOut = true;
      p.folded = true;
      p.hasActed = true;
      p.holeCards = [];
      p.totalBetThisRound = 0;
      p.chips = 0;
      continue;
    }
    p.holeCards = cfg.holeCards;
    p.totalBetThisRound = cfg.stake;
    p.folded = cfg.folded ?? false;
    pot += cfg.stake;
  }
  state.pot = pot;
  return state;
}

describe('PLO Hi-Lo (plo_hilo): showdown split', () => {
  it('ロー qualify しないとき、ハイ勝者が pot を全取りする', () => {
    // Board: 高いカードのみ → low qualify せず
    const community = [card('K', 's'), card('K', 'h'), card('Q', 'c'), card('J', 'd'), card('9', 'c')];
    // Player 0: AA + KK = ツーペア (KK ボード + AA ホール)
    // Player 1: 99 トリップス (board KK + Q-high)
    // Player 0 hole から AA、board から KK,Q → AAKK + Q
    const state = buildShowdownState({
      community,
      playersConfig: [
        { holeCards: [card('A', 'h'), card('A', 's'), card('T', 'h'), card('2', 'c')], stake: 100 },
        { holeCards: [card('9', 'h'), card('9', 's'), card('8', 'h'), card('7', 'c')], stake: 100 },
        null, null, null, null,
      ],
    });
    const result = determineWinner(state);
    expect(result.winners).toHaveLength(1);
    // ハイのみのケースでは hiLoType = 'high'
    expect(result.winners[0].hiLoType).toBe('high');
    expect(result.winners[0].amount).toBe(200);
  });

  it('別プレイヤーがハイとローを取り、pot がスプリットされる', () => {
    // Board: 2 4 6 T K → low 3 枚 (2,4,6) が出る
    const community = [card('2', 's'), card('4', 'h'), card('6', 'c'), card('T', 'd'), card('K', 'c')];
    // Player 0: A♥ 3♠ 7♠ 8♣
    //   ハイ: A,K + ボード = A-high (no pair)
    //   ロー: A♥3♠ + 2♠4♥6♣ = 6-4-3-2-A (6-low) ✓
    // Player 1: K♥ K♦ Q♣ J♣
    //   ハイ: K♥K♦ + 6♣T♦K♣ = trips KKK ← A-high より強い
    //   ロー: K のみ → qualify せず
    const state = buildShowdownState({
      community,
      playersConfig: [
        { holeCards: [card('A', 'h'), card('3', 's'), card('7', 's'), card('8', 'c')], stake: 100 },
        { holeCards: [card('K', 'h'), card('K', 'd'), card('Q', 'c'), card('J', 'c')], stake: 100 },
        null, null, null, null,
      ],
    });
    const result = determineWinner(state);
    expect(result.winners).toHaveLength(2);
    const total = result.winners.reduce((s, w) => s + w.amount, 0);
    expect(total).toBe(200);
    // それぞれ high と low を分け合う
    const types = result.winners.map(w => w.hiLoType).sort();
    expect(types).toEqual(['high', 'low']);
  });
});
