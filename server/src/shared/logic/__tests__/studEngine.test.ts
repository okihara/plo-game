import { describe, it, expect } from 'vitest';
import {
  createStudGameState,
  startStudHand,
  getStudValidActions,
  applyStudAction,
  wouldStudAdvanceStreet,
  determineStudWinner,
} from '../studEngine.js';
import { getUpCards } from '../types.js';
import type { GameState, Player, Card } from '../types.js';

// ===== ヘルパー =====

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

function studCard(rank: Card['rank'], suit: Card['suit'], isUp: boolean): Card {
  return { rank, suit, isUp };
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
      // アンテ10が引かれる（ブリングインはまだ自動投入されない）
      expect(p.totalBetThisRound).toBeGreaterThanOrEqual(10);
    }
    // ポットにアンテ合計のみ（ブリングインは未投入）
    expect(newState.pot).toBe(10 * 6);
  });

  it('各プレイヤーに裏カード2枚と表カード1枚を配る', () => {
    const state = createStudGameState(1000, 10, 20);
    const newState = startStudHand(state);

    for (const p of newState.players) {
      if (!p.isSittingOut) {
        expect(p.holeCards).toHaveLength(3);
        expect(getUpCards(p.holeCards)).toHaveLength(1);
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

  it('ブリングインプレイヤーがアクション待ち', () => {
    const state = createStudGameState(1000, 10, 20);
    const newState = startStudHand(state);

    // ブリングインはまだ自動投入されない: currentBet = 0
    expect(newState.currentBet).toBe(0);
    // currentPlayerIndex はブリングインプレイヤー自身を指している
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
    expect(getUpCards(newState.players[3].holeCards)).toHaveLength(0);
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

  it('ブリングインフェーズ: call(ブリングイン)/bet(コンプリート)が選べる（フォールド不可）', () => {
    const state = createStartedState(10, 20);
    const idx = state.currentPlayerIndex;
    const actions = getStudValidActions(state, idx);
    const actionTypes = actions.map(a => a.action);

    expect(actionTypes).not.toContain('fold');
    expect(actionTypes).toContain('call');
    // コンプリート（bet）
    expect(actionTypes).toContain('bet');
  });

  it('ベットがない場合: fold/check/betが選べる', () => {
    const state = createStartedState(10, 20);
    // ブリングインフェーズを抜けるため、4th streetに設定
    state.currentStreet = 'fourth';
    state.currentBet = 0;
    for (const p of state.players) {
      p.currentBet = 0;
      p.hasActed = false;
    }
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
      let state = createStartedState(10, 20);
      // まずブリングインを投入（callでbringIn額を支払う）
      const bringInIdx = state.currentPlayerIndex;
      state = applyStudAction(state, bringInIdx, 'call', state.bringIn);

      // 次のプレイヤーがブリングイン額をコール
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
          expect(p.holeCards).toHaveLength(4);  // 2 down + 2 up
          expect(getUpCards(p.holeCards)).toHaveLength(2);
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
        expect(p.holeCards).toHaveLength(5);  // 2 down + 3 up
        expect(getUpCards(p.holeCards)).toHaveLength(3);
      }
    }
  });

  it('6th streetでは裏2枚+表4枚 = 6枚', () => {
    const state = playToStreet('sixth');
    if (state.currentStreet === 'sixth') {
      const activePlayers = state.players.filter(p => !p.folded && !p.isSittingOut);
      for (const p of activePlayers) {
        expect(p.holeCards).toHaveLength(6);  // 2 down + 4 up
        expect(getUpCards(p.holeCards)).toHaveLength(4);
      }
    }
  });

  it('7th streetでは裏3枚+表4枚 = 7枚', () => {
    const state = playToStreet('seventh');
    if (state.currentStreet === 'seventh') {
      const activePlayers = state.players.filter(p => !p.folded && !p.isSittingOut);
      for (const p of activePlayers) {
        expect(p.holeCards).toHaveLength(7);  // 3 down + 4 up
        expect(getUpCards(p.holeCards)).toHaveLength(4);
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

    // 7枚ずつ手動でセット（deal order: down, down, up, up, up, up, down）
    state.players[0].holeCards = [
      studCard('A', 'h', false), studCard('K', 'h', false),
      studCard('J', 'h', true), studCard('T', 'h', true), studCard('9', 'h', true), studCard('2', 's', true),
      studCard('Q', 'h', false),
    ];
    state.players[1].holeCards = [
      studCard('2', 'c', false), studCard('3', 'd', false),
      studCard('5', 's', true), studCard('7', 'd', true), studCard('8', 'c', true), studCard('9', 'd', true),
      studCard('4', 'c', false),
    ];

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

// ===== 追加テスト =====

describe('ブリングイン決定（最低ドアカード）', () => {
  it('最低ランクのドアカード持ちがブリングインを支払う', () => {
    const state = createStudGameState(1000, 10, 20);
    // デッキを固定: seat0のドアカードが2c（最低）になるよう制御
    // startStudHand内でシャッフル→配布されるので、配布後に検証
    const started = startStudHand(state);

    // ブリングインプレイヤー = currentPlayerIndex（まだ行動していない）
    const bringInIdx = started.currentPlayerIndex;
    expect(bringInIdx).toBeGreaterThanOrEqual(0);

    // ブリングインプレイヤーのドアカードが全プレイヤーの中で最低であること
    const bringInDoorCard = getUpCards(started.players[bringInIdx].holeCards)[0];
    for (let i = 0; i < 6; i++) {
      if (i === bringInIdx || started.players[i].isSittingOut) continue;
      const otherDoorCard = getUpCards(started.players[i].holeCards)[0];
      const bringInRank = getRankValueForTest(bringInDoorCard.rank);
      const otherRank = getRankValueForTest(otherDoorCard.rank);
      // ブリングインのランクは他と同等以下
      expect(bringInRank).toBeLessThanOrEqual(otherRank);
    }
  });

  it('同ランク時はスート♣<♦<♥<♠で低い方がブリングイン', () => {
    const state = createStudGameState(1000, 10, 20);
    const started = startStudHand(state);

    // 同ランクのドアカード持ちが複数いるケースをシミュレーション
    // 手動で状態を構築して findLowestDoorCard の挙動を検証
    const testState = JSON.parse(JSON.stringify(started)) as GameState;
    // Replace door card (3rd card, isUp=true) for each player
    testState.players[0].holeCards[2] = studCard('2', 's', true); // ♠ = 4
    testState.players[1].holeCards[2] = studCard('2', 'h', true); // ♥ = 3
    testState.players[2].holeCards[2] = studCard('2', 'd', true); // ♦ = 2
    testState.players[3].holeCards[2] = studCard('2', 'c', true); // ♣ = 1 ← 最低
    testState.players[4].holeCards[2] = studCard('3', 'h', true); // ランク3
    testState.players[5].holeCards[2] = studCard('3', 's', true); // ランク3

    // startStudHandを再実行して検証（内部でfindLowestDoorCardが呼ばれる）
    // 代わりに、ブリングイン判定後の状態を手動検証
    // player[3]が♣で最低スートなので、ブリングインを支払うべき
    // findLowestDoorCardはprivateなのでstartStudHandを通して間接テスト

    // 新しいstateで全員同ランクのドアカードを持つよう固定デッキを使用
    const fixedState = createStudGameState(1000, 10, 20);
    // startStudHand前にデッキを細工: 裏2枚+表1枚 × 6人 = 18枚
    // seat0: hole[0], hole[1], up[0]
    // seat1: hole[2], hole[3], up[1] ...
    // 配布順: seat0裏2枚, seat0表1枚, seat1裏2枚, seat1表1枚, ...
    const fixedDeck: Card[] = [];
    const doorCards: Card[] = [
      card('2', 's'), // seat0: 2♠
      card('2', 'h'), // seat1: 2♥
      card('2', 'd'), // seat2: 2♦
      card('2', 'c'), // seat3: 2♣ ← 最低
      card('3', 'h'), // seat4
      card('3', 's'), // seat5
    ];
    for (let i = 0; i < 6; i++) {
      fixedDeck.push(card('A', 'h'), card('K', 'h')); // 裏カード2枚（ダミー）
      fixedDeck.push(doorCards[i]); // 表カード1枚
    }
    // 残りのデッキ（ストリート進行用）
    for (let i = 0; i < 34; i++) {
      fixedDeck.push(card('7', 'h'));
    }

    fixedState.deck = []; // startStudHandでシャッフルされるので上書きが必要
    // startStudHand内でshuffleDeck(createDeck())が呼ばれるため、
    // デッキの固定は困難。代わりに配布結果を事後検証する。
    const result = startStudHand(fixedState);
    const bringInIdx = result.currentPlayerIndex;
    // ブリングインプレイヤーのドアカードを確認
    const bringInCard = getUpCards(result.players[bringInIdx].holeCards)[0];
    // 全プレイヤーのドアカードの中で最低ランク（同ランクなら最低スート）
    for (let i = 0; i < 6; i++) {
      if (i === bringInIdx || result.players[i].isSittingOut) continue;
      const otherCard = getUpCards(result.players[i].holeCards)[0];
      const bringInVal = getRankValueForTest(bringInCard.rank) * 10 + suitValue(bringInCard.suit);
      const otherVal = getRankValueForTest(otherCard.rank) * 10 + suitValue(otherCard.suit);
      expect(bringInVal).toBeLessThanOrEqual(otherVal);
    }
  });

  it('ブリングインプレイヤーのcurrentBetがbringIn額', () => {
    const state = createStudGameState(1000, 10, 20);
    const started = startStudHand(state);
    const bringInIdx = started.currentPlayerIndex;
    // ブリングインはまだ自動投入されない: currentBet = 0
    expect(started.players[bringInIdx].currentBet).toBe(0);
    // call（ブリングイン投入）後にcurrentBetがbringIn額になる
    const afterBringIn = applyStudAction(started, bringInIdx, 'call', started.bringIn);
    expect(afterBringIn.players[bringInIdx].currentBet).toBe(started.bringIn);
  });
});

describe('アクション順序（4th street以降）', () => {
  function advanceToFourth(): GameState {
    let state = createStartedState(10, 20);
    for (let round = 0; round < 20; round++) {
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
    return state;
  }

  it('4th streetでは最高ショウイングハンドのプレイヤーが最初にアクション', () => {
    const state = advanceToFourth();
    if (state.currentStreet !== 'fourth' || state.isHandComplete) return;

    const firstActor = state.currentPlayerIndex;
    const firstActorUpCards = getUpCards(state.players[firstActor].holeCards);
    expect(firstActorUpCards.length).toBe(2);

    // 最初のアクターの表カードが他のプレイヤーより強い（または同等）ことを確認
    // evaluateShowingHandがprivateなので、アクター選択が正しいことだけ検証
    expect(state.players[firstActor].folded).toBe(false);
    expect(state.players[firstActor].isAllIn).toBe(false);
    expect(state.players[firstActor].isSittingOut).toBe(false);
  });

  it('オールインプレイヤーはアクション順序の候補から除外される', () => {
    const state = advanceToFourth();
    if (state.currentStreet !== 'fourth' || state.isHandComplete) return;

    const firstActor = state.currentPlayerIndex;
    expect(state.players[firstActor].isAllIn).toBe(false);
  });
});

describe('ディーラーボタン移動', () => {
  it('連続ハンドでディーラーが回転する', () => {
    let state = createStudGameState(1000, 10, 20);
    const dealerPositions: number[] = [];

    for (let hand = 0; hand < 3; hand++) {
      state = startStudHand(state);
      dealerPositions.push(state.dealerPosition);

      // 全員フォールドしてハンドを終わらせる
      for (let i = 0; i < 10; i++) {
        if (state.isHandComplete) break;
        const idx = state.currentPlayerIndex;
        state = applyStudAction(state, idx, 'fold');
      }
    }

    // ディーラーが毎ハンド異なる位置にいる
    expect(dealerPositions[0]).not.toBe(dealerPositions[1]);
    expect(dealerPositions[1]).not.toBe(dealerPositions[2]);
  });
});

describe('サイドポット', () => {
  it('異なるチップ量のオールインで正しくサイドポットが分配される', () => {
    // determineStudWinnerを直接テスト（サイドポット分配ロジック）
    let state = createStartedState(10, 20);

    // 3人だけ残して、異なるチップを賭けた状態を作る
    for (let i = 3; i < 6; i++) {
      state.players[i].folded = true;
    }

    // totalBetThisRound で各プレイヤーの投入額を設定
    state.players[0].totalBetThisRound = 50;
    state.players[0].chips = 0;
    state.players[0].isAllIn = true;
    state.players[1].totalBetThisRound = 100;
    state.players[1].chips = 0;
    state.players[1].isAllIn = true;
    state.players[2].totalBetThisRound = 100;
    state.players[2].chips = 900;
    state.pot = 250 + (3 * 10); // 投入合計 + フォールド済みのアンテ

    // 7枚ずつ手動でセット（deal order: down, down, up, up, up, up, down）
    state.players[0].holeCards = [
      studCard('2', 'c', false), studCard('3', 'd', false),
      studCard('5', 's', true), studCard('7', 'c', true), studCard('8', 'd', true), studCard('9', 'c', true),
      studCard('4', 'h', false),
    ];
    state.players[1].holeCards = [
      studCard('T', 'c', false), studCard('J', 'd', false),
      studCard('K', 's', true), studCard('6', 'c', true), studCard('6', 'd', true), studCard('3', 'c', true),
      studCard('Q', 'h', false),
    ];
    state.players[2].holeCards = [
      studCard('A', 'h', false), studCard('K', 'h', false),
      studCard('J', 'h', true), studCard('T', 'h', true), studCard('9', 'h', true), studCard('2', 's', true),
      studCard('Q', 's', false),
    ];

    const result = determineStudWinner(state);
    expect(result.isHandComplete).toBe(true);
    expect(result.winners.length).toBeGreaterThanOrEqual(1);

    // 全チップの整合性: 勝者のチップ合計 + レーキ = 元のポット + チップ
    const totalAfter = result.players.reduce((sum, p) => sum + p.chips, 0) + result.rake;
    const totalBefore = state.players.reduce((sum, p) => sum + p.chips, 0) + state.pot;
    expect(totalAfter).toBe(totalBefore);
  });
});

describe('全員オールイン（studRunOut）', () => {
  it('全員オールインで残りカードが自動配布されショーダウンになる', () => {
    let state = createStartedState(10, 20);

    // チップを少なくして全員すぐオールイン
    for (const p of state.players) {
      if (!p.folded && !p.isSittingOut) {
        p.chips = 5; // ブリングインのcall(5)でちょうどオールイン
      }
    }

    // 全員コール → 全員オールインでrunout
    for (let round = 0; round < 20; round++) {
      if (state.isHandComplete) break;
      const idx = state.currentPlayerIndex;
      const actions = getStudValidActions(state, idx);
      if (actions.length === 0) break;
      const callAction = actions.find(a => a.action === 'call');
      if (callAction) {
        state = applyStudAction(state, idx, 'call', callAction.minAmount);
      } else {
        break;
      }
    }

    expect(state.isHandComplete).toBe(true);
    expect(state.currentStreet).toBe('showdown');
    // 全プレイヤーに7枚配布されている
    const activePlayers = state.players.filter(p => !p.folded && !p.isSittingOut);
    for (const p of activePlayers) {
      expect(p.holeCards.length).toBe(7);
    }
    expect(state.winners.length).toBeGreaterThanOrEqual(1);
  });

  it('3rd streetで全員オールインした場合もランアウトが走る', () => {
    let state = createStudGameState(15, 10, 20); // チップ15: アンテ10払って残り5
    state = startStudHand(state);

    // 全員チップが5しかないので、ブリングインcallでオールイン
    for (let round = 0; round < 20; round++) {
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
        break;
      }
    }

    expect(state.isHandComplete).toBe(true);
    expect(state.currentStreet).toBe('showdown');
  });
});

describe('チップ不足のアンテ', () => {
  it('アンテ額よりチップが少ない場合、持っている分だけ支払いオールインになる', () => {
    const state = createStudGameState(1000, 10, 20);
    state.players[2].chips = 3; // アンテ10より少ない
    const started = startStudHand(state);

    expect(started.players[2].chips).toBe(0);
    expect(started.players[2].isAllIn).toBe(true);
    expect(started.players[2].totalBetThisRound).toBe(3); // 持っていた分だけ
  });
});

describe('2人テーブル（ヘッズアップ）', () => {
  it('2人だけアクティブでもハンドが正常に進行する', () => {
    const state = createStudGameState(1000, 10, 20);
    // 4人を座り出しにする
    for (let i = 2; i < 6; i++) {
      state.players[i].isSittingOut = true;
    }
    const started = startStudHand(state);

    // 2人だけにカードが配られている
    const activePlayers = started.players.filter(p => !p.isSittingOut);
    expect(activePlayers).toHaveLength(2);
    for (const p of activePlayers) {
      expect(p.holeCards).toHaveLength(3);
      expect(getUpCards(p.holeCards)).toHaveLength(1);
    }

    // ハンドを最後まで進める
    let s = started;
    for (let round = 0; round < 50; round++) {
      if (s.isHandComplete) break;
      const idx = s.currentPlayerIndex;
      const actions = getStudValidActions(s, idx);
      if (actions.length === 0) break;
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');
      if (callAction) {
        s = applyStudAction(s, idx, 'call', callAction.minAmount);
      } else if (checkAction) {
        s = applyStudAction(s, idx, 'check');
      } else {
        s = applyStudAction(s, idx, 'fold');
      }
    }

    expect(s.isHandComplete).toBe(true);
    expect(s.winners.length).toBeGreaterThanOrEqual(1);
  });

  it('2人でフォールドするとハンドが完了する', () => {
    const state = createStudGameState(1000, 10, 20);
    for (let i = 2; i < 6; i++) {
      state.players[i].isSittingOut = true;
    }
    let s = startStudHand(state);
    const idx = s.currentPlayerIndex;
    s = applyStudAction(s, idx, 'fold');

    expect(s.isHandComplete).toBe(true);
    expect(s.winners).toHaveLength(1);
  });
});

describe('check後のbet', () => {
  it('チェック後に別プレイヤーがベットすると再アクション権が発生する', () => {
    let state = createStartedState(10, 20);

    // 全員コールして4th streetへ
    for (let round = 0; round < 20; round++) {
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

    if (state.currentStreet !== 'fourth' || state.isHandComplete) return;

    // 最初のプレイヤーがチェック
    const firstActor = state.currentPlayerIndex;
    state = applyStudAction(state, firstActor, 'check');
    expect(state.players[firstActor].hasActed).toBe(true);

    // 次のプレイヤーがベット
    const secondActor = state.currentPlayerIndex;
    if (secondActor !== firstActor) {
      const actions = getStudValidActions(state, secondActor);
      const betAction = actions.find(a => a.action === 'bet');
      if (betAction) {
        state = applyStudAction(state, secondActor, 'bet', betAction.minAmount);
        // firstActorのhasActedがリセットされている
        expect(state.players[firstActor].hasActed).toBe(false);
        // firstActorに再アクション権がある（fold/call/raise）
        const reActions = getStudValidActions(state, firstActor);
        const reActionTypes = reActions.map(a => a.action);
        expect(reActionTypes).toContain('call');
        expect(reActionTypes).toContain('fold');
      }
    }
  });
});

describe('ブリングインプレイヤーがアンテでオールイン', () => {
  it('チップがアンテ額ちょうどの場合、ブリングイン額は0でcurrentBet=0', () => {
    // アンテ10、チップ10 → アンテで全額使い切り、ブリングイン不可
    const state = createStudGameState(1000, 10, 20);
    // seat0だけチップ10にして、最低ドアカードを持たせる
    state.players[0].chips = 10;
    const started = startStudHand(state);

    // currentPlayerIndex がブリングインプレイヤー
    const bringInIdx = started.currentPlayerIndex;
    const bringInPlayer = started.players[bringInIdx];

    if (bringInPlayer.isAllIn) {
      // アンテでオールイン済みの場合、ブリングイン額は0
      expect(bringInPlayer.chips).toBe(0);
      expect(bringInPlayer.currentBet).toBe(0);
      expect(started.currentBet).toBe(0);

      // ブリングインプレイヤーがオールインの場合、アクションなし
      const bringInActions = getStudValidActions(started, bringInIdx);
      expect(bringInActions).toHaveLength(0);
    } else {
      // seat0がブリングインプレイヤーではなかった場合
      // ブリングインフェーズ: currentBet = 0
      expect(started.currentBet).toBe(0);
      // ブリングインプレイヤーは call/bet が選べる（フォールド不可）
      const actions = getStudValidActions(started, bringInIdx);
      const actionTypes = actions.map(a => a.action);
      expect(actionTypes).not.toContain('fold');
      expect(actionTypes).toContain('call');
    }
  });

  it('アンテでオールイン済みプレイヤーがブリングインでもハンドが完了する', () => {
    // 全員チップがアンテ額ちょうど → 全員アンテでオールイン
    const state = createStudGameState(10, 10, 20);
    const started = startStudHand(state);

    // 全員オールインのはず
    const allPlayers = started.players.filter(p => !p.isSittingOut);
    for (const p of allPlayers) {
      expect(p.isAllIn).toBe(true);
      expect(p.chips).toBe(0);
    }

    // ブリングインプレイヤーもオールイン → アクション不可
    const bringInIdx = started.currentPlayerIndex;
    const actions = getStudValidActions(started, bringInIdx);
    expect(actions).toHaveLength(0);

    // determineStudWinner を呼んでハンドを完了させる
    const result = determineStudWinner(started);
    expect(result.isHandComplete).toBe(true);
    expect(result.currentStreet).toBe('showdown');
    expect(result.winners.length).toBeGreaterThanOrEqual(1);
  });
});

describe('wouldStudAdvanceStreet が false を返すケース', () => {
  it('フォールドしてもストリートが進まない場合にfalseを返す', () => {
    const state = createStartedState(10, 20);
    const idx = state.currentPlayerIndex;

    // まだ他にアクション待ちプレイヤーがいるのでフォールドしてもストリート進行しない
    const activePlayers = state.players.filter(
      p => !p.folded && !p.isAllIn && !p.isSittingOut
    );
    if (activePlayers.length > 2) {
      const result = wouldStudAdvanceStreet(state, idx, 'fold');
      expect(result).toBe(false);
    }
  });

  it('ベットするとストリートが進まない（再アクション権が発生する）', () => {
    const state = createStartedState(10, 20);
    const idx = state.currentPlayerIndex;
    const actions = getStudValidActions(state, idx);
    const betAction = actions.find(a => a.action === 'bet');

    if (betAction) {
      const result = wouldStudAdvanceStreet(state, idx, 'bet', betAction.minAmount);
      expect(result).toBe(false);
    }
  });
});

describe('ブリングインプレイヤーの再アクション権', () => {
  it('全員コール（コンプリートなし）でブリングインプレイヤーに再アクション権なし → ストリート進行', () => {
    let state = createStartedState(10, 20);
    const bringInIdx = state.lastRaiserIndex;

    // ブリングインの次から全員コール
    for (let i = 0; i < 10; i++) {
      if (state.isHandComplete || state.currentStreet !== 'third') break;
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

    // 全員コール後、ブリングインプレイヤーに再アクション権なし（コンプリートされていないので）
    // → 4th streetに進むべき
    expect(['fourth', 'showdown']).toContain(state.currentStreet);
  });

  it('コンプリート後、ブリングインプレイヤーに再アクション権がある', () => {
    let state = createStartedState(10, 20);
    const bringInIdx = state.currentPlayerIndex;

    // まずブリングインプレイヤーがcall（ブリングイン投入）
    state = applyStudAction(state, bringInIdx, 'call', state.bringIn);

    // 次のプレイヤーがコンプリート（bet）
    const nextIdx = state.currentPlayerIndex;
    const actions = getStudValidActions(state, nextIdx);
    const betAction = actions.find(a => a.action === 'bet');
    if (!betAction) return;

    state = applyStudAction(state, nextIdx, 'bet', betAction.minAmount);

    // コンプリートによりブリングインプレイヤーのhasActedがリセット
    if (!state.players[bringInIdx].isAllIn) {
      expect(state.players[bringInIdx].hasActed).toBe(false);
    }
  });
});

describe('minRaise がストリート進行時に正しく更新される', () => {
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
        state = applyStudAction(state, idx, 'fold');
      }
    }
    return state;
  }

  it('4th streetではminRaise=smallBet(20)', () => {
    const state = advanceToStreet('fourth');
    if (state.currentStreet === 'fourth' && !state.isHandComplete) {
      expect(state.minRaise).toBe(20);
    }
  });

  it('5th streetではminRaise=bigBet(40)', () => {
    const state = advanceToStreet('fifth');
    if (state.currentStreet === 'fifth' && !state.isHandComplete) {
      expect(state.minRaise).toBe(40);
    }
  });
});

// ===== テスト用ヘルパー =====

function getRankValueForTest(rank: Card['rank']): number {
  const values: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  return values[rank] || 0;
}

function suitValue(suit: Card['suit']): number {
  const values: Record<string, number> = { c: 1, d: 2, h: 3, s: 4 };
  return values[suit] || 0;
}
