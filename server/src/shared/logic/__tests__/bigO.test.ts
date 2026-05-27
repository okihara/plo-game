// Big-O (big_o) は 5 ホールカード + Hi-Lo split (8-or-better) の PLO variant。
// エンジンは既存 PLO の gameEngine をそのまま使い、startNewHand では variant.holeCardCount=5 で
// 5 枚配り、determineWinner では plo_hilo と同じ Hi-Lo split パスに分岐する。
// このテストは「variant='big_o' で配布・ベット・ショーダウン分配が正しく動くこと」の最低限のスモークテスト。

import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  startNewHand,
  getValidActions,
  determineWinner,
} from '../gameEngine.js';
import { VariantAdapter } from '../../../modules/table/helpers/VariantAdapter.js';
import type { GameState, Card } from '../types.js';

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

function createBigOState(chips = 1000): GameState {
  const state = createInitialGameState(chips);
  state.variant = 'big_o';
  state.smallBlind = 1;
  state.bigBlind = 2;
  return state;
}

describe('Big-O (big_o): hand setup', () => {
  it('startNewHand で 5 枚のホールカードが配られる', () => {
    const state = startNewHand(createBigOState());
    for (const p of state.players) {
      if (p.isSittingOut) continue;
      expect(p.holeCards).toHaveLength(5);
    }
  });

  it('preflop で BB がポストされ currentBet === bigBlind になる', () => {
    const state = startNewHand(createBigOState());
    expect(state.currentStreet).toBe('preflop');
    expect(state.currentBet).toBe(state.bigBlind);
  });

  it('Pot Limit のベット計算が動く（raise の minAmount < maxAmount）', () => {
    const state = startNewHand(createBigOState());
    const actions = getValidActions(state, state.currentPlayerIndex);
    const raise = actions.find(a => a.action === 'raise' || a.action === 'bet');
    expect(raise).toBeDefined();
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
  const state = createBigOState(initialChips);
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

describe('Big-O (big_o): showdown split', () => {
  it('ロー qualify しないとき、ハイ勝者が pot を全取りする', () => {
    // Board: 高いカードのみ → low qualify せず (9 のみ low 候補だが 3 枚未満)
    const community = [card('K', 's'), card('K', 'h'), card('Q', 'c'), card('J', 'd'), card('9', 'c')];
    // 5 枚ホール: 余分な 1 枚を加えただけ
    const state = buildShowdownState({
      community,
      playersConfig: [
        { holeCards: [card('A', 'h'), card('A', 's'), card('T', 'h'), card('2', 'c'), card('5', 'd')], stake: 100 },
        { holeCards: [card('9', 'h'), card('9', 's'), card('8', 'h'), card('7', 'c'), card('6', 'd')], stake: 100 },
        null, null, null, null,
      ],
    });
    const result = determineWinner(state);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].hiLoType).toBe('high');
    expect(result.winners[0].amount).toBe(200);
  });

  it('別プレイヤーがハイとローを取り、pot がスプリットされる', () => {
    // Board: 2 4 6 T K → low 3 枚 (2,4,6) が出る
    const community = [card('2', 's'), card('4', 'h'), card('6', 'c'), card('T', 'd'), card('K', 'c')];
    // Player 0: 5 枚ホールに low draws を含む → A♥3♠ + 2♠4♥6♣ = 6-4-3-2-A (6-low)
    // Player 1: KK + 5 枚ホール → trips KKK (high)
    const state = buildShowdownState({
      community,
      playersConfig: [
        { holeCards: [card('A', 'h'), card('3', 's'), card('7', 's'), card('8', 'c'), card('9', 'd')], stake: 100 },
        { holeCards: [card('K', 'h'), card('K', 'd'), card('Q', 'c'), card('J', 'c'), card('T', 'h')], stake: 100 },
        null, null, null, null,
      ],
    });
    const result = determineWinner(state);
    expect(result.winners).toHaveLength(2);
    const total = result.winners.reduce((s, w) => s + w.amount, 0);
    expect(total).toBe(200);
    const types = result.winners.map(w => w.hiLoType).sort();
    expect(types).toEqual(['high', 'low']);
  });
});

describe('Big-O (big_o): VariantAdapter ハンド名表示', () => {
  it('ロー qualify 時は "Hi / Lo" 完全形を返す', () => {
    const community = [card('2', 's'), card('4', 'h'), card('6', 'c'), card('T', 'd'), card('K', 'c')];
    const state = buildShowdownState({
      community,
      playersConfig: [
        { holeCards: [card('A', 'h'), card('3', 's'), card('7', 's'), card('8', 'c'), card('9', 'd')], stake: 100 },
        { holeCards: [card('K', 'h'), card('K', 'd'), card('Q', 'c'), card('J', 'c'), card('T', 'h')], stake: 100 },
        null, null, null, null,
      ],
    });

    const adapter = new VariantAdapter('big_o');
    // Player 0 (low qualify あり) → "Hi / Lo"
    const name0 = adapter.evaluateHandName(state.players[0], state.communityCards);
    expect(name0).toContain(' / ');
    expect(name0.toLowerCase()).toMatch(/low/);

    // Player 1 (Hi only) → "Hi" 単体
    const name1 = adapter.evaluateHandName(state.players[1], state.communityCards);
    expect(name1).not.toContain(' / ');
    expect(name1.toLowerCase()).not.toMatch(/low/);
  });
});
