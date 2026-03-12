import { describe, it, expect } from 'vitest';
import {
  createLimitHoldemGameState,
  startLimitHoldemHand,
  getLimitHoldemValidActions,
  applyLimitHoldemAction,
  wouldLimitHoldemAdvanceStreet,
  determineLimitHoldemWinner,
} from '../limitHoldemEngine.js';
import type { GameState, Player, Card } from '../types.js';

// ===== ヘルパー =====

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

/** 指定プレイヤーの状態を上書き */
function withPlayers(state: GameState, updates: Partial<Player>[]): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  for (let i = 0; i < updates.length && i < newState.players.length; i++) {
    Object.assign(newState.players[i], updates[i]);
  }
  return newState;
}

/** ハンド開始済み状態を作成 */
function createStartedState(smallBet = 4, bigBet = 8): GameState {
  const state = createLimitHoldemGameState(1000, smallBet, bigBet);
  return startLimitHoldemHand(state);
}

/** 全プレイヤーがフォールドして1人だけ残す */
function foldAllExcept(state: GameState, survivorIndex: number): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  for (let i = 0; i < 6; i++) {
    if (i !== survivorIndex && !s.players[i].folded && !s.players[i].isSittingOut) {
      s.players[i].folded = true;
    }
  }
  return s;
}

// ===== テスト =====

describe('createLimitHoldemGameState', () => {
  it('6人のプレイヤーを作成する', () => {
    const state = createLimitHoldemGameState(1000, 4, 8);
    expect(state.players).toHaveLength(6);
    for (const p of state.players) {
      expect(p.chips).toBe(1000);
    }
  });

  it('Limit Holdem固有の初期値が正しい', () => {
    const state = createLimitHoldemGameState(1000, 4, 8);
    expect(state.variant).toBe('limit_holdem');
    expect(state.smallBlind).toBe(4); // small bet
    expect(state.bigBlind).toBe(8);   // big bet
    expect(state.ante).toBe(0);
    expect(state.bringIn).toBe(0);
    expect(state.currentStreet).toBe('preflop');
    expect(state.betCount).toBe(0);
    expect(state.maxBetsPerRound).toBe(4);
  });
});

describe('startLimitHoldemHand', () => {
  it('各プレイヤーに2枚のホールカードを配る', () => {
    const state = createStartedState();
    for (const p of state.players) {
      if (!p.isSittingOut) {
        expect(p.holeCards).toHaveLength(2);
      }
    }
  });

  it('SBとBBが正しくポストされる', () => {
    const state = createStartedState(4, 8);
    // SB = floor(smallBet / 2) = 2, BB = smallBet = 4
    const sbPlayer = state.players.find(p => p.position === 'SB')!;
    const bbPlayer = state.players.find(p => p.position === 'BB')!;
    expect(sbPlayer.currentBet).toBe(2);  // floor(4/2) = 2
    expect(bbPlayer.currentBet).toBe(4);  // small bet = 4
    expect(sbPlayer.chips).toBe(998);
    expect(bbPlayer.chips).toBe(996);
  });

  it('ポットにブラインドが含まれる', () => {
    const state = createStartedState(4, 8);
    expect(state.pot).toBe(6); // SB(2) + BB(4)
  });

  it('currentBetがBB額と一致', () => {
    const state = createStartedState(4, 8);
    expect(state.currentBet).toBe(4); // BB = small bet
  });

  it('betCountが1（BBポスト分）', () => {
    const state = createStartedState();
    expect(state.betCount).toBe(1);
  });

  it('currentStreetがpreflopである', () => {
    const state = createStartedState();
    expect(state.currentStreet).toBe('preflop');
  });

  it('プリフロップのアクションはUTGから始まる（6人テーブル）', () => {
    const state = createStartedState();
    const currentPlayer = state.players[state.currentPlayerIndex];
    // 6人テーブルではBBの次がUTG
    expect(currentPlayer.position).toBe('UTG');
  });
});

describe('getLimitHoldemValidActions', () => {
  it('プリフロップでUTGはfold/call/raiseができる', () => {
    const state = createStartedState(4, 8);
    const utg = state.players.findIndex(p => p.position === 'UTG');
    const actions = getLimitHoldemValidActions(state, utg);
    const actionTypes = actions.map(a => a.action);
    expect(actionTypes).toContain('fold');
    expect(actionTypes).toContain('call');
    expect(actionTypes).toContain('raise');
  });

  it('レイズ額は固定（call + betSize）', () => {
    const state = createStartedState(4, 8);
    const utg = state.players.findIndex(p => p.position === 'UTG');
    const actions = getLimitHoldemValidActions(state, utg);
    const raiseAction = actions.find(a => a.action === 'raise');
    // toCall=4, betSize=4 (preflop=small bet), raise = 4+4 = 8
    expect(raiseAction?.minAmount).toBe(8);
    expect(raiseAction?.maxAmount).toBe(8);
  });

  it('ベットカウント上限(4)でレイズ不可', () => {
    let state = createStartedState(4, 8);
    state.betCount = 4; // max reached
    const utg = state.players.findIndex(p => p.position === 'UTG');
    const actions = getLimitHoldemValidActions(state, utg);
    const actionTypes = actions.map(a => a.action);
    expect(actionTypes).not.toContain('raise');
    expect(actionTypes).toContain('call');
  });

  it('ポストフロップでチェック可能', () => {
    let state = createStartedState(4, 8);
    // flopに移動した状態をシミュレート
    state.currentStreet = 'flop';
    state.currentBet = 0;
    state.betCount = 0;
    for (const p of state.players) {
      p.currentBet = 0;
      p.hasActed = false;
    }
    const idx = state.currentPlayerIndex;
    const actions = getLimitHoldemValidActions(state, idx);
    const actionTypes = actions.map(a => a.action);
    expect(actionTypes).toContain('check');
    expect(actionTypes).toContain('bet');
  });

  it('ポストフロップのベット額はsmall bet (flop)', () => {
    let state = createStartedState(4, 8);
    state.currentStreet = 'flop';
    state.currentBet = 0;
    state.betCount = 0;
    for (const p of state.players) {
      p.currentBet = 0;
      p.hasActed = false;
    }
    const idx = state.currentPlayerIndex;
    const actions = getLimitHoldemValidActions(state, idx);
    const betAction = actions.find(a => a.action === 'bet');
    expect(betAction?.minAmount).toBe(4); // small bet on flop
  });

  it('turn/riverのベット額はbig bet', () => {
    let state = createStartedState(4, 8);
    state.currentStreet = 'turn';
    state.currentBet = 0;
    state.betCount = 0;
    for (const p of state.players) {
      p.currentBet = 0;
      p.hasActed = false;
    }
    const idx = state.currentPlayerIndex;
    const actions = getLimitHoldemValidActions(state, idx);
    const betAction = actions.find(a => a.action === 'bet');
    expect(betAction?.minAmount).toBe(8); // big bet on turn
  });

  it('フォールド済みプレイヤーにはアクションなし', () => {
    const state = createStartedState();
    const idx = state.currentPlayerIndex;
    state.players[idx].folded = true;
    const actions = getLimitHoldemValidActions(state, idx);
    expect(actions).toHaveLength(0);
  });

  it('オールイン済みプレイヤーにはアクションなし', () => {
    const state = createStartedState();
    const idx = state.currentPlayerIndex;
    state.players[idx].isAllIn = true;
    const actions = getLimitHoldemValidActions(state, idx);
    expect(actions).toHaveLength(0);
  });

  it('チップ不足時はallinが提示される', () => {
    const state = createStartedState(4, 8);
    const utg = state.players.findIndex(p => p.position === 'UTG');
    state.players[utg].chips = 5; // toCall=4, raise would need 8 → allin
    const actions = getLimitHoldemValidActions(state, utg);
    const actionTypes = actions.map(a => a.action);
    expect(actionTypes).toContain('call');
    expect(actionTypes).toContain('allin');
    expect(actionTypes).not.toContain('raise');
  });
});

describe('applyLimitHoldemAction', () => {
  it('フォールドするとplayer.foldedがtrue', () => {
    const state = createStartedState();
    const idx = state.currentPlayerIndex;
    const newState = applyLimitHoldemAction(state, idx, 'fold');
    expect(newState.players[idx].folded).toBe(true);
  });

  it('コールするとチップが減りポットが増える', () => {
    const state = createStartedState(4, 8);
    const idx = state.currentPlayerIndex;
    const chipsBefore = state.players[idx].chips;
    const potBefore = state.pot;
    const toCall = state.currentBet - state.players[idx].currentBet;
    const newState = applyLimitHoldemAction(state, idx, 'call', toCall);
    expect(newState.players[idx].chips).toBe(chipsBefore - toCall);
    expect(newState.pot).toBe(potBefore + toCall);
  });

  it('レイズするとbetCountが増加', () => {
    const state = createStartedState(4, 8);
    const betCountBefore = state.betCount;
    const idx = state.currentPlayerIndex;
    const raiseAmount = 8; // toCall(4) + betSize(4)
    const newState = applyLimitHoldemAction(state, idx, 'raise', raiseAmount);
    expect(newState.betCount).toBe(betCountBefore + 1);
  });

  it('全員フォールドで1人残ると勝者決定', () => {
    let state = createStartedState(4, 8);
    // UTG以外を全員フォールドさせつつ、UTGとBBだけ残す
    const utg = state.players.findIndex(p => p.position === 'UTG');
    // 全員sitOutにしてUTGとBBだけ残す
    for (let i = 0; i < 6; i++) {
      if (i !== utg && state.players[i].position !== 'BB') {
        state.players[i].folded = true;
        state.players[i].hasActed = true;
      }
    }
    // BBのターンでフォールド
    const bb = state.players.findIndex(p => p.position === 'BB');
    state.currentPlayerIndex = bb;
    const result = applyLimitHoldemAction(state, bb, 'fold');
    expect(result.isHandComplete).toBe(true);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].playerId).toBe(utg);
  });

  it('アクション履歴に記録される', () => {
    const state = createStartedState();
    const idx = state.currentPlayerIndex;
    const newState = applyLimitHoldemAction(state, idx, 'fold');
    expect(newState.handHistory.length).toBeGreaterThan(0);
    const lastAction = newState.handHistory[newState.handHistory.length - 1];
    expect(lastAction.action).toBe('fold');
    expect(lastAction.playerId).toBe(idx);
    expect(lastAction.street).toBe('preflop');
  });
});

describe('determineLimitHoldemWinner', () => {
  it('1人残りで勝者が決まる', () => {
    let state = createStartedState();
    state = foldAllExcept(state, 0);
    const result = determineLimitHoldemWinner(state);
    expect(result.isHandComplete).toBe(true);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].playerId).toBe(0);
  });

  it('ショーダウンで最強ハンドが勝つ', () => {
    let state = createStartedState(4, 8);
    // コミュニティカード設定
    state.communityCards = [
      card('A', 'h'), card('K', 'h'), card('Q', 'h'),
      card('J', 'h'), card('2', 's'),
    ];
    // Player 0: ロイヤルフラッシュ (Th)
    state.players[0].holeCards = [card('T', 'h'), card('3', 's')];
    state.players[0].folded = false;
    state.players[0].totalBetThisRound = 8;
    // Player 1: ストレート
    state.players[1].holeCards = [card('T', 's'), card('3', 'c')];
    state.players[1].folded = false;
    state.players[1].totalBetThisRound = 8;
    // 他はフォールド
    for (let i = 2; i < 6; i++) {
      state.players[i].folded = true;
    }
    state.pot = 16;
    state.currentStreet = 'showdown';

    const result = determineLimitHoldemWinner(state);
    expect(result.isHandComplete).toBe(true);
    // Player 0がロイヤルフラッシュで勝つ
    const winner = result.winners.find(w => w.playerId === 0);
    expect(winner).toBeDefined();
    expect(winner!.amount).toBeGreaterThan(0);
  });

  it('同じハンドの場合はスプリットポット', () => {
    let state = createStartedState(4, 8);
    state.communityCards = [
      card('A', 'h'), card('K', 'h'), card('Q', 'h'),
      card('J', 'h'), card('T', 'h'), // ボードにロイヤルフラッシュ
    ];
    // 両プレイヤーのホールカードは関係ない（ボードが最強）
    state.players[0].holeCards = [card('2', 's'), card('3', 's')];
    state.players[0].folded = false;
    state.players[0].totalBetThisRound = 8;
    state.players[1].holeCards = [card('4', 's'), card('5', 's')];
    state.players[1].folded = false;
    state.players[1].totalBetThisRound = 8;
    for (let i = 2; i < 6; i++) {
      state.players[i].folded = true;
    }
    state.pot = 16;
    state.currentStreet = 'showdown';

    const result = determineLimitHoldemWinner(state);
    expect(result.winners).toHaveLength(2);
  });
});

describe('wouldLimitHoldemAdvanceStreet', () => {
  it('ストリートが進む場合trueを返す', () => {
    let state = createStartedState(4, 8);
    // 全員callしてBBのターン → BBがcheckでflop
    // シンプルにするため2人だけ残す
    for (let i = 0; i < 6; i++) {
      if (state.players[i].position !== 'SB' && state.players[i].position !== 'BB') {
        state.players[i].folded = true;
        state.players[i].hasActed = true;
      }
    }
    const sb = state.players.findIndex(p => p.position === 'SB');
    state.currentPlayerIndex = sb;
    // SBがcall → BBがcheck → flop
    const afterCall = applyLimitHoldemAction(state, sb, 'call', 2);
    // Now it should be BB's turn to check
    const bb = afterCall.currentPlayerIndex;
    const advances = wouldLimitHoldemAdvanceStreet(afterCall, bb, 'check');
    expect(advances).toBe(true);
  });
});

describe('ストリート進行', () => {
  it('preflopからflopに進む', () => {
    let state = createStartedState(4, 8);
    // 2人だけにする
    for (let i = 0; i < 6; i++) {
      if (state.players[i].position !== 'SB' && state.players[i].position !== 'BB') {
        state.players[i].folded = true;
        state.players[i].hasActed = true;
      }
    }
    const sb = state.players.findIndex(p => p.position === 'SB');
    state.currentPlayerIndex = sb;
    let s = applyLimitHoldemAction(state, sb, 'call', 2);
    // BBのチェック
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    expect(s.currentStreet).toBe('flop');
    expect(s.communityCards).toHaveLength(3);
    expect(s.betCount).toBe(0); // 新ストリートでリセット
  });

  it('フロップではsmall betサイズ', () => {
    let state = createStartedState(4, 8);
    for (let i = 0; i < 6; i++) {
      if (state.players[i].position !== 'SB' && state.players[i].position !== 'BB') {
        state.players[i].folded = true;
        state.players[i].hasActed = true;
      }
    }
    const sb = state.players.findIndex(p => p.position === 'SB');
    state.currentPlayerIndex = sb;
    let s = applyLimitHoldemAction(state, sb, 'call', 2);
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    expect(s.currentStreet).toBe('flop');
    expect(s.minRaise).toBe(4); // small bet on flop
  });

  it('ターンではbig betサイズ', () => {
    let state = createStartedState(4, 8);
    for (let i = 0; i < 6; i++) {
      if (state.players[i].position !== 'SB' && state.players[i].position !== 'BB') {
        state.players[i].folded = true;
        state.players[i].hasActed = true;
      }
    }
    const sb = state.players.findIndex(p => p.position === 'SB');
    state.currentPlayerIndex = sb;
    // preflop: SB call, BB check → flop
    let s = applyLimitHoldemAction(state, sb, 'call', 2);
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    // flop: check, check → turn
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    expect(s.currentStreet).toBe('turn');
    expect(s.communityCards).toHaveLength(4);
    expect(s.minRaise).toBe(8); // big bet on turn
  });

  it('リバーの後はショーダウン', () => {
    let state = createStartedState(4, 8);
    for (let i = 0; i < 6; i++) {
      if (state.players[i].position !== 'SB' && state.players[i].position !== 'BB') {
        state.players[i].folded = true;
        state.players[i].hasActed = true;
      }
    }
    const sb = state.players.findIndex(p => p.position === 'SB');
    state.currentPlayerIndex = sb;
    // preflop → flop
    let s = applyLimitHoldemAction(state, sb, 'call', 2);
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    // flop → turn
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    // turn → river
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    expect(s.currentStreet).toBe('river');
    expect(s.communityCards).toHaveLength(5);
    // river → showdown
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    s = applyLimitHoldemAction(s, s.currentPlayerIndex, 'check');
    expect(s.currentStreet).toBe('showdown');
    expect(s.isHandComplete).toBe(true);
    expect(s.winners.length).toBeGreaterThan(0);
  });
});
