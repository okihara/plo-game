import { describe, it, expect } from 'vitest';
import {
  createTripleDrawGameState,
  startTripleDrawHand,
  getTripleDrawValidActions,
  applyTripleDrawAction,
  determineTripleDrawWinner,
  isDrawStreet,
  isBettingStreet,
} from '../tripleDrawEngine.js';
import type { GameState, Card } from '../types.js';

// =========================================================================
//  Helpers
// =========================================================================

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

/** 3人プレイ用のテスト状態を作成し、ハンドを開始する */
function startThreePlayerHand(): GameState {
  let state = createTripleDrawGameState(600, 2);
  // seat 3,4,5 を空席に
  state.players[3].isSittingOut = true;
  state.players[4].isSittingOut = true;
  state.players[5].isSittingOut = true;
  state = startTripleDrawHand(state);
  return state;
}

/** 2人プレイ用のテスト状態を作成し、ハンドを開始する */
function startHeadsUpHand(): GameState {
  let state = createTripleDrawGameState(600, 2);
  for (let i = 2; i < 6; i++) {
    state.players[i].isSittingOut = true;
  }
  state = startTripleDrawHand(state);
  return state;
}

/** 指定プレイヤーの手札を上書き */
function setHoleCards(state: GameState, playerIndex: number, cards: Card[]): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  newState.players[playerIndex].holeCards = cards;
  return newState;
}

/** 全員チェック/コールしてベッティングラウンドを完了させる */
function completeCheckAround(state: GameState): GameState {
  let s = state;
  const maxIterations = 20;
  for (let i = 0; i < maxIterations; i++) {
    if (isDrawStreet(s.currentStreet) || s.isHandComplete) break;
    const actions = getTripleDrawValidActions(s, s.currentPlayerIndex);
    const check = actions.find(a => a.action === 'check');
    const call = actions.find(a => a.action === 'call');
    if (check) {
      s = applyTripleDrawAction(s, s.currentPlayerIndex, 'check');
    } else if (call) {
      s = applyTripleDrawAction(s, s.currentPlayerIndex, 'call', call.minAmount);
    } else {
      break;
    }
  }
  return s;
}

/** 全員スタンドパット（0枚交換）でドローラウンドを完了させる */
function completeDrawStandPat(state: GameState): GameState {
  let s = state;
  const maxIterations = 20;
  for (let i = 0; i < maxIterations; i++) {
    if (!isDrawStreet(s.currentStreet) || s.isHandComplete) break;
    s = applyTripleDrawAction(s, s.currentPlayerIndex, 'draw', 0, 0, 0, []);
  }
  return s;
}

// =========================================================================
//  Tests: createTripleDrawGameState
// =========================================================================

describe('createTripleDrawGameState', () => {
  it('6人のプレイヤーを作成する', () => {
    const state = createTripleDrawGameState(600, 2);
    expect(state.players).toHaveLength(6);
    for (const p of state.players) {
      expect(p.chips).toBe(600);
    }
  });

  it('Triple Draw 固有の初期値が正しい', () => {
    const state = createTripleDrawGameState(600, 2);
    expect(state.variant).toBe('tripdraw');
    expect(state.smallBlind).toBe(2);   // small bet
    expect(state.bigBlind).toBe(4);     // big bet
    expect(state.maxBetsPerRound).toBe(4);
    expect(state.discardPile).toEqual([]);
    expect(state.communityCards).toEqual([]);
    expect(state.ante).toBe(0);
    expect(state.bringIn).toBe(0);
  });
});

// =========================================================================
//  Tests: startTripleDrawHand
// =========================================================================

describe('startTripleDrawHand', () => {
  it('各プレイヤーに5枚のカードを配る', () => {
    const state = startThreePlayerHand();
    for (let i = 0; i < 3; i++) {
      expect(state.players[i].holeCards).toHaveLength(5);
    }
  });

  it('predraw ストリートから開始する', () => {
    const state = startThreePlayerHand();
    expect(state.currentStreet).toBe('predraw');
  });

  it('SB/BB を投稿する', () => {
    const state = startThreePlayerHand();
    expect(state.pot).toBe(6); // SB=2 + BB=4
    expect(state.currentBet).toBe(4); // BB amount
  });

  it('UTG からアクション開始（3人）', () => {
    const state = startThreePlayerHand();
    // dealer=0 → SB=1, BB=2 → UTG=0
    const currentPlayer = state.players[state.currentPlayerIndex];
    expect(currentPlayer.position).toBe('BTN');
  });

  it('Heads-up: SB(=BTN)からアクション開始', () => {
    const state = startHeadsUpHand();
    const currentPlayer = state.players[state.currentPlayerIndex];
    // Heads-up では BTN = SB。ポジション名は 'BTN'
    expect(currentPlayer.position).toBe('BTN');
    // SBの額を投稿済み
    expect(currentPlayer.currentBet).toBe(state.smallBlind);
  });

  it('discardPile が空で初期化される', () => {
    const state = startThreePlayerHand();
    expect(state.discardPile).toEqual([]);
  });

  it('isHandComplete は false', () => {
    const state = startThreePlayerHand();
    expect(state.isHandComplete).toBe(false);
  });
});

// =========================================================================
//  Tests: getTripleDrawValidActions (ベッティングフェーズ)
// =========================================================================

describe('getTripleDrawValidActions - ベッティング', () => {
  it('predraw: fold/call/raise が可能（BB投稿後）', () => {
    const state = startThreePlayerHand();
    const actions = getTripleDrawValidActions(state, state.currentPlayerIndex);
    const actionNames = actions.map(a => a.action);
    expect(actionNames).toContain('fold');
    expect(actionNames).toContain('call');
  });

  it('チェック可能な状況ではcheck/fold/betが選べる', () => {
    let state = startThreePlayerHand();
    // 全員コールしてdraw1を経て postdraw1 に到達
    state = completeCheckAround(state);
    state = completeDrawStandPat(state);
    // postdraw1: ベットなし状態
    expect(isBettingStreet(state.currentStreet)).toBe(true);
    const actions = getTripleDrawValidActions(state, state.currentPlayerIndex);
    const actionNames = actions.map(a => a.action);
    expect(actionNames).toContain('check');
    expect(actionNames).toContain('bet');
  });

  it('ベット額は Fixed Limit: predraw=small bet', () => {
    let state = startThreePlayerHand();
    state = completeCheckAround(state);
    state = completeDrawStandPat(state);
    const actions = getTripleDrawValidActions(state, state.currentPlayerIndex);
    const betAction = actions.find(a => a.action === 'bet');
    expect(betAction).toBeDefined();
    expect(betAction!.minAmount).toBe(2); // small bet
    expect(betAction!.maxAmount).toBe(2);
  });

  it('最大4ベットでレイズ不可', () => {
    let state = startThreePlayerHand();
    state = completeCheckAround(state);
    state = completeDrawStandPat(state);
    expect(isBettingStreet(state.currentStreet)).toBe(true);

    // ベット4回実行
    const p = state.currentPlayerIndex;
    state = applyTripleDrawAction(state, state.currentPlayerIndex, 'bet', 2); // bet 1
    state = applyTripleDrawAction(state, state.currentPlayerIndex, 'raise', 4); // raise 2
    state = applyTripleDrawAction(state, state.currentPlayerIndex, 'raise', 4); // raise 3

    // 4ベット目
    const actionsAfter3Raise = getTripleDrawValidActions(state, state.currentPlayerIndex);
    const raiseAfter3 = actionsAfter3Raise.find(a => a.action === 'raise');
    expect(raiseAfter3).toBeDefined(); // 4回目のレイズは可能（bet count = 3 < 4）

    state = applyTripleDrawAction(state, state.currentPlayerIndex, 'raise', 4); // raise 4

    // 4ベット後: レイズ不可
    if (!isDrawStreet(state.currentStreet) && !state.isHandComplete) {
      const actionsAfter4 = getTripleDrawValidActions(state, state.currentPlayerIndex);
      const raiseAfter4 = actionsAfter4.find(a => a.action === 'raise');
      expect(raiseAfter4).toBeUndefined();
    }
  });

  it('フォールド済みプレイヤーは空配列', () => {
    const state = startThreePlayerHand();
    const foldedState = applyTripleDrawAction(state, state.currentPlayerIndex, 'fold');
    const foldedPlayer = state.currentPlayerIndex;
    const actions = getTripleDrawValidActions(foldedState, foldedPlayer);
    expect(actions).toEqual([]);
  });
});

// =========================================================================
//  Tests: getTripleDrawValidActions (ドローフェーズ)
// =========================================================================

describe('getTripleDrawValidActions - ドロー', () => {
  it('ドローフェーズでは draw アクションのみ', () => {
    let state = startThreePlayerHand();
    state = completeCheckAround(state);
    expect(isDrawStreet(state.currentStreet)).toBe(true);

    const actions = getTripleDrawValidActions(state, state.currentPlayerIndex);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('draw');
    expect(actions[0].minAmount).toBe(0);
    expect(actions[0].maxAmount).toBe(5);
  });
});

// =========================================================================
//  Tests: applyTripleDrawAction - ベッティング
// =========================================================================

describe('applyTripleDrawAction - ベッティング', () => {
  it('fold でプレイヤーがフォールドする', () => {
    const state = startThreePlayerHand();
    const pi = state.currentPlayerIndex;
    const newState = applyTripleDrawAction(state, pi, 'fold');
    expect(newState.players[pi].folded).toBe(true);
  });

  it('call で差額を投入', () => {
    const state = startThreePlayerHand();
    const pi = state.currentPlayerIndex;
    const chipsBefore = state.players[pi].chips;
    const toCall = state.currentBet - state.players[pi].currentBet;
    const newState = applyTripleDrawAction(state, pi, 'call', toCall);
    expect(newState.players[pi].chips).toBe(chipsBefore - toCall);
    expect(newState.players[pi].currentBet).toBe(state.currentBet);
  });

  it('全員コールでドローフェーズに遷移', () => {
    let state = startThreePlayerHand();
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('draw1');
  });

  it('全員フォールドで最後の1人が勝利', () => {
    let state = startThreePlayerHand();
    // player 0 (UTG) fold
    state = applyTripleDrawAction(state, state.currentPlayerIndex, 'fold');
    // player 1 (SB) fold
    state = applyTripleDrawAction(state, state.currentPlayerIndex, 'fold');
    // player 2 (BB) wins
    expect(state.isHandComplete).toBe(true);
    expect(state.winners).toHaveLength(1);
  });
});

// =========================================================================
//  Tests: applyTripleDrawAction - ドロー
// =========================================================================

describe('applyTripleDrawAction - ドロー', () => {
  function getToDrawPhase(): GameState {
    let state = startThreePlayerHand();
    return completeCheckAround(state);
  }

  it('0枚交換（stand pat）でカード変わらず', () => {
    let state = getToDrawPhase();
    const pi = state.currentPlayerIndex;
    const cardsBefore = [...state.players[pi].holeCards];
    state = applyTripleDrawAction(state, pi, 'draw', 0, 0, 0, []);
    expect(state.players[pi].holeCards).toHaveLength(5);
    expect(state.players[pi].holeCards).toEqual(cardsBefore);
  });

  it('1枚交換: 1枚捨てて1枚引く', () => {
    let state = getToDrawPhase();
    const pi = state.currentPlayerIndex;
    const originalCards = [...state.players[pi].holeCards];
    state = applyTripleDrawAction(state, pi, 'draw', 0, 0, 0, [0]);
    expect(state.players[pi].holeCards).toHaveLength(5);
    // index 0 のカードは交換された（残りの4枚は同じ）
    for (let i = 1; i < 5; i++) {
      expect(state.players[pi].holeCards).toContainEqual(originalCards[i]);
    }
  });

  it('5枚交換: 全カード入れ替え', () => {
    let state = getToDrawPhase();
    const pi = state.currentPlayerIndex;
    state = applyTripleDrawAction(state, pi, 'draw', 0, 0, 0, [0, 1, 2, 3, 4]);
    expect(state.players[pi].holeCards).toHaveLength(5);
  });

  it('捨てたカードがdiscardPileに入る', () => {
    let state = getToDrawPhase();
    const pi = state.currentPlayerIndex;
    const discardedCard = state.players[pi].holeCards[0];
    state = applyTripleDrawAction(state, pi, 'draw', 0, 0, 0, [0]);
    expect(state.discardPile).toContainEqual(discardedCard);
  });

  it('全員ドロー済みで次のベッティングラウンドへ', () => {
    let state = getToDrawPhase();
    expect(state.currentStreet).toBe('draw1');
    state = completeDrawStandPat(state);
    expect(state.currentStreet).toBe('postdraw1');
  });

  it('ドロー枚数がアクション履歴に記録される', () => {
    let state = getToDrawPhase();
    const pi = state.currentPlayerIndex;
    state = applyTripleDrawAction(state, pi, 'draw', 0, 0, 0, [0, 2]);
    const drawAction = state.handHistory.find(a => a.action === 'draw' && a.playerId === pi);
    expect(drawAction).toBeDefined();
    expect(drawAction!.amount).toBe(2); // 2枚交換
    expect(drawAction!.discardIndices).toEqual([0, 2]);
  });
});

// =========================================================================
//  Tests: ストリート遷移
// =========================================================================

describe('ストリート遷移', () => {
  it('predraw → draw1 → postdraw1 → draw2 → postdraw2 → draw3 → final → showdown', () => {
    let state = startThreePlayerHand();
    expect(state.currentStreet).toBe('predraw');

    // predraw → draw1
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('draw1');

    // draw1 → postdraw1
    state = completeDrawStandPat(state);
    expect(state.currentStreet).toBe('postdraw1');

    // postdraw1 → draw2
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('draw2');

    // draw2 → postdraw2
    state = completeDrawStandPat(state);
    expect(state.currentStreet).toBe('postdraw2');

    // postdraw2 → draw3
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('draw3');

    // draw3 → final
    state = completeDrawStandPat(state);
    expect(state.currentStreet).toBe('final');

    // final → showdown
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('showdown');
    expect(state.isHandComplete).toBe(true);
  });

  it('postdraw2/final ではビッグベット(4)が使われる', () => {
    let state = startThreePlayerHand();
    // predraw → draw1
    state = completeCheckAround(state);
    // draw1 → postdraw1
    state = completeDrawStandPat(state);
    // postdraw1 → draw2
    state = completeCheckAround(state);
    // draw2 → postdraw2
    state = completeDrawStandPat(state);
    expect(state.currentStreet).toBe('postdraw2');

    // postdraw2 のベットサイズを確認
    const actions = getTripleDrawValidActions(state, state.currentPlayerIndex);
    const betAction = actions.find(a => a.action === 'bet');
    expect(betAction).toBeDefined();
    expect(betAction!.minAmount).toBe(4); // big bet
  });
});

// =========================================================================
//  Tests: isDrawStreet / isBettingStreet
// =========================================================================

describe('isDrawStreet / isBettingStreet', () => {
  it('draw1, draw2, draw3 はドローストリート', () => {
    expect(isDrawStreet('draw1')).toBe(true);
    expect(isDrawStreet('draw2')).toBe(true);
    expect(isDrawStreet('draw3')).toBe(true);
  });

  it('predraw, postdraw1, postdraw2, final はベッティングストリート', () => {
    expect(isBettingStreet('predraw')).toBe(true);
    expect(isBettingStreet('postdraw1')).toBe(true);
    expect(isBettingStreet('postdraw2')).toBe(true);
    expect(isBettingStreet('final')).toBe(true);
  });

  it('ドローストリートはベッティングストリートではない', () => {
    expect(isBettingStreet('draw1')).toBe(false);
    expect(isDrawStreet('predraw')).toBe(false);
  });
});

// =========================================================================
//  Tests: determineTripleDrawWinner
// =========================================================================

describe('determineTripleDrawWinner', () => {
  it('2-7ローボールで最低ハンドが勝つ', () => {
    let state = startThreePlayerHand();

    // 手札をセット
    state = setHoleCards(state, 0, [card('2','h'), card('3','d'), card('4','c'), card('5','s'), card('7','h')]); // Number One
    state = setHoleCards(state, 1, [card('2','d'), card('3','c'), card('4','s'), card('5','h'), card('8','d')]); // 8-5 low
    state = setHoleCards(state, 2, [card('2','c'), card('3','s'), card('6','h'), card('7','d'), card('9','c')]); // 9-7 low

    const result = determineTripleDrawWinner(state);
    expect(result.isHandComplete).toBe(true);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].playerId).toBe(0); // Number One が勝つ
    expect(result.winners[0].handName).toBe('Number One');
  });

  it('1人残りで無条件勝利', () => {
    let state = startThreePlayerHand();
    state.players[0].folded = true;
    state.players[1].folded = true;
    // player 2 だけ残り

    const result = determineTripleDrawWinner(state);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].playerId).toBe(2);
    expect(result.winners[0].handName).toBe(''); // フォールド勝ちはハンド名なし
  });

  it('タイの場合ポットを分割', () => {
    let state = startThreePlayerHand();

    // predraw: 全員コール → draw1 → ... → showdown まで進める（ベッティング情報を正しく反映）
    state = completeCheckAround(state); // → draw1
    state = completeDrawStandPat(state); // → postdraw1
    state = completeCheckAround(state); // → draw2
    state = completeDrawStandPat(state); // → postdraw2
    state = completeCheckAround(state); // → draw3
    state = completeDrawStandPat(state); // → final

    // final で1人フォールド、残り2人は同じハンド
    state = applyTripleDrawAction(state, state.currentPlayerIndex, 'fold');

    // 残り2人に同じ強さのハンドをセット
    const activePlayers = state.players.filter(p => !p.folded);
    expect(activePlayers).toHaveLength(2);
    state = setHoleCards(state, activePlayers[0].id, [card('2','h'), card('3','d'), card('4','c'), card('5','s'), card('7','h')]);
    state = setHoleCards(state, activePlayers[1].id, [card('2','d'), card('3','c'), card('4','s'), card('5','h'), card('7','d')]);

    const potBefore = state.pot;
    const result = determineTripleDrawWinner(state);
    expect(result.winners).toHaveLength(2);
    const total = result.winners.reduce((sum, w) => sum + w.amount, 0);
    expect(total).toBe(potBefore);
  });

  it('predrawでの勝利はレーキなし（ノーフロップ・ノードロップ）', () => {
    let state = startThreePlayerHand();
    state.players[0].folded = true;
    state.players[1].folded = true;
    // currentStreet = predraw のまま

    const result = determineTripleDrawWinner(state, 5, 3); // 5%レーキ
    expect(result.rake).toBe(0);
  });
});

// =========================================================================
//  Tests: 完全なハンド進行
// =========================================================================

describe('完全なハンド進行', () => {
  it('predrawからshowdownまでの完全なハンド', () => {
    let state = startThreePlayerHand();
    const initialPot = state.pot;

    // predraw: 全員コール
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('draw1');

    // draw1: 全員スタンドパット
    state = completeDrawStandPat(state);
    expect(state.currentStreet).toBe('postdraw1');

    // postdraw1: 全員チェック
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('draw2');

    // draw2: 全員スタンドパット
    state = completeDrawStandPat(state);
    expect(state.currentStreet).toBe('postdraw2');

    // postdraw2: 全員チェック
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('draw3');

    // draw3: 全員スタンドパット
    state = completeDrawStandPat(state);
    expect(state.currentStreet).toBe('final');

    // final: 全員チェック → showdown
    state = completeCheckAround(state);
    expect(state.isHandComplete).toBe(true);
    expect(state.currentStreet).toBe('showdown');
    expect(state.winners.length).toBeGreaterThan(0);

    // チップの合計が変わっていないことを確認（レーキなし）
    const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChips).toBe(600 * 6); // 全6人の初期チップ合計（sitting outの3人含む）
  });

  it('ドローでカード交換しながらshowdownまで進行', () => {
    let state = startThreePlayerHand();

    // predraw: 全員コール
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('draw1');

    // draw1: 各プレイヤーが2枚ずつ交換
    for (let i = 0; i < 3; i++) {
      if (state.isHandComplete) break;
      const pi = state.currentPlayerIndex;
      state = applyTripleDrawAction(state, pi, 'draw', 0, 0, 0, [0, 1]);
      expect(state.players[pi].holeCards).toHaveLength(5);
    }

    // 残りのストリートをスキップ
    while (!state.isHandComplete) {
      if (isDrawStreet(state.currentStreet)) {
        state = completeDrawStandPat(state);
      } else {
        state = completeCheckAround(state);
      }
    }

    expect(state.isHandComplete).toBe(true);
    expect(state.winners.length).toBeGreaterThan(0);
  });
});

// =========================================================================
//  Tests: デッキ枯渇
// =========================================================================

describe('デッキ枯渇時のリシャッフル', () => {
  it('デッキが不足した場合discardPileからリシャッフルされる', () => {
    let state = startThreePlayerHand();

    // predraw: 全員コール → draw1
    state = completeCheckAround(state);
    expect(state.currentStreet).toBe('draw1');

    // デッキを意図的に少なくする
    const newState = JSON.parse(JSON.stringify(state)) as GameState;
    // discardPileにカードを入れてデッキを減らす
    const deckCards = newState.deck.splice(0, newState.deck.length - 1); // デッキを1枚だけ残す
    newState.discardPile = deckCards;

    // 3枚交換を試みる（デッキ1枚 + discardPileからリシャッフル）
    const pi = newState.currentPlayerIndex;
    const result = applyTripleDrawAction(newState, pi, 'draw', 0, 0, 0, [0, 1, 2]);
    expect(result.players[pi].holeCards).toHaveLength(5);
  });
});
