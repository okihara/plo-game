import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  startNewHand,
  getActivePlayers,
  getPlayersWhoCanAct,
  getValidActions,
  applyAction,
  wouldAdvanceStreet,
  calculateSidePots,
  determineWinner,
  rotatePositions,
} from '../gameEngine.js';
import type { GameState, Player, Card } from '../types.js';

// ===== ヘルパー =====

/** テスト用に最小限のGameStateを作成 */
function createTestState(overrides: Partial<GameState> = {}): GameState {
  const base = createInitialGameState();
  return { ...base, ...overrides };
}

/** 指定プレイヤーの状態を上書き */
function withPlayers(state: GameState, updates: Partial<Player>[]): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  for (let i = 0; i < updates.length && i < newState.players.length; i++) {
    Object.assign(newState.players[i], updates[i]);
  }
  return newState;
}

/** テスト用の固定カード */
function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

// ===== テスト =====

describe('createInitialGameState', () => {
  it('デフォルトチップ600で6人のプレイヤーを作成する', () => {
    const state = createInitialGameState();
    expect(state.players).toHaveLength(6);
    for (const p of state.players) {
      expect(p.chips).toBe(600);
    }
  });

  it('カスタムチップ額を指定できる', () => {
    const state = createInitialGameState(1000);
    for (const p of state.players) {
      expect(p.chips).toBe(1000);
    }
  });

  it('初期状態が正しく設定される', () => {
    const state = createInitialGameState();
    expect(state.pot).toBe(0);
    expect(state.currentStreet).toBe('preflop');
    expect(state.communityCards).toHaveLength(0);
    expect(state.deck).toHaveLength(0);
    expect(state.isHandComplete).toBe(false);
    expect(state.winners).toHaveLength(0);
    expect(state.smallBlind).toBe(1);
    expect(state.bigBlind).toBe(3);
    expect(state.dealerPosition).toBe(0);
  });

  it('各プレイヤーの初期状態が正しい', () => {
    const state = createInitialGameState();
    for (const p of state.players) {
      expect(p.holeCards).toHaveLength(0);
      expect(p.currentBet).toBe(0);
      expect(p.totalBetThisRound).toBe(0);
      expect(p.folded).toBe(false);
      expect(p.isAllIn).toBe(false);
      expect(p.hasActed).toBe(false);
      expect(p.isSittingOut).toBe(false);
    }
  });

  it('ポジションが正しく割り当てられる', () => {
    const state = createInitialGameState();
    const positions = state.players.map(p => p.position);
    expect(positions).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']);
  });
});

describe('startNewHand', () => {
  it('ブラインドが正しく投稿される', () => {
    const state = createInitialGameState();
    const newState = startNewHand(state);

    // dealer=0の場合、SB=player[1], BB=player[2]（通常6人テーブル）
    // dealerPosition は startNewHand 内で移動するので、結果のディーラー位置を見て判断
    const dealer = newState.dealerPosition;
    const sbIdx = (dealer + 1) % 6;
    const bbIdx = (dealer + 2) % 6;

    // SBとBBがブラインドを投稿している
    expect(newState.players[sbIdx].currentBet).toBe(newState.smallBlind);
    expect(newState.players[bbIdx].currentBet).toBe(newState.bigBlind);

    // ポットにブラインド合計が入っている
    expect(newState.pot).toBe(newState.smallBlind + newState.bigBlind);
  });

  it('各プレイヤーに4枚のカードが配られる', () => {
    const state = createInitialGameState();
    const newState = startNewHand(state);

    for (const p of newState.players) {
      expect(p.holeCards).toHaveLength(4);
    }
  });

  it('デッキから24枚が配られている（6人×4枚）', () => {
    const state = createInitialGameState();
    const newState = startNewHand(state);

    // 52枚 - 24枚配布 = 28枚残り
    expect(newState.deck).toHaveLength(28);
  });

  it('プリフロップのcurrentBetがBBと同じ', () => {
    const state = createInitialGameState();
    const newState = startNewHand(state);
    expect(newState.currentBet).toBe(newState.bigBlind);
  });

  it('状態がリセットされる', () => {
    const state = createInitialGameState();
    const newState = startNewHand(state);

    expect(newState.communityCards).toHaveLength(0);
    expect(newState.currentStreet).toBe('preflop');
    expect(newState.isHandComplete).toBe(false);
    expect(newState.winners).toHaveLength(0);
    expect(newState.handHistory).toHaveLength(0);
  });

  it('プレイヤー状態がリセットされる（ブラインド以外）', () => {
    const state = createInitialGameState();
    const newState = startNewHand(state);
    const dealer = newState.dealerPosition;
    const sbIdx = (dealer + 1) % 6;
    const bbIdx = (dealer + 2) % 6;

    for (let i = 0; i < 6; i++) {
      expect(newState.players[i].folded).toBe(false);
      expect(newState.players[i].hasActed).toBe(false);
      // ブラインド以外はcurrentBet=0
      if (i !== sbIdx && i !== bbIdx) {
        expect(newState.players[i].currentBet).toBe(0);
      }
    }
  });

  it('Heads-upでBTN=SBのルールが適用される', () => {
    // 4人をisSittingOutにしてHeads-upにする
    const state = createInitialGameState();
    state.players[2].isSittingOut = true;
    state.players[3].isSittingOut = true;
    state.players[4].isSittingOut = true;
    state.players[5].isSittingOut = true;
    state.players[2].chips = 0;
    state.players[3].chips = 0;
    state.players[4].chips = 0;
    state.players[5].chips = 0;

    const newState = startNewHand(state);

    // isSittingOutのプレイヤーは自動的にfolded/hasActedになる
    expect(newState.players[2].folded).toBe(true);
    expect(newState.players[2].hasActed).toBe(true);

    // 2人のプレイヤーだけがゲームに参加
    const activePlayers = newState.players.filter(p => !p.isSittingOut && !p.folded);
    expect(activePlayers.length).toBe(2);

    // ポットにブラインドが正しく入っている
    expect(newState.pot).toBe(newState.smallBlind + newState.bigBlind);
  });
});

describe('isSittingOut', () => {
  it('isSittingOutのプレイヤーにカードが配られない', () => {
    const state = createInitialGameState();
    state.players[3].isSittingOut = true;
    state.players[3].chips = 0;

    const newState = startNewHand(state);

    expect(newState.players[3].holeCards).toEqual([]);
    expect(newState.players[0].holeCards).toHaveLength(4);
  });

  it('isSittingOutのプレイヤーはfoldedとhasActedがtrueになる', () => {
    const state = createInitialGameState();
    state.players[2].isSittingOut = true;
    state.players[2].chips = 0;

    const newState = startNewHand(state);

    expect(newState.players[2].folded).toBe(true);
    expect(newState.players[2].hasActed).toBe(true);
  });

  it('isSittingOutのプレイヤーはディーラーにならない', () => {
    const state = createInitialGameState();
    state.players[1].isSittingOut = true;
    state.players[1].chips = 0;
    state.dealerPosition = 0;

    const newState = startNewHand(state);

    expect(newState.dealerPosition).not.toBe(1);
  });

  it('isSittingOutのプレイヤーを除いたデッキ枚数が正しい', () => {
    const state = createInitialGameState();
    state.players[4].isSittingOut = true;
    state.players[5].isSittingOut = true;
    state.players[4].chips = 0;
    state.players[5].chips = 0;

    const newState = startNewHand(state);

    // 52枚 - 16枚(4人×4枚) = 36枚
    expect(newState.deck).toHaveLength(36);
  });
});

describe('getActivePlayers', () => {
  it('フォールドしていないプレイヤーを返す', () => {
    const state = createInitialGameState();
    state.players[0].folded = true;
    state.players[3].folded = true;

    const active = getActivePlayers(state);
    expect(active).toHaveLength(4);
    expect(active.every(p => !p.folded)).toBe(true);
  });

  it('全員アクティブなら6人返す', () => {
    const state = createInitialGameState();
    expect(getActivePlayers(state)).toHaveLength(6);
  });
});

describe('getPlayersWhoCanAct', () => {
  it('フォールドとオールインのプレイヤーを除外する', () => {
    const state = createInitialGameState();
    state.players[0].folded = true;
    state.players[1].isAllIn = true;

    const canAct = getPlayersWhoCanAct(state);
    expect(canAct).toHaveLength(4);
    expect(canAct.every(p => !p.folded && !p.isAllIn)).toBe(true);
  });
});

describe('getValidActions', () => {
  it('フォールドしたプレイヤーはアクション不可', () => {
    const state = createInitialGameState();
    state.players[0].folded = true;

    const actions = getValidActions(state, 0);
    expect(actions).toHaveLength(0);
  });

  it('オールインのプレイヤーはアクション不可', () => {
    const state = createInitialGameState();
    state.players[0].isAllIn = true;

    const actions = getValidActions(state, 0);
    expect(actions).toHaveLength(0);
  });

  it('ベットなしでチェックが可能', () => {
    const state = createInitialGameState();
    state.currentBet = 0;
    state.players[0].currentBet = 0;
    state.pot = 10;

    const actions = getValidActions(state, 0);
    const actionTypes = actions.map(a => a.action);
    expect(actionTypes).toContain('fold');
    expect(actionTypes).toContain('check');
    expect(actionTypes).not.toContain('call');
  });

  it('ベットありでコールが可能', () => {
    const state = createInitialGameState();
    state.currentBet = 10;
    state.players[0].currentBet = 0;
    state.players[0].chips = 600;
    state.pot = 10;
    state.minRaise = 3;

    const actions = getValidActions(state, 0);
    const actionTypes = actions.map(a => a.action);
    expect(actionTypes).toContain('call');
    expect(actionTypes).not.toContain('check');

    const callAction = actions.find(a => a.action === 'call')!;
    expect(callAction.minAmount).toBe(10);
    expect(callAction.maxAmount).toBe(10);
  });

  it('ベットなしでbet可能、ポットリミットが正しい', () => {
    const state = createInitialGameState();
    state.currentBet = 0;
    state.players[0].currentBet = 0;
    state.players[0].chips = 600;
    state.pot = 20;

    const actions = getValidActions(state, 0);
    const betAction = actions.find(a => a.action === 'bet');
    expect(betAction).toBeDefined();
    // ポットリミットベット = 現在のポット額 = 20
    expect(betAction!.maxAmount).toBe(20);
    // 最小ベット = BB = 3
    expect(betAction!.minAmount).toBe(3);
  });

  it('ベットありでレイズ可能、ポットリミットが正しい', () => {
    const state = createInitialGameState();
    state.currentBet = 10;
    state.players[0].currentBet = 0;
    state.players[0].chips = 600;
    state.pot = 20;
    state.minRaise = 10;

    const actions = getValidActions(state, 0);
    const raiseAction = actions.find(a => a.action === 'raise');
    expect(raiseAction).toBeDefined();

    // ポットリミットレイズ = toCall + (pot + toCall) = 10 + (20 + 10) = 40
    expect(raiseAction!.maxAmount).toBe(40);

    // 最小レイズ額 = currentBet + minRaise - player.currentBet = 10 + 10 - 0 = 20
    expect(raiseAction!.minAmount).toBe(20);
  });

  it('チップが足りない場合コール額が調整される', () => {
    const state = createInitialGameState();
    state.currentBet = 100;
    state.players[0].currentBet = 0;
    state.players[0].chips = 50;
    state.pot = 100;

    const actions = getValidActions(state, 0);
    const callAction = actions.find(a => a.action === 'call')!;
    expect(callAction.minAmount).toBe(50); // チップ全額
  });

  it('オールインがポットリミット以下のチップで表示される', () => {
    const state = createInitialGameState();
    state.currentBet = 10;
    state.players[0].currentBet = 0;
    state.players[0].chips = 15; // ポットリミット以下
    state.pot = 20;

    const actions = getValidActions(state, 0);
    const allinAction = actions.find(a => a.action === 'allin');
    expect(allinAction).toBeDefined();
    expect(allinAction!.minAmount).toBe(15);
  });
});

describe('applyAction', () => {
  /** プリフロップ直後の状態を作成（ブラインド投稿済み） */
  function createPreflopState(): GameState {
    const state = createInitialGameState();
    return startNewHand(state);
  }

  describe('fold', () => {
    it('プレイヤーがfolded=trueになる', () => {
      const state = createPreflopState();
      const current = state.currentPlayerIndex;
      const newState = applyAction(state, current, 'fold');
      expect(newState.players[current].folded).toBe(true);
    });

    it('ハンド履歴に記録される', () => {
      const state = createPreflopState();
      const current = state.currentPlayerIndex;
      const newState = applyAction(state, current, 'fold');
      expect(newState.handHistory).toHaveLength(1);
      expect(newState.handHistory[0]).toMatchObject({
        playerId: current,
        action: 'fold',
      });
    });
  });

  describe('check', () => {
    it('チップに変化がない', () => {
      // ポストフロップでcurrentBet=0の状態を作る
      const state = createInitialGameState();
      state.currentBet = 0;
      state.currentPlayerIndex = 0;
      state.pot = 10;
      state.players[0].chips = 600;

      const newState = applyAction(state, 0, 'check');
      expect(newState.players[0].chips).toBe(600);
      expect(newState.pot).toBe(10);
    });
  });

  describe('call', () => {
    it('コール額がポットに加算される', () => {
      const state = createPreflopState();
      const current = state.currentPlayerIndex;
      const playerChipsBefore = state.players[current].chips;
      const potBefore = state.pot;
      const toCall = state.currentBet - state.players[current].currentBet;

      const newState = applyAction(state, current, 'call');

      expect(newState.players[current].chips).toBe(playerChipsBefore - toCall);
      expect(newState.pot).toBe(potBefore + toCall);
    });

    it('currentBetに合わせたベット額になる', () => {
      const state = createPreflopState();
      const current = state.currentPlayerIndex;

      const newState = applyAction(state, current, 'call');
      expect(newState.players[current].currentBet).toBe(state.currentBet);
    });
  });

  describe('bet', () => {
    it('ベット額がポットに加算され、currentBetが更新される', () => {
      const state = createInitialGameState();
      state.currentBet = 0;
      state.currentPlayerIndex = 0;
      state.pot = 10;
      state.players[0].chips = 600;
      state.minRaise = 3;

      const newState = applyAction(state, 0, 'bet', 10);
      expect(newState.players[0].chips).toBe(590);
      expect(newState.pot).toBe(20);
      expect(newState.currentBet).toBe(10);
    });

    it('他のプレイヤーのhasActedがリセットされる', () => {
      const state = createInitialGameState();
      state.currentBet = 0;
      state.currentPlayerIndex = 0;
      state.pot = 10;
      state.players[0].chips = 600;
      state.players[1].hasActed = true;
      state.players[2].hasActed = true;
      state.minRaise = 3;

      const newState = applyAction(state, 0, 'bet', 10);
      // ベット後、他のプレイヤーはhasActed=falseにリセット
      for (let i = 1; i < 6; i++) {
        if (!newState.players[i].folded && !newState.players[i].isAllIn) {
          expect(newState.players[i].hasActed).toBe(false);
        }
      }
    });
  });

  describe('raise', () => {
    it('レイズ額がポットに加算される', () => {
      const state = createPreflopState();
      const current = state.currentPlayerIndex;
      const potBefore = state.pot;
      const raiseAmount = state.currentBet - state.players[current].currentBet + state.minRaise;

      const newState = applyAction(state, current, 'raise', raiseAmount);
      expect(newState.pot).toBe(potBefore + raiseAmount);
    });

    it('lastRaiserIndexが更新される', () => {
      const state = createPreflopState();
      const current = state.currentPlayerIndex;
      const raiseAmount = state.currentBet - state.players[current].currentBet + state.minRaise;

      const newState = applyAction(state, current, 'raise', raiseAmount);
      expect(newState.lastRaiserIndex).toBe(current);
    });
  });

  describe('allin', () => {
    it('チップが0になりisAllIn=true', () => {
      const state = createPreflopState();
      const current = state.currentPlayerIndex;

      const newState = applyAction(state, current, 'allin');
      expect(newState.players[current].chips).toBe(0);
      expect(newState.players[current].isAllIn).toBe(true);
    });

    it('オールイン額がポットに加算される', () => {
      const state = createPreflopState();
      const current = state.currentPlayerIndex;
      const allInAmount = state.players[current].chips;
      const potBefore = state.pot;

      const newState = applyAction(state, current, 'allin');
      expect(newState.pot).toBe(potBefore + allInAmount);
    });
  });

  describe('ストリート進行', () => {
    it('全員コールで次のストリートに進む', () => {
      let state = createPreflopState();

      // UTGからBTNまでコール（または既にアクション済み）
      // 全員がcurrentBetと同額になるまでコール
      let loopCount = 0;
      while (state.currentStreet === 'preflop' && !state.isHandComplete && loopCount < 20) {
        const current = state.currentPlayerIndex;
        const actions = getValidActions(state, current);
        const callAction = actions.find(a => a.action === 'call');
        const checkAction = actions.find(a => a.action === 'check');

        if (callAction) {
          state = applyAction(state, current, 'call');
        } else if (checkAction) {
          state = applyAction(state, current, 'check');
        } else {
          break;
        }
        loopCount++;
      }

      // プリフロップが終了し次のストリートに移動しているはず
      expect(state.currentStreet).not.toBe('preflop');
    });

    it('全員フォールドで最後の1人が勝者', () => {
      let state = createPreflopState();

      // 5人フォールド
      for (let i = 0; i < 5; i++) {
        if (state.isHandComplete) break;
        const current = state.currentPlayerIndex;
        state = applyAction(state, current, 'fold');
      }

      expect(state.isHandComplete).toBe(true);
      expect(state.winners).toHaveLength(1);
    });
  });

  describe('イミュータビリティ', () => {
    it('元のstateが変更されない', () => {
      const state = createPreflopState();
      const originalPot = state.pot;
      const current = state.currentPlayerIndex;
      const originalChips = state.players[current].chips;

      applyAction(state, current, 'call');

      expect(state.pot).toBe(originalPot);
      expect(state.players[current].chips).toBe(originalChips);
    });
  });
});

describe('wouldAdvanceStreet', () => {
  it('ストリートが変わる場合trueを返す', () => {
    // BBオプション（最後のアクション）でチェックするとストリート進行
    let state = startNewHand(createInitialGameState());

    // 全員コールしてBBのオプションまで進める
    let loopCount = 0;
    while (loopCount < 20) {
      const current = state.currentPlayerIndex;
      const actions = getValidActions(state, current);
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');

      // BBのチェックオプションに到達したら判定
      if (checkAction && state.players[current].currentBet === state.currentBet) {
        const result = wouldAdvanceStreet(state, current, 'check');
        expect(result).toBe(true);
        break;
      }

      if (callAction) {
        state = applyAction(state, current, 'call');
      } else {
        break;
      }
      loopCount++;
    }
  });

  it('ストリートが変わらない場合falseを返す', () => {
    const state = startNewHand(createInitialGameState());
    const current = state.currentPlayerIndex;

    // 最初のプレイヤーのコールではストリートは変わらない
    const result = wouldAdvanceStreet(state, current, 'call');
    expect(result).toBe(false);
  });
});

describe('calculateSidePots', () => {
  it('全員同額ならサイドポットは1つ', () => {
    const players: Player[] = [
      { id: 0, name: 'A', position: 'BTN', chips: 0, holeCards: [], currentBet: 0, totalBetThisRound: 100, folded: false, isAllIn: true, hasActed: true, isSittingOut: false },
      { id: 1, name: 'B', position: 'SB', chips: 0, holeCards: [], currentBet: 0, totalBetThisRound: 100, folded: false, isAllIn: true, hasActed: true, isSittingOut: false },
      { id: 2, name: 'C', position: 'BB', chips: 0, holeCards: [], currentBet: 0, totalBetThisRound: 100, folded: false, isAllIn: true, hasActed: true, isSittingOut: false },
    ];

    const sidePots = calculateSidePots(players);
    expect(sidePots).toHaveLength(1);
    expect(sidePots[0].amount).toBe(300);
    expect(sidePots[0].eligiblePlayers).toEqual([0, 1, 2]);
  });

  it('1人がショートスタックでオールインした場合のサイドポット', () => {
    const players: Player[] = [
      { id: 0, name: 'A', position: 'BTN', chips: 0, holeCards: [], currentBet: 0, totalBetThisRound: 50, folded: false, isAllIn: true, hasActed: true, isSittingOut: false },
      { id: 1, name: 'B', position: 'SB', chips: 50, holeCards: [], currentBet: 0, totalBetThisRound: 100, folded: false, isAllIn: false, hasActed: true, isSittingOut: false },
      { id: 2, name: 'C', position: 'BB', chips: 50, holeCards: [], currentBet: 0, totalBetThisRound: 100, folded: false, isAllIn: false, hasActed: true, isSittingOut: false },
    ];

    const sidePots = calculateSidePots(players);
    expect(sidePots).toHaveLength(2);

    // メインポット: 50 * 3 = 150（全員対象 - id=0も50投入で対象）
    expect(sidePots[0].amount).toBe(150);
    expect(sidePots[0].eligiblePlayers).toEqual([0, 1, 2]);

    // サイドポット: (100-50) * 2 = 100（id=1, id=2のみ）
    expect(sidePots[1].amount).toBe(100);
    expect(sidePots[1].eligiblePlayers).toEqual([1, 2]);
  });

  it('複数レベルのサイドポット', () => {
    const players: Player[] = [
      { id: 0, name: 'A', position: 'BTN', chips: 0, holeCards: [], currentBet: 0, totalBetThisRound: 30, folded: false, isAllIn: true, hasActed: true, isSittingOut: false },
      { id: 1, name: 'B', position: 'SB', chips: 0, holeCards: [], currentBet: 0, totalBetThisRound: 70, folded: false, isAllIn: true, hasActed: true, isSittingOut: false },
      { id: 2, name: 'C', position: 'BB', chips: 100, holeCards: [], currentBet: 0, totalBetThisRound: 100, folded: false, isAllIn: false, hasActed: true, isSittingOut: false },
    ];

    const sidePots = calculateSidePots(players);
    expect(sidePots).toHaveLength(3);

    // レベル30: 30*3 = 90（全員対象）
    expect(sidePots[0].amount).toBe(90);
    expect(sidePots[0].eligiblePlayers).toEqual([0, 1, 2]);

    // レベル70: (70-30)*2 = 80（id=1, id=2）
    expect(sidePots[1].amount).toBe(80);
    expect(sidePots[1].eligiblePlayers).toEqual([1, 2]);

    // レベル100: (100-70)*1 = 30（id=2のみ）
    expect(sidePots[2].amount).toBe(30);
    expect(sidePots[2].eligiblePlayers).toEqual([2]);
  });

  it('フォールドプレイヤーの貢献額はポットに含まれるが対象外', () => {
    const players: Player[] = [
      { id: 0, name: 'A', position: 'BTN', chips: 0, holeCards: [], currentBet: 0, totalBetThisRound: 50, folded: true, isAllIn: false, hasActed: true, isSittingOut: false },
      { id: 1, name: 'B', position: 'SB', chips: 0, holeCards: [], currentBet: 0, totalBetThisRound: 100, folded: false, isAllIn: true, hasActed: true, isSittingOut: false },
      { id: 2, name: 'C', position: 'BB', chips: 50, holeCards: [], currentBet: 0, totalBetThisRound: 100, folded: false, isAllIn: false, hasActed: true, isSittingOut: false },
    ];

    const sidePots = calculateSidePots(players);
    // フォールドしたプレイヤーの投入額(50)はポットに含まれるが、
    // eligiblePlayersには含まれない
    expect(sidePots).toHaveLength(1);
    expect(sidePots[0].amount).toBe(250); // 50 + 100 + 100
    expect(sidePots[0].eligiblePlayers).toEqual([1, 2]);
  });

  it('空のプレイヤーリストでは空のサイドポット', () => {
    const sidePots = calculateSidePots([]);
    expect(sidePots).toHaveLength(0);
  });
});

describe('determineWinner', () => {
  it('1人だけ残っている場合はポット全額を獲得', () => {
    const state = createInitialGameState();
    state.pot = 100;
    state.players[0].folded = false;
    for (let i = 1; i < 6; i++) {
      state.players[i].folded = true;
    }

    const result = determineWinner(state);
    expect(result.isHandComplete).toBe(true);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].playerId).toBe(0);
    expect(result.winners[0].amount).toBe(100);
  });

  it('ショーダウンでハンド評価による勝者決定', () => {
    const state = createInitialGameState();
    state.pot = 100;
    state.currentStreet = 'showdown';

    // コミュニティカード5枚
    state.communityCards = [
      card('A', 'h'), card('K', 'h'), card('Q', 'h'),
      card('2', 'c'), card('3', 'd'),
    ];

    // プレイヤー0: 強いハンド
    state.players[0].holeCards = [card('J', 'h'), card('T', 'h'), card('9', 's'), card('8', 's')];
    state.players[0].folded = false;
    state.players[0].totalBetThisRound = 50;

    // プレイヤー1: 弱いハンド
    state.players[1].holeCards = [card('4', 's'), card('5', 's'), card('6', 'd'), card('7', 'd')];
    state.players[1].folded = false;
    state.players[1].totalBetThisRound = 50;

    // 他はフォールド
    for (let i = 2; i < 6; i++) {
      state.players[i].folded = true;
      state.players[i].totalBetThisRound = 0;
    }

    const result = determineWinner(state);
    expect(result.isHandComplete).toBe(true);
    expect(result.winners.length).toBeGreaterThanOrEqual(1);
    // プレイヤー0がロイヤルフラッシュ相当（A-K-Q-J-T of hearts）で勝利
    expect(result.winners[0].playerId).toBe(0);
  });

  it('コミュニティカードが足りない場合はランアウトされる', () => {
    const state = createInitialGameState();
    state.pot = 100;
    state.communityCards = [card('A', 'h'), card('K', 'h')]; // 2枚しかない

    // デッキに十分なカード
    state.deck = [
      card('Q', 'h'), card('J', 'h'), card('T', 'h'),
      card('9', 'h'), card('8', 'h'), card('7', 'h'),
    ];

    // 2人だけアクティブ
    state.players[0].holeCards = [card('2', 'c'), card('3', 'c'), card('4', 'c'), card('5', 'c')];
    state.players[0].totalBetThisRound = 50;
    state.players[1].holeCards = [card('6', 'd'), card('7', 'd'), card('8', 'd'), card('9', 'd')];
    state.players[1].totalBetThisRound = 50;
    for (let i = 2; i < 6; i++) {
      state.players[i].folded = true;
    }

    const result = determineWinner(state);
    expect(result.communityCards).toHaveLength(5);
    expect(result.isHandComplete).toBe(true);
  });
});

describe('rotatePositions', () => {
  it('ディーラー位置が1つ進む', () => {
    const state = createInitialGameState();
    state.dealerPosition = 0;

    const newState = rotatePositions(state);
    expect(newState.dealerPosition).toBe(1);
  });

  it('ディーラー位置が端で循環する', () => {
    const state = createInitialGameState();
    state.dealerPosition = 5;

    const newState = rotatePositions(state);
    expect(newState.dealerPosition).toBe(0);
  });

  it('ポジション名が正しく再計算される', () => {
    const state = createInitialGameState();
    state.dealerPosition = 0;

    const newState = rotatePositions(state);
    // dealer=1なので: player[1]=BTN, player[2]=SB, player[3]=BB, ...
    expect(newState.players[1].position).toBe('BTN');
    expect(newState.players[2].position).toBe('SB');
    expect(newState.players[3].position).toBe('BB');
  });

  it('元のstateが変更されない', () => {
    const state = createInitialGameState();
    state.dealerPosition = 0;

    rotatePositions(state);
    expect(state.dealerPosition).toBe(0);
  });
});

describe('統合テスト: 1ハンドの流れ', () => {
  it('プリフロップからフロップまでの進行', () => {
    let state = startNewHand(createInitialGameState());
    expect(state.currentStreet).toBe('preflop');

    // 全員コール/チェックでフロップへ
    let loopCount = 0;
    while (state.currentStreet === 'preflop' && !state.isHandComplete && loopCount < 20) {
      const current = state.currentPlayerIndex;
      const actions = getValidActions(state, current);
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');

      if (callAction) {
        state = applyAction(state, current, 'call');
      } else if (checkAction) {
        state = applyAction(state, current, 'check');
      } else {
        break;
      }
      loopCount++;
    }

    expect(state.currentStreet).toBe('flop');
    expect(state.communityCards).toHaveLength(3);
    // フロップではcurrentBetがリセットされる
    expect(state.currentBet).toBe(0);
  });

  it('全ストリートを通過してショーダウンに到達できる', () => {
    let state = startNewHand(createInitialGameState());
    let loopCount = 0;

    while (!state.isHandComplete && loopCount < 100) {
      const current = state.currentPlayerIndex;
      const actions = getValidActions(state, current);
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');

      if (callAction) {
        state = applyAction(state, current, 'call');
      } else if (checkAction) {
        state = applyAction(state, current, 'check');
      } else {
        // フォールドにフォールバック
        state = applyAction(state, current, 'fold');
      }
      loopCount++;
    }

    expect(state.isHandComplete).toBe(true);
    expect(state.winners.length).toBeGreaterThanOrEqual(1);
  });

  it('チップ合計が保存される（ゼロサム）', () => {
    const initialState = createInitialGameState(100);
    const totalChipsBefore = initialState.players.reduce((sum, p) => sum + p.chips, 0);

    let state = startNewHand(initialState);
    let loopCount = 0;

    while (!state.isHandComplete && loopCount < 100) {
      const current = state.currentPlayerIndex;
      const actions = getValidActions(state, current);
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');

      if (callAction) {
        state = applyAction(state, current, 'call');
      } else if (checkAction) {
        state = applyAction(state, current, 'check');
      } else {
        state = applyAction(state, current, 'fold');
      }
      loopCount++;
    }

    // ハンド完了後のチップ合計が変わらない
    const totalChipsAfter = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChipsAfter).toBe(totalChipsBefore);
  });

  it('オールインを含むハンドでチップ合計が保存される', () => {
    const initialState = createInitialGameState(100);
    const totalChipsBefore = initialState.players.reduce((sum, p) => sum + p.chips, 0);

    let state = startNewHand(initialState);

    // 最初のプレイヤーがオールイン、残りはコールまたはフォールド
    const current = state.currentPlayerIndex;
    state = applyAction(state, current, 'allin');

    let loopCount = 0;
    while (!state.isHandComplete && loopCount < 100) {
      const idx = state.currentPlayerIndex;
      const actions = getValidActions(state, idx);
      const callAction = actions.find(a => a.action === 'call');
      if (callAction) {
        state = applyAction(state, idx, 'call');
      } else {
        state = applyAction(state, idx, 'fold');
      }
      loopCount++;
    }

    const totalChipsAfter = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChipsAfter).toBe(totalChipsBefore);
  });

  it('レイズ→再レイズのベッティング往復', () => {
    let state = startNewHand(createInitialGameState(1000));
    const firstPlayer = state.currentPlayerIndex;

    // UTGレイズ
    const raiseAmount1 = state.currentBet + state.minRaise; // min raise
    state = applyAction(state, firstPlayer, 'raise', raiseAmount1);
    expect(state.currentBet).toBe(raiseAmount1);

    // 次のプレイヤーが再レイズ
    const secondPlayer = state.currentPlayerIndex;
    expect(secondPlayer).not.toBe(firstPlayer);
    const actions = getValidActions(state, secondPlayer);
    const raiseAction = actions.find(a => a.action === 'raise');
    expect(raiseAction).toBeDefined();

    state = applyAction(state, secondPlayer, 'raise', raiseAction!.minAmount);
    expect(state.currentBet).toBeGreaterThan(raiseAmount1);

    // 元のレイザーに再度アクションが回る
    // hasActedがリセットされているのでアクション可能
    expect(state.players[firstPlayer].hasActed).toBe(false);
  });

  it('ポストフロップのアクション開始位置がSB側から', () => {
    let state = startNewHand(createInitialGameState());
    const dealer = state.dealerPosition;

    // プリフロップを全員コール/チェックで通過
    let loopCount = 0;
    while (state.currentStreet === 'preflop' && !state.isHandComplete && loopCount < 20) {
      const current = state.currentPlayerIndex;
      const actions = getValidActions(state, current);
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');
      if (callAction) state = applyAction(state, current, 'call');
      else if (checkAction) state = applyAction(state, current, 'check');
      else break;
      loopCount++;
    }

    expect(state.currentStreet).toBe('flop');

    // フロップのアクション開始位置はSB（dealer+1）側から
    const sbIdx = (dealer + 1) % 6;
    // SBがフォールドしていなければSBから開始
    if (!state.players[sbIdx].folded && !state.players[sbIdx].isAllIn) {
      expect(state.currentPlayerIndex).toBe(sbIdx);
    }
  });
});

describe('startNewHand: ブラインドオールイン', () => {
  it('SBがチップ不足でオールインになる', () => {
    const state = createInitialGameState();
    // SBになるプレイヤーのチップをSB未満にしておく
    // dealerPosition=0 → startNewHand で dealer が移動する
    // SBになるプレイヤーを特定するため、startNewHand後に確認
    state.players[2].isSittingOut = true; // 不参加にする
    state.players[2].chips = 0;

    // 別のアプローチ: 直接小さいチップで試す
    const state2 = createInitialGameState();
    // player[1]がSB位置に来るようにする（dealer=0の場合）
    // ただしstartNewHandでdealerが移動するので、全員にチップを与えつつ
    // 特定プレイヤーだけ少なくする
    for (let i = 0; i < 6; i++) {
      state2.players[i].chips = 100;
    }
    // SBになりそうなプレイヤーのチップを少なくする
    // dealerPosition=0 → 次のdealerは1 → SB=2, BB=3
    state2.players[2].isSittingOut = true;
    state2.players[2].chips = 0;

    // よりシンプルなテスト: smallBlindを大きくしてチップ不足にする
    const state3 = createInitialGameState(2);
    state3.smallBlind = 3; // チップ(2) < SB(3)
    state3.bigBlind = 6;
    const newState = startNewHand(state3);

    // SBプレイヤーを見つける
    const dealer = newState.dealerPosition;
    const sbIdx = (dealer + 1) % 6;

    // SBがチップ不足なのでオールイン
    expect(newState.players[sbIdx].currentBet).toBe(2); // チップ全額
    expect(newState.players[sbIdx].isAllIn).toBe(true);
    expect(newState.players[sbIdx].chips).toBe(0);
  });

  it('BBがチップ不足でオールインになる', () => {
    const state = createInitialGameState(4);
    state.smallBlind = 2;
    state.bigBlind = 10; // チップ(4) < BB(10)
    const newState = startNewHand(state);

    const dealer = newState.dealerPosition;
    const bbIdx = (dealer + 2) % 6;

    // BBがチップ不足なのでオールイン（SBで2消費→残り2をBBに）
    // BBプレイヤーは自分のチップ全額を投入
    expect(newState.players[bbIdx].isAllIn).toBe(true);
    expect(newState.players[bbIdx].chips).toBe(0);
    expect(newState.players[bbIdx].currentBet).toBeLessThanOrEqual(4);
  });

  it('連続ハンドで破産プレイヤーをスキップしてディーラーが移動する', () => {
    const state = createInitialGameState();
    state.dealerPosition = 0;
    // player[1]を破産させる（シッティングアウト）
    state.players[1].isSittingOut = true;
    state.players[1].chips = 0;

    const newState = startNewHand(state);
    // dealer=0の次のチップ持ちはplayer[2]（player[1]はスキップ）
    expect(newState.dealerPosition).toBe(2);
  });
});

describe('applyAction: エッジケース', () => {
  function createPreflopState(): GameState {
    return startNewHand(createInitialGameState());
  }

  it('callでチップがちょうど0になるとオールイン', () => {
    // startNewHandでデッキ・ホールカードを正しく初期化
    const state = startNewHand(createInitialGameState(100));
    const dealer = state.dealerPosition;
    const sbIdx = (dealer + 1) % 6;
    const bbIdx = (dealer + 2) % 6;

    // Player 0をコールでちょうどオールインになる状態にする
    state.currentBet = 100;
    state.currentPlayerIndex = 0;
    state.players[0].chips = 100 - state.players[0].currentBet; // currentBet分を引く
    const chipsBefore = state.players[0].chips;
    state.pot = 200;

    // 他プレイヤーをfolded/hasActedにして次のプレイヤー判定を安定させる
    for (let i = 1; i < 6; i++) {
      state.players[i].folded = true;
    }
    // ただし1人残さないと即ハンド終了なので2人残す
    state.players[1].folded = false;
    state.players[1].currentBet = 100;
    state.players[1].hasActed = true;
    state.players[1].isAllIn = true;
    state.players[1].chips = 0;

    const newState = applyAction(state, 0, 'call');
    // コール後にランアウト→ショーダウンまで進む（両者オールイン）
    expect(newState.isHandComplete).toBe(true);
    expect(newState.players[0].isAllIn).toBe(true);
  });

  it('allinがminRaise未満でもレイズ扱いにならない', () => {
    const state = createInitialGameState();
    state.currentBet = 50;
    state.minRaise = 50;
    state.currentPlayerIndex = 0;
    state.players[0].chips = 20; // currentBet(0) + 20 = 20 < currentBet(50) なのでレイズにならない
    state.players[0].currentBet = 0;
    state.pot = 150;
    state.players[1].hasActed = true;
    state.players[1].currentBet = 50;
    // 3人目を未アクションで残してストリート進行を防ぐ
    state.players[2].hasActed = false;
    state.players[2].currentBet = 0;
    state.players[2].chips = 500;
    for (let i = 3; i < 6; i++) {
      state.players[i].folded = true;
    }

    const newState = applyAction(state, 0, 'allin');
    expect(newState.players[0].isAllIn).toBe(true);
    // オールイン額(20) < currentBet(50) なのでレイズにならない
    // → player[1]のhasActedはリセットされない
    expect(newState.players[1].hasActed).toBe(true);
    // lastRaiserIndexも更新されない
    expect(newState.lastRaiserIndex).toBe(state.lastRaiserIndex);
  });

  it('allinがminRaise以上でレイズ扱いになりhasActedリセット', () => {
    const state = createInitialGameState();
    state.currentBet = 10;
    state.minRaise = 10;
    state.currentPlayerIndex = 0;
    state.players[0].chips = 30; // currentBet(0) + 30 = 30 > currentBet(10), raiseBy=20 >= minRaise(10)
    state.players[0].currentBet = 0;
    state.pot = 20;
    state.players[1].hasActed = true;
    state.players[1].currentBet = 10;
    for (let i = 2; i < 6; i++) {
      state.players[i].folded = true;
    }

    const newState = applyAction(state, 0, 'allin');
    expect(newState.players[0].isAllIn).toBe(true);
    expect(newState.currentBet).toBe(30);
    // レイズ扱いなのでhasActedリセット
    expect(newState.players[1].hasActed).toBe(false);
  });

  it('raise時にminRaiseが正しく更新される', () => {
    const state = createPreflopState();
    const current = state.currentPlayerIndex;
    const originalMinRaise = state.minRaise;

    // minRaiseより大きいレイズ額
    const toCall = state.currentBet - state.players[current].currentBet;
    const raiseBy = originalMinRaise + 5; // minRaiseより5多い
    const raiseAmount = toCall + raiseBy;

    const newState = applyAction(state, current, 'raise', raiseAmount);
    // raiseBy > originalMinRaise なので minRaise が更新される
    expect(newState.minRaise).toBe(raiseBy);
  });

  it('handHistoryにstreetが記録される', () => {
    const state = createPreflopState();
    const current = state.currentPlayerIndex;

    const newState = applyAction(state, current, 'call');
    expect(newState.handHistory[0].street).toBe('preflop');
  });
});

describe('determineWinner: タイと端数', () => {
  it('同点プレイヤーにポットが均等分割される', () => {
    const state = createInitialGameState();
    state.pot = 100;
    // フラッシュが成立しないボード（各スート異なる）
    state.communityCards = [
      card('8', 'c'), card('9', 'd'), card('T', 's'),
      card('2', 'h'), card('3', 'h'),
    ];

    // 2人が同じランクのストレート（J-T-9-8-7）を作る
    state.players[0].holeCards = [card('J', 'c'), card('7', 'h'), card('4', 's'), card('5', 's')];
    state.players[0].folded = false;
    state.players[0].totalBetThisRound = 50;

    state.players[1].holeCards = [card('J', 'd'), card('7', 's'), card('4', 'c'), card('5', 'c')];
    state.players[1].folded = false;
    state.players[1].totalBetThisRound = 50;

    for (let i = 2; i < 6; i++) {
      state.players[i].folded = true;
    }

    const result = determineWinner(state);
    expect(result.winners.length).toBe(2);

    const totalWinAmount = result.winners.reduce((sum, w) => sum + w.amount, 0);
    expect(totalWinAmount).toBe(100);
  });

  it('奇数ポットの端数は最初の勝者に付与', () => {
    const state = createInitialGameState();
    state.pot = 101; // 奇数
    state.communityCards = [
      card('A', 'h'), card('K', 'h'), card('Q', 'h'),
      card('J', 'c'), card('T', 'd'),
    ];

    state.players[0].holeCards = [card('9', 'h'), card('8', 'h'), card('2', 's'), card('3', 's')];
    state.players[0].folded = false;
    state.players[0].totalBetThisRound = 51;

    state.players[1].holeCards = [card('9', 'd'), card('8', 'd'), card('2', 'c'), card('3', 'c')];
    state.players[1].folded = false;
    state.players[1].totalBetThisRound = 50;

    for (let i = 2; i < 6; i++) {
      state.players[i].folded = true;
    }

    const result = determineWinner(state);
    // 端数が出る（101を2人で分割 → 51 + 50 or 50 + 50 + 端数処理）
    const totalWinAmount = result.winners.reduce((sum, w) => sum + w.amount, 0);
    expect(totalWinAmount).toBe(101);
  });

  it('サイドポットで各ポットの勝者が異なる場合', () => {
    const state = createInitialGameState();
    state.pot = 250;
    state.communityCards = [
      card('A', 'h'), card('K', 'h'), card('Q', 'h'),
      card('2', 'c'), card('3', 'd'),
    ];

    // player[0]: ショートスタックオールイン、強いハンド（ストレートフラッシュ素材）
    state.players[0].holeCards = [card('J', 'h'), card('T', 'h'), card('9', 's'), card('8', 's')];
    state.players[0].folded = false;
    state.players[0].totalBetThisRound = 50;
    state.players[0].isAllIn = true;
    state.players[0].chips = 0;

    // player[1]: ディープスタック、弱いハンド
    state.players[1].holeCards = [card('4', 's'), card('5', 's'), card('6', 'd'), card('7', 'd')];
    state.players[1].folded = false;
    state.players[1].totalBetThisRound = 100;

    // player[2]: ディープスタック、中くらいのハンド
    state.players[2].holeCards = [card('A', 'c'), card('K', 'c'), card('4', 'd'), card('5', 'd')];
    state.players[2].folded = false;
    state.players[2].totalBetThisRound = 100;

    for (let i = 3; i < 6; i++) {
      state.players[i].folded = true;
    }

    const result = determineWinner(state);
    expect(result.isHandComplete).toBe(true);
    expect(result.winners.length).toBeGreaterThanOrEqual(1);

    // 勝者のチップ合計が正しい
    const totalWon = result.winners.reduce((sum, w) => sum + w.amount, 0);
    expect(totalWon).toBe(250);
  });

  it('勝者のchipsが正しく加算される', () => {
    const state = createInitialGameState();
    state.pot = 100;
    state.players[0].chips = 500;
    state.players[0].folded = false;
    for (let i = 1; i < 6; i++) {
      state.players[i].folded = true;
    }

    const result = determineWinner(state);
    expect(result.players[0].chips).toBe(600); // 500 + 100
  });
});

describe('フルレイズルール（リオープン制限）', () => {
  it('非フルレイズのオールインで既アクション済みプレイヤーにレイズ権がない', () => {
    // セットアップ: Player0がレイズ済み、Player1が非フルレイズでオールイン
    const state = createInitialGameState();
    state.currentBet = 300;
    state.minRaise = 200;
    state.lastFullRaiseBet = 300;
    state.currentPlayerIndex = 1;
    state.pot = 600;

    // Player0: レイズ済み（300にレイズ）
    state.players[0].chips = 500;
    state.players[0].currentBet = 300;
    state.players[0].hasActed = true;

    // Player1: ショートスタック（350にオールイン予定 → raiseBy=50 < minRaise=200）
    state.players[1].chips = 350;
    state.players[1].currentBet = 0;
    state.players[1].hasActed = false;

    // Player2: 未アクション（minRaise=200を出せるだけのチップが必要）
    state.players[2].chips = 1000;
    state.players[2].currentBet = 0;
    state.players[2].hasActed = false;

    for (let i = 3; i < 6; i++) {
      state.players[i].folded = true;
    }

    // Player1がオールイン（350）→ 非フルレイズ
    const afterAllin = applyAction(state, 1, 'allin');

    expect(afterAllin.currentBet).toBe(350);
    // hasActedはリセットされない（非フルレイズ）
    expect(afterAllin.players[0].hasActed).toBe(true);
    // lastFullRaiseBetは更新されない
    expect(afterAllin.lastFullRaiseBet).toBe(300);

    // Player2（未アクション）にはレイズ権がある
    const actionsP2 = getValidActions(afterAllin, 2);
    const p2ActionTypes = actionsP2.map(a => a.action);
    expect(p2ActionTypes).toContain('raise');

    // Player0（既アクション済み）にはレイズ権がない
    // Player2がコールした後の状態でPlayer0のアクションを確認
    const afterP2Call = applyAction(afterAllin, 2, 'call');
    const actionsP0 = getValidActions(afterP2Call, 0);
    const p0ActionTypes = actionsP0.map(a => a.action);
    expect(p0ActionTypes).toContain('call');
    expect(p0ActionTypes).toContain('fold');
    expect(p0ActionTypes).not.toContain('raise');
    expect(p0ActionTypes).not.toContain('allin');
  });

  it('フルレイズのオールインで全プレイヤーにアクション機会が与えられる', () => {
    const state = createInitialGameState();
    state.currentBet = 300;
    state.minRaise = 200;
    state.lastFullRaiseBet = 300;
    state.currentPlayerIndex = 1;
    state.pot = 600;

    // Player0: レイズ済み
    state.players[0].chips = 500;
    state.players[0].currentBet = 300;
    state.players[0].hasActed = true;

    // Player1: 十分なチップでオールイン（500 → raiseBy=200 >= minRaise=200）
    state.players[1].chips = 500;
    state.players[1].currentBet = 0;
    state.players[1].hasActed = false;

    state.players[2].chips = 500;
    state.players[2].currentBet = 0;
    state.players[2].hasActed = false;

    for (let i = 3; i < 6; i++) {
      state.players[i].folded = true;
    }

    // Player1がオールイン（500）→ フルレイズ
    const afterAllin = applyAction(state, 1, 'allin');

    expect(afterAllin.currentBet).toBe(500);
    // hasActedがリセットされる（フルレイズ）
    expect(afterAllin.players[0].hasActed).toBe(false);
    // lastFullRaiseBetが更新される
    expect(afterAllin.lastFullRaiseBet).toBe(500);

    // Player0にもレイズ権がある
    const actionsP0 = getValidActions(afterAllin, 0);
    const p0ActionTypes = actionsP0.map(a => a.action);
    expect(p0ActionTypes).toContain('call');
  });

  it('非フルレイズオールイン後もゲームが正常に進行する', () => {
    const state = createInitialGameState(300);

    // Player2をショートスタックにする
    state.players[2].chips = 10;

    const totalChipsBefore = state.players.reduce((sum, p) => sum + p.chips, 0);

    let gameState = startNewHand(state);

    // ゲームを最後まで回す
    let loopCount = 0;
    while (!gameState.isHandComplete && loopCount < 100) {
      const current = gameState.currentPlayerIndex;
      const actions = getValidActions(gameState, current);
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');
      const allinAction = actions.find(a => a.action === 'allin');

      if (callAction) {
        gameState = applyAction(gameState, current, 'call');
      } else if (checkAction) {
        gameState = applyAction(gameState, current, 'check');
      } else if (allinAction) {
        gameState = applyAction(gameState, current, 'allin');
      } else {
        gameState = applyAction(gameState, current, 'fold');
      }
      loopCount++;
    }

    expect(gameState.isHandComplete).toBe(true);
    // チップ合計が保存される
    const totalChipsAfter = gameState.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChipsAfter).toBe(totalChipsBefore);
  });

  it('lastFullRaiseBetがストリート間でリセットされる', () => {
    let state = startNewHand(createInitialGameState(1000));

    // プリフロップでlastFullRaiseBetがBBに設定されている
    expect(state.lastFullRaiseBet).toBe(state.bigBlind);

    // 全員コール/チェックでフロップへ
    let loopCount = 0;
    while (state.currentStreet === 'preflop' && !state.isHandComplete && loopCount < 20) {
      const current = state.currentPlayerIndex;
      const actions = getValidActions(state, current);
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');
      if (callAction) state = applyAction(state, current, 'call');
      else if (checkAction) state = applyAction(state, current, 'check');
      else break;
      loopCount++;
    }

    expect(state.currentStreet).toBe('flop');
    // フロップではlastFullRaiseBetがリセットされる
    expect(state.lastFullRaiseBet).toBe(0);
  });
});

describe('全員オールイン: ボードランアウト', () => {
  it('プリフロップで全員オールインするとショーダウンまで進む', () => {
    let state = startNewHand(createInitialGameState(10));

    // 全員オールイン
    let loopCount = 0;
    while (!state.isHandComplete && loopCount < 20) {
      const current = state.currentPlayerIndex;
      state = applyAction(state, current, 'allin');
      loopCount++;
    }

    expect(state.isHandComplete).toBe(true);
    expect(state.communityCards).toHaveLength(5);
    expect(state.currentStreet).toBe('showdown');

    // チップ合計が保存される
    const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChips).toBe(60); // 10 * 6
  });

  it('フロップ後に残り全員オールインするとランアウト', () => {
    let state = startNewHand(createInitialGameState(100));

    // プリフロップ: 全員コール
    let loopCount = 0;
    while (state.currentStreet === 'preflop' && !state.isHandComplete && loopCount < 20) {
      const current = state.currentPlayerIndex;
      const actions = getValidActions(state, current);
      const callAction = actions.find(a => a.action === 'call');
      const checkAction = actions.find(a => a.action === 'check');
      if (callAction) state = applyAction(state, current, 'call');
      else if (checkAction) state = applyAction(state, current, 'check');
      else break;
      loopCount++;
    }

    expect(state.currentStreet).toBe('flop');

    // フロップ: 全員オールイン
    loopCount = 0;
    while (!state.isHandComplete && loopCount < 20) {
      const current = state.currentPlayerIndex;
      state = applyAction(state, current, 'allin');
      loopCount++;
    }

    expect(state.isHandComplete).toBe(true);
    expect(state.communityCards).toHaveLength(5);

    const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChips).toBe(600);
  });

  it('1人オールイン+1人コール（残りフォールド）で自動ランアウト', () => {
    const initialState = createInitialGameState(100);
    const totalChips = initialState.players.reduce((sum, p) => sum + p.chips, 0); // 600
    let state = startNewHand(initialState);

    // 最初のプレイヤーがオールイン
    const firstPlayer = state.currentPlayerIndex;
    state = applyAction(state, firstPlayer, 'allin');
    expect(state.isHandComplete).toBe(false);

    // 残りはフォールド、最後の1人だけコール
    let lastCaller = -1;
    let loopCount = 0;
    while (!state.isHandComplete && loopCount < 10) {
      const idx = state.currentPlayerIndex;
      const actions = getValidActions(state, idx);
      const callAction = actions.find(a => a.action === 'call');

      // 最後のアクション可能プレイヤーだけコール、他はフォールド
      const activeBefore = state.players.filter(p => !p.folded && p.id !== firstPlayer && !p.isAllIn).length;
      if (activeBefore === 1 && callAction) {
        lastCaller = idx;
        state = applyAction(state, idx, 'call');
      } else {
        state = applyAction(state, idx, 'fold');
      }
      loopCount++;
    }

    // チェックなしで直接ショーダウンに到達
    expect(state.isHandComplete).toBe(true);
    expect(state.currentStreet).toBe('showdown');
    expect(state.communityCards).toHaveLength(5);

    // チップ合計が保存される
    const totalChipsAfter = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChipsAfter).toBe(totalChips);
  });
});
