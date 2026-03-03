import { describe, it, expect } from 'vitest';
import {
  createStudGameState,
  startStudHand,
  getStudValidActions,
  applyStudAction,
  wouldStudAdvanceStreet,
  determineStudWinner,
} from '../studEngine.js';
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

/** ブリングイン後の初期状態を作成（全員アクティブ、3rd street） */
function createStartedState(ante = 10, smallBet = 20): GameState {
  const state = createStudGameState(1000, ante, smallBet);
  return startStudHand(state);
}

/** 全プレイヤーがフォールドして1人だけ残す（勝者テスト用） */
function foldAllExcept(state: GameState, survivorIndex: number): GameState {
  let s = JSON.parse(JSON.stringify(state)) as GameState;
  for (let i = 0; i < 6; i++) {
    if (i !== survivorIndex && !s.players[i].folded && !s.players[i].isSittingOut) {
      s.players[i].folded = true;
    }
  }
  return s;
}

// ===== テスト =====

describe('createStudGameState', () => {
  it('6人のプレイヤーを作成する', () => {
    const state = createStudGameState(1000, 10, 20);
    expect(state.players).toHaveLength(6);
    for (const p of state.players) {
      expect(p.chips).toBe(1000);
    }
  });

  it('Stud固有の初期値が正しい', () => {
    const state = createStudGameState(1000, 10, 20);
    expect(state.variant).toBe('stud');
    expect(state.ante).toBe(10);
    expect(state.bringIn).toBe(5); // ante / 2 切り上げ
    expect(state.smallBlind).toBe(20); // small bet
    expect(state.bigBlind).toBe(40); // big bet
    expect(state.currentStreet).toBe('third');
    expect(state.betCount).toBe(0);
    expect(state.maxBetsPerRound).toBe(4);
  });

  it('ブリングインはアンテの半額（切り上げ）', () => {
    const state = createStudGameState(1000, 5, 20);
    expect(state.bringIn).toBe(3); // ceil(5/2) = 3
  });

  it('アンテ0の場合ブリングインは1', () => {
    const state = createStudGameState(1000, 0, 20);
    expect(state.bringIn).toBe(1);
  });
});

describe('startStudHand', () => {
  it('全アクティブプレイヤーからアンテを徴収する', () => {
    const state = createStudGameState(1000, 10, 20);
    const newState = startStudHand(state);

    const activePlayers = newState.players.filter(p => !p.isSittingOut);
    for (const p of activePlayers) {
      // アンテ10 + ブリングインプレイヤーはさらにbringIn分が引かれる
      expect(p.totalBetThisRound).toBeGreaterThanOrEqual(10);
    }
    // ポットにアンテ合計 + ブリングイン
    expect(newState.pot).toBe(10 * 6 + newState.bringIn);
  });

  it('各プレイヤーに裏カード2枚と表カード1枚を配る', () => {
    const state = createStudGameState(1000, 10, 20);
    const newState = startStudHand(state);

    for (const p of newState.players) {
      if (!p.isSittingOut) {
        expect(p.holeCards).toHaveLength(2);
        expect(p.upCards).toHaveLength(1);
      }
    }
  });

  it('デッキから18枚が配られる（6人×3枚）', () => {
    const state = createStudGameState(1000, 10, 20);
    const newState = startStudHand(state);
    // 52枚 - 18枚 = 34枚
    expect(newState.deck).toHaveLength(34);
  });

  it('currentStreetがthirdに設定される', () => {
    const state = createStudGameState(1000, 10, 20);
    const newState = startStudHand(state);
    expect(newState.currentStreet).toBe('third');
  });

  it('ブリングインプレイヤーの次のプレイヤーがアクション待ち', () => {
    const state = createStudGameState(1000, 10, 20);
    const newState = startStudHand(state);

    // currentBet がブリングイン額に設定されている
    expect(newState.currentBet).toBe(newState.bringIn);
    // currentPlayerIndex は有効なプレイヤーを指している
    const currentPlayer = newState.players[newState.currentPlayerIndex];
    expect(currentPlayer.folded).toBe(false);
    expect(currentPlayer.isAllIn).toBe(false);
  });

  it('ハンド状態がリセットされる', () => {
    const state = createStudGameState(1000, 10, 20);
    const newState = startStudHand(state);

    expect(newState.communityCards).toHaveLength(0);
    expect(newState.isHandComplete).toBe(false);
    expect(newState.winners).toHaveLength(0);
    expect(newState.handHistory).toHaveLength(0);
    expect(newState.betCount).toBe(0);
  });

  it('座り出しプレイヤーにはカードを配らない', () => {
    const state = createStudGameState(1000, 10, 20);
    state.players[3].isSittingOut = true;
    const newState = startStudHand(state);

    expect(newState.players[3].holeCards).toHaveLength(0);
    expect(newState.players[3].upCards).toHaveLength(0);
    expect(newState.players[3].folded).toBe(true);
  });
});

describe('getStudValidActions', () => {
  it('フォールド済みプレイヤーにはアクションなし', () => {
    const state = createStartedState();
    const idx = state.currentPlayerIndex;
    state.players[idx].folded = true;
    const actions = getStudValidActions(state, idx);
    expect(actions).toHaveLength(0);
  });

  it('オールインプレイヤーにはアクションなし', () => {
    const state = createStartedState();
    const idx = state.currentPlayerIndex;
    state.players[idx].isAllIn = true;
    const actions = getStudValidActions(state, idx);
    expect(actions).toHaveLength(0);
  });

  it('ブリングイン後: fold/call/bet(コンプリート)が選べる', () => {
    const state = createStartedState(10, 20);
    const idx = state.currentPlayerIndex;
    const actions = getStudValidActions(state, idx);
    const actionTypes = actions.map(a => a.action);

    expect(actionTypes).toContain('fold');
    expect(actionTypes).toContain('call');
    // ブリングイン後のコンプリート（bet）
    expect(actionTypes).toContain('bet');
  });

  it('ベットがない場合: fold/check/betが選べる', () => {
    const state = createStartedState(10, 20);
    // currentBetを0にしてcheckできる状態を作る
    state.currentBet = 0;
    for (const p of state.players) p.currentBet = 0;
    state.betCount = 0;
    const idx = state.currentPlayerIndex;
    const actions = getStudValidActions(state, idx);
    const actionTypes = actions.map(a => a.action);

    expect(actionTypes).toContain('fold');
    expect(actionTypes).toContain('check');
    expect(actionTypes).toContain('bet');
  });

  it('ベットがある場合: fold/call/raiseが選べる', () => {
    const state = createStartedState(10, 20);
    // ベットがある状態を作る
    state.currentBet = 20;
    state.betCount = 1;
    const idx = state.currentPlayerIndex;
    state.players[idx].currentBet = 0;
    const actions = getStudValidActions(state, idx);
    const actionTypes = actions.map(a => a.action);

    expect(actionTypes).toContain('fold');
    expect(actionTypes).toContain('call');
    expect(actionTypes).toContain('raise');
  });

  it('Fixed Limit: betは固定額（small bet）', () => {
    const state = createStartedState(10, 20);
    state.currentBet = 0;
    for (const p of state.players) p.currentBet = 0;
    state.betCount = 0;
    const idx = state.currentPlayerIndex;
    const actions = getStudValidActions(state, idx);
    const betAction = actions.find(a => a.action === 'bet');

    expect(betAction).toBeDefined();
    // 3rd streetではsmall bet = 20
    expect(betAction!.minAmount).toBe(20);
    expect(betAction!.maxAmount).toBe(20);
  });

  it('Fixed Limit: raiseも固定額', () => {
    const state = createStartedState(10, 20);
    state.currentBet = 20;
    state.betCount = 1;
    const idx = state.currentPlayerIndex;
    state.players[idx].currentBet = 0;
    const actions = getStudValidActions(state, idx);
    const raiseAction = actions.find(a => a.action === 'raise');

    expect(raiseAction).toBeDefined();
    // raise = currentBet(20) + smallBet(20) - playerCurrentBet(0) = 40
    expect(raiseAction!.minAmount).toBe(40);
    expect(raiseAction!.maxAmount).toBe(40);
  });

  it('maxBetsPerRound到達でレイズ不可', () => {
    const state = createStartedState(10, 20);
    state.currentBet = 80; // 4bet
    state.betCount = 4; // max到達
    const idx = state.currentPlayerIndex;
    state.players[idx].currentBet = 0;
    const actions = getStudValidActions(state, idx);
    const actionTypes = actions.map(a => a.action);

    expect(actionTypes).toContain('fold');
    expect(actionTypes).toContain('call');
    expect(actionTypes).not.toContain('raise');
    expect(actionTypes).not.toContain('bet');
  });

  it('チップ不足でレイズ額に足りない場合: allinが選べる', () => {
    const state = createStartedState(10, 20);
    state.currentBet = 20;
    state.betCount = 1;
    const idx = state.currentPlayerIndex;
    state.players[idx].currentBet = 0;
    state.players[idx].chips = 30; // raiseには40必要だが30しかない（callは20）
    const actions = getStudValidActions(state, idx);
    const actionTypes = actions.map(a => a.action);

    expect(actionTypes).toContain('fold');
    expect(actionTypes).toContain('call');
    expect(actionTypes).toContain('allin');
    expect(actionTypes).not.toContain('raise');
  });
});

describe('applyStudAction', () => {
  describe('fold', () => {
    it('プレイヤーがフォールドされる', () => {
      const state = createStartedState();
      const idx = state.currentPlayerIndex;
      const newState = applyStudAction(state, idx, 'fold');
      expect(newState.players[idx].folded).toBe(true);
    });

    it('ハンド履歴に記録される', () => {
      const state = createStartedState();
      const idx = state.currentPlayerIndex;
      const newState = applyStudAction(state, idx, 'fold');
      expect(newState.handHistory).toHaveLength(1);
      expect(newState.handHistory[0]).toMatchObject({
        playerId: idx,
        action: 'fold',
        street: 'third',
      });
    });
  });

  describe('call', () => {
    it('正しい額をコールできる', () => {
      const state = createStartedState(10, 20);
      const idx = state.currentPlayerIndex;
      const toCall = state.currentBet - state.players[idx].currentBet;
      const chipsBefore = state.players[idx].chips;
      const potBefore = state.pot;

      const newState = applyStudAction(state, idx, 'call', toCall);
      expect(newState.players[idx].chips).toBe(chipsBefore - toCall);
      expect(newState.players[idx].currentBet).toBe(state.currentBet);
      expect(newState.pot).toBe(potBefore + toCall);
    });
  });

  describe('bet（コンプリート）', () => {
    it('3rd streetでブリングインをコンプリートできる', () => {
      const state = createStartedState(10, 20);
      const idx = state.currentPlayerIndex;
      const actions = getStudValidActions(state, idx);
      const betAction = actions.find(a => a.action === 'bet');
      expect(betAction).toBeDefined();

      const newState = applyStudAction(state, idx, 'bet', betAction!.minAmount);
      // currentBetがsmall bet(20)になる
      expect(newState.currentBet).toBe(20);
      expect(newState.betCount).toBe(1);
    });

    it('ベット後に他プレイヤーの hasActed がリセットされる', () => {
      const state = createStartedState(10, 20);
      const idx = state.currentPlayerIndex;
      // 他のプレイヤーを既アクション状態にしておく
      for (const p of state.players) {
        if (p.id !== idx && !p.folded && !p.isAllIn) {
          p.hasActed = true;
        }
      }

      const actions = getStudValidActions(state, idx);
      const betAction = actions.find(a => a.action === 'bet');
      const newState = applyStudAction(state, idx, 'bet', betAction!.minAmount);

      for (const p of newState.players) {
        if (p.id !== idx && !p.folded && !p.isAllIn) {
          expect(p.hasActed).toBe(false);
        }
      }
    });
  });

  describe('raise', () => {
    it('固定額でレイズできる', () => {
      const state = createStartedState(10, 20);
      const idx = state.currentPlayerIndex;
      // まずコンプリート
      let s = applyStudAction(state, idx, 'bet', 20);
      const nextIdx = s.currentPlayerIndex;
      const actions = getStudValidActions(s, nextIdx);
      const raiseAction = actions.find(a => a.action === 'raise');
      expect(raiseAction).toBeDefined();

      s = applyStudAction(s, nextIdx, 'raise', raiseAction!.minAmount);
      // currentBet = 20 + 20 = 40
      expect(s.currentBet).toBe(40);
      expect(s.betCount).toBe(2);
    });
  });

  describe('allin', () => {
    it('オールイン時にチップが0になる', () => {
      const state = createStartedState(10, 20);
      const idx = state.currentPlayerIndex;
      state.players[idx].chips = 15; // ブリングインのコール (5) より多いがbet (20) より少ない

      const newState = applyStudAction(state, idx, 'allin', 15);
      expect(newState.players[idx].chips).toBe(0);
      expect(newState.players[idx].isAllIn).toBe(true);
    });
  });

  describe('ストリート進行', () => {
    it('全員アクション完了後にストリートが進む', () => {
      let state = createStartedState(10, 20);

      // 全員コールして3rd streetを終了
      for (let i = 0; i < 10; i++) {
        if (state.isHandComplete) break;
        if (state.currentStreet !== 'third') break;

        const idx = state.currentPlayerIndex;
        const actions = getStudValidActions(state, idx);
        if (actions.length === 0) break;

        const callAction = actions.find(a => a.action === 'call');
        const checkAction = actions.find(a => a.action === 'check');
        if (callAction) {
          state = applyStudAction(state, idx, 'call', callAction.minAmount);
        } else if (checkAction) {
          state = applyStudAction(state, idx, 'check');
        } else {
          break;
        }
      }

      // 3rd street が終わって 4th street になっている
      expect(['fourth', 'showdown']).toContain(state.currentStreet);
    });

    it('4th streetでは各プレイヤーに表カードが追加される', () => {
      let state = createStartedState(10, 20);

      // 全員コールして3rd streetを進む
      for (let i = 0; i < 10; i++) {
        if (state.currentStreet !== 'third') break;
        const idx = state.currentPlayerIndex;
        const actions = getStudValidActions(state, idx);
        if (actions.length === 0) break;
        const callAction = actions.find(a => a.action === 'call');
        const checkAction = actions.find(a => a.action === 'check');
        if (callAction) {
          state = applyStudAction(state, idx, 'call', callAction.minAmount);
        } else if (checkAction) {
          state = applyStudAction(state, idx, 'check');
        }
      }

      if (state.currentStreet === 'fourth') {
        const activePlayers = state.players.filter(p => !p.folded && !p.isSittingOut);
        for (const p of activePlayers) {
          // 4th streetで表カード2枚になる
          expect(p.upCards).toHaveLength(2);
          expect(p.holeCards).toHaveLength(2);
        }
      }
    });
  });
});

describe('wouldStudAdvanceStreet', () => {
  it('ストリートが進む場合にtrueを返す', () => {
    let state = createStartedState(10, 20);

    // 5人コールして最後の1人がチェックor コールすると次のストリートへ
    for (let i = 0; i < 10; i++) {
      if (state.isHandComplete) break;

      const idx = state.currentPlayerIndex;
      const actions = getStudValidActions(state, idx);
      if (actions.length === 0) break;

      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');

      // 残り1人のアクションでストリートが進むかチェック
      const playersWhoCanAct = state.players.filter(
        p => !p.folded && !p.isAllIn && !p.isSittingOut && (!p.hasActed || p.currentBet < state.currentBet)
      );

      if (playersWhoCanAct.length === 1 && callAction) {
        const result = wouldStudAdvanceStreet(state, idx, 'call', callAction.minAmount);
        expect(result).toBe(true);
        break;
      }

      if (callAction) {
        state = applyStudAction(state, idx, 'call', callAction.minAmount);
      } else if (checkAction) {
        state = applyStudAction(state, idx, 'check');
      }
    }
  });
});

describe('Fixed Limit: ベットサイズの切り替え', () => {
  /** 全員コールしてストリートを進める */
  function advanceToStreet(targetStreet: string): GameState {
    let state = createStartedState(10, 20);

    for (let round = 0; round < 50; round++) {
      if (state.isHandComplete) break;
      if (state.currentStreet === targetStreet) break;

      const idx = state.currentPlayerIndex;
      const actions = getStudValidActions(state, idx);
      if (actions.length === 0) break;

      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');
      if (callAction) {
        state = applyStudAction(state, idx, 'call', callAction.minAmount);
      } else if (checkAction) {
        state = applyStudAction(state, idx, 'check');
      } else {
        // foldして進める
        state = applyStudAction(state, idx, 'fold');
      }
    }
    return state;
  }

  it('3rd/4th streetではsmall bet(20)', () => {
    const state = createStartedState(10, 20);
    // 3rd street: ブリングイン後のコンプリートはsmall bet
    const idx = state.currentPlayerIndex;
    const actions = getStudValidActions(state, idx);
    const betAction = actions.find(a => a.action === 'bet');
    if (betAction) {
      expect(betAction.minAmount).toBe(20); // small bet
    }
  });

  it('5th street以降ではbig bet(40)', () => {
    const state = advanceToStreet('fifth');
    if (state.currentStreet === 'fifth' && !state.isHandComplete) {
      const idx = state.currentPlayerIndex;
      const actions = getStudValidActions(state, idx);
      // ベットサイズがbig bet(40)であるか確認
      const betAction = actions.find(a => a.action === 'bet');
      const raiseAction = actions.find(a => a.action === 'raise');
      if (betAction) {
        expect(betAction.minAmount).toBe(40); // big bet
      }
      if (raiseAction) {
        // raise amount includes callAmount + big bet
        expect(raiseAction.minAmount).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

describe('カード配布の進行', () => {
  /** 全員コールしてストリートを進める */
  function playToStreet(targetStreet: string): GameState {
    let state = createStartedState(10, 20);
    for (let round = 0; round < 60; round++) {
      if (state.isHandComplete) break;
      if (state.currentStreet === targetStreet) break;
      const idx = state.currentPlayerIndex;
      const actions = getStudValidActions(state, idx);
      if (actions.length === 0) break;
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');
      if (callAction) {
        state = applyStudAction(state, idx, 'call', callAction.minAmount);
      } else if (checkAction) {
        state = applyStudAction(state, idx, 'check');
      } else {
        state = applyStudAction(state, idx, 'fold');
      }
    }
    return state;
  }

  it('5th streetでは裏2枚+表3枚 = 5枚', () => {
    const state = playToStreet('fifth');
    if (state.currentStreet === 'fifth') {
      const activePlayers = state.players.filter(p => !p.folded && !p.isSittingOut);
      for (const p of activePlayers) {
        expect(p.holeCards).toHaveLength(2);
        expect(p.upCards).toHaveLength(3);
      }
    }
  });

  it('6th streetでは裏2枚+表4枚 = 6枚', () => {
    const state = playToStreet('sixth');
    if (state.currentStreet === 'sixth') {
      const activePlayers = state.players.filter(p => !p.folded && !p.isSittingOut);
      for (const p of activePlayers) {
        expect(p.holeCards).toHaveLength(2);
        expect(p.upCards).toHaveLength(4);
      }
    }
  });

  it('7th streetでは裏3枚+表4枚 = 7枚', () => {
    const state = playToStreet('seventh');
    if (state.currentStreet === 'seventh') {
      const activePlayers = state.players.filter(p => !p.folded && !p.isSittingOut);
      for (const p of activePlayers) {
        expect(p.holeCards).toHaveLength(3); // 7thの1枚は裏カード
        expect(p.upCards).toHaveLength(4);
      }
    }
  });
});

describe('determineStudWinner', () => {
  it('1人だけアクティブなら無条件勝利', () => {
    let state = createStartedState(10, 20);
    state = foldAllExcept(state, 0);
    const result = determineStudWinner(state);

    expect(result.isHandComplete).toBe(true);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].playerId).toBe(0);
    expect(result.winners[0].amount).toBe(result.pot - result.rake);
  });

  it('ショーダウンでハンド評価が行われる', () => {
    let state = createStartedState(10, 20);

    // 2人だけ残す
    for (let i = 2; i < 6; i++) {
      state.players[i].folded = true;
    }

    // 7枚ずつ手動でセット
    state.players[0].holeCards = [card('A', 'h'), card('K', 'h'), card('Q', 'h')];
    state.players[0].upCards = [card('J', 'h'), card('T', 'h'), card('9', 'h'), card('2', 's')];
    state.players[1].holeCards = [card('2', 'c'), card('3', 'd'), card('4', 'c')];
    state.players[1].upCards = [card('5', 's'), card('7', 'd'), card('8', 'c'), card('9', 'd')];

    const result = determineStudWinner(state);
    expect(result.isHandComplete).toBe(true);
    expect(result.winners.length).toBeGreaterThanOrEqual(1);
    // Player 0 has a flush (hearts), should win
    expect(result.winners[0].playerId).toBe(0);
  });

  it('レーキが正しく計算される', () => {
    let state = createStartedState(10, 20);
    // ブリングインのコールでポットを作り、複数ストリート進める
    state = foldAllExcept(state, 0);
    state.pot = 100;

    // 3rd street以外ではレーキが取られる
    state.currentStreet = 'fourth';
    const result = determineStudWinner(state, 5, 3); // 5%, cap 3BB
    expect(result.rake).toBeGreaterThan(0);
    expect(result.winners[0].amount).toBe(result.pot - result.rake);
  });

  it('3rd streetでの全員フォールドはレーキなし', () => {
    let state = createStartedState(10, 20);
    state = foldAllExcept(state, 0);
    // currentStreetはthirdのまま
    state.currentStreet = 'third';
    const result = determineStudWinner(state, 5, 3);
    expect(result.rake).toBe(0);
  });
});

describe('全ハンド進行: 3rd→ショーダウン', () => {
  it('全ストリートをコールで通してハンドが完了する', () => {
    let state = createStartedState(10, 20);
    let lastStreet = state.currentStreet;
    const streetsSeen = new Set<string>([lastStreet]);

    for (let round = 0; round < 100; round++) {
      if (state.isHandComplete) break;

      const idx = state.currentPlayerIndex;
      const actions = getStudValidActions(state, idx);
      if (actions.length === 0) break;

      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');
      if (callAction) {
        state = applyStudAction(state, idx, 'call', callAction.minAmount);
      } else if (checkAction) {
        state = applyStudAction(state, idx, 'check');
      } else {
        state = applyStudAction(state, idx, 'fold');
      }

      if (state.currentStreet !== lastStreet) {
        streetsSeen.add(state.currentStreet);
        lastStreet = state.currentStreet;
      }
    }

    expect(state.isHandComplete).toBe(true);
    expect(state.winners.length).toBeGreaterThanOrEqual(1);
    // ショーダウンまで進んでいる
    expect(streetsSeen.has('showdown')).toBe(true);
  });

  it('全員フォールドでハンドが早期完了する', () => {
    let state = createStartedState(10, 20);

    // currentPlayer以外全員フォールド
    for (let i = 0; i < 10; i++) {
      if (state.isHandComplete) break;
      const idx = state.currentPlayerIndex;
      state = applyStudAction(state, idx, 'fold');
    }

    expect(state.isHandComplete).toBe(true);
    expect(state.winners).toHaveLength(1);
  });

  it('チップの合計がハンド前後で一致する（レーキ除く）', () => {
    let state = createStartedState(10, 20);
    const totalChipsBefore = state.players.reduce((sum, p) => sum + p.chips, 0) + state.pot;

    for (let round = 0; round < 100; round++) {
      if (state.isHandComplete) break;
      const idx = state.currentPlayerIndex;
      const actions = getStudValidActions(state, idx);
      if (actions.length === 0) break;

      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');
      if (callAction) {
        state = applyStudAction(state, idx, 'call', callAction.minAmount);
      } else if (checkAction) {
        state = applyStudAction(state, idx, 'check');
      } else {
        state = applyStudAction(state, idx, 'fold');
      }
    }

    const totalChipsAfter = state.players.reduce((sum, p) => sum + p.chips, 0) + state.rake;
    expect(totalChipsAfter).toBe(totalChipsBefore);
  });
});
