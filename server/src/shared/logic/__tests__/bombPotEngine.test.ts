import { describe, it, expect } from 'vitest';
import {
  createBombPotGameState,
  startBombPotHand,
  applyBombPotAction,
  determineBombPotWinner,
  getBombPotValidActions,
  wouldBombPotAdvanceStreet,
} from '../bombPotEngine.js';
import type { GameState, Card } from '../types.js';

// ===== ヘルパー =====

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

/** 1ストリート分、currentPlayerIndex から順に check を回す */
function checkAroundOneStreet(state: GameState): GameState {
  const startStreet = state.currentStreet;
  let s = state;
  let safety = 20;
  while (s.currentStreet === startStreet && !s.isHandComplete && safety-- > 0) {
    s = applyBombPotAction(s, s.currentPlayerIndex, 'check');
  }
  return s;
}

/**
 * ショーダウン直前の手詰まり状態を直接構築する（determineBombPotWinner 単体テスト用）
 *
 * playersConfig: 6席分。各席に holeCards / totalBetThisRound / folded を指定。
 *   - holeCards 未指定の席は isSittingOut + folded 扱い（active 集合から除外）
 *   - totalBetThisRound はサイドポット計算で使用
 */
function buildShowdownState(opts: {
  boards: [Card[], Card[]];
  /** bomb pot のアンテ額。後方互換のため bigBlind 名で受け付ける。 */
  bigBlind?: number;
  initialChips?: number;
  playersConfig: Array<
    | {
        holeCards: Card[];
        totalBetThisRound: number;
        folded?: boolean;
        isAllIn?: boolean;
      }
    | null
  >;
}): GameState {
  const initialChips = opts.initialChips ?? 1000;
  const state = createBombPotGameState(initialChips);
  state.ante = opts.bigBlind ?? 100;
  state.bigBlind = 0;
  state.smallBlind = 0;
  state.boards = [opts.boards[0], opts.boards[1]];
  state.communityCards = opts.boards[0];
  state.currentStreet = 'showdown';

  let pot = 0;
  for (let i = 0; i < 6; i++) {
    const cfg = opts.playersConfig[i];
    const p = state.players[i];
    if (cfg === null || cfg === undefined) {
      // 不在席として扱う
      p.isSittingOut = true;
      p.folded = true;
      p.hasActed = true;
      p.holeCards = [];
      p.totalBetThisRound = 0;
      p.chips = 0;
      continue;
    }
    p.holeCards = cfg.holeCards;
    p.totalBetThisRound = cfg.totalBetThisRound;
    p.folded = cfg.folded ?? false;
    p.isAllIn = cfg.isAllIn ?? false;
    pot += cfg.totalBetThisRound;
  }
  state.pot = pot;
  return state;
}

// ===== createBombPotGameState =====

describe('createBombPotGameState', () => {
  it('variant が plo_double_board_bomb', () => {
    const state = createBombPotGameState();
    expect(state.variant).toBe('plo_double_board_bomb');
  });

  it('boards が 2 個の空配列で初期化される', () => {
    const state = createBombPotGameState();
    expect(state.boards).toBeDefined();
    expect(state.boards).toHaveLength(2);
    expect(state.boards![0]).toEqual([]);
    expect(state.boards![1]).toEqual([]);
  });

  it('6 人分のプレイヤーが指定チップで初期化される', () => {
    const state = createBombPotGameState(5000);
    expect(state.players).toHaveLength(6);
    for (const p of state.players) expect(p.chips).toBe(5000);
  });
});

// ===== startBombPotHand =====

describe('startBombPotHand', () => {
  it('プリフロップをスキップして currentStreet が flop になる', () => {
    const state = createBombPotGameState(1000);
    const after = startBombPotHand(state);
    expect(after.currentStreet).toBe('flop');
  });

  it('両ボードに 3 枚ずつ配られる', () => {
    const state = createBombPotGameState(1000);
    const after = startBombPotHand(state);
    expect(after.boards).toHaveLength(2);
    expect(after.boards![0]).toHaveLength(3);
    expect(after.boards![1]).toHaveLength(3);
  });

  it('communityCards が boards[0] と同じ参照（後方互換ミラー）', () => {
    const state = createBombPotGameState(1000);
    const after = startBombPotHand(state);
    expect(after.communityCards).toEqual(after.boards![0]);
  });

  it('全員に 4 枚のホールカードが配られる', () => {
    const state = createBombPotGameState(1000);
    const after = startBombPotHand(state);
    for (const p of after.players) {
      if (p.isSittingOut) continue;
      expect(p.holeCards).toHaveLength(4);
    }
  });

  it('全員から 1 BB 相当のアンテが徴収される（pot = ante × 6）', () => {
    const state = createBombPotGameState(1000);
    state.ante = 50;
    const after = startBombPotHand(state);
    expect(after.pot).toBe(50 * 6);
    for (const p of after.players) {
      // アンテはサイドポットを作らないため totalBetThisRound には記録しない
      expect(p.totalBetThisRound).toBe(0);
      expect(p.chips).toBe(1000 - 50);
    }
  });

  it('currentBet は 0、call 不要の状態で開始する', () => {
    const state = createBombPotGameState(1000);
    const after = startBombPotHand(state);
    expect(after.currentBet).toBe(0);
    for (const p of after.players) expect(p.currentBet).toBe(0);
  });

  it('チップが ante 未満のプレイヤーは all-in でアンテを払う', () => {
    const state = createBombPotGameState(1000);
    state.ante = 100;
    state.players[0].chips = 30; // ante に満たない
    const after = startBombPotHand(state);
    expect(after.players[0].chips).toBe(0);
    expect(after.players[0].isAllIn).toBe(true);
    // アンテは totalBetThisRound に記録しない (サイドポット対象外)
    expect(after.players[0].totalBetThisRound).toBe(0);
    expect(after.players[1].totalBetThisRound).toBe(0);
    // pot には払った額が積まれている
    expect(after.pot).toBe(30 + 100 * 5);
  });

  it('最初に行動するプレイヤーは SB（dealer + 1）', () => {
    const state = createBombPotGameState(1000);
    const after = startBombPotHand(state);
    expect(after.currentPlayerIndex).toBe((after.dealerPosition + 1) % 6);
  });

  it('useカードがデッキから消費される（24 枚ホール + 6 枚ボード = 30 枚）', () => {
    const state = createBombPotGameState(1000);
    const after = startBombPotHand(state);
    expect(after.deck.length).toBe(52 - 30);
  });

  it('全員がアンテで all-in になった場合は即ランアウト→ showdown 状態で返る', () => {
    const state = createBombPotGameState(1000);
    state.ante = 100;
    // 全員 BB 未満（all-in 対象）
    for (const p of state.players) p.chips = 30;
    const after = startBombPotHand(state);

    // 全員 all-in
    expect(after.players.every(p => p.isAllIn)).toBe(true);
    // 即ランアウト → 両ボード 5 枚 / showdown / isHandComplete=true
    expect(after.boards![0].length).toBe(5);
    expect(after.boards![1].length).toBe(5);
    expect(after.currentStreet).toBe('showdown');
    expect(after.isHandComplete).toBe(true);
    // winners が決定済み（ボード 1, 2 でそれぞれ少なくとも 1 名）
    expect(after.winners.length).toBeGreaterThanOrEqual(2);
    // ボード 1 / ボード 2 の handName が "Board X: ..." 形式
    expect(after.winners.every(w => /^Board [12]:/.test(w.handName))).toBe(true);
  });

  it('カードに重複がない', () => {
    const state = createBombPotGameState(1000);
    const after = startBombPotHand(state);
    const seen = new Set<string>();
    const allCards: Card[] = [
      ...after.boards![0],
      ...after.boards![1],
      ...after.players.flatMap(p => p.holeCards),
      ...after.deck,
    ];
    for (const c of allCards) {
      const key = `${c.rank}${c.suit}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(52);
  });
});

// ===== applyBombPotAction（ストリート進行） =====

describe('applyBombPotAction（ストリート進行）', () => {
  it('全員チェックでフロップ → ターン → リバー → ショーダウンと進む', () => {
    const initial = startBombPotHand(createBombPotGameState(1000));
    expect(initial.currentStreet).toBe('flop');

    const afterFlop = checkAroundOneStreet(initial);
    expect(afterFlop.currentStreet).toBe('turn');
    expect(afterFlop.boards![0]).toHaveLength(4);
    expect(afterFlop.boards![1]).toHaveLength(4);

    const afterTurn = checkAroundOneStreet(afterFlop);
    expect(afterTurn.currentStreet).toBe('river');
    expect(afterTurn.boards![0]).toHaveLength(5);
    expect(afterTurn.boards![1]).toHaveLength(5);

    const afterRiver = checkAroundOneStreet(afterTurn);
    expect(afterRiver.isHandComplete).toBe(true);
    expect(afterRiver.currentStreet).toBe('showdown');
  });

  it('communityCards はストリート進行中も boards[0] と同期する', () => {
    let s = startBombPotHand(createBombPotGameState(1000));
    s = checkAroundOneStreet(s);
    expect(s.communityCards).toEqual(s.boards![0]);
    s = checkAroundOneStreet(s);
    expect(s.communityCards).toEqual(s.boards![0]);
  });

  it('wouldBombPotAdvanceStreet: 最後のチェックでストリートが進むと判定', () => {
    let s = startBombPotHand(createBombPotGameState(1000));
    // 5 人チェック
    for (let i = 0; i < 5; i++) {
      s = applyBombPotAction(s, s.currentPlayerIndex, 'check');
    }
    // 6 人目（最後）のチェック前に判定
    expect(wouldBombPotAdvanceStreet(s, s.currentPlayerIndex, 'check')).toBe(true);
  });

  it('getBombPotValidActions: 開幕フロップで check と bet が可能', () => {
    const s = startBombPotHand(createBombPotGameState(1000));
    const actions = getBombPotValidActions(s, s.currentPlayerIndex);
    const types = actions.map(a => a.action);
    expect(types).toContain('check');
    expect(types).toContain('bet');
    expect(types).not.toContain('call');
  });

  it('1 人がベットすると他のプレイヤーには call/raise/fold が出る', () => {
    let s = startBombPotHand(createBombPotGameState(1000));
    s.ante = 50;
    const first = s.currentPlayerIndex;
    s = applyBombPotAction(s, first, 'bet', 100);
    expect(s.currentBet).toBe(100);
    const next = s.currentPlayerIndex;
    const actions = getBombPotValidActions(s, next);
    const types = actions.map(a => a.action);
    expect(types).toContain('fold');
    expect(types).toContain('call');
  });
});

// ===== determineBombPotWinner（コア） =====

describe('determineBombPotWinner', () => {
  it('1 人だけ残った場合は無条件で全ポット獲得', () => {
    const state = buildShowdownState({
      boards: [
        [card('A', 'h'), card('K', 'h'), card('Q', 'h'), card('J', 'h'), card('T', 'h')],
        [card('2', 'c'), card('3', 'c'), card('4', 'c'), card('5', 'c'), card('6', 'c')],
      ],
      playersConfig: [
        { holeCards: [card('2', 'd'), card('3', 'd'), card('4', 'd'), card('5', 'd')], totalBetThisRound: 100 },
        { holeCards: [], totalBetThisRound: 100, folded: true },
        { holeCards: [], totalBetThisRound: 100, folded: true },
        { holeCards: [], totalBetThisRound: 100, folded: true },
        { holeCards: [], totalBetThisRound: 100, folded: true },
        { holeCards: [], totalBetThisRound: 100, folded: true },
      ],
    });
    const initialChips = state.players[0].chips;
    const result = determineBombPotWinner(state);
    expect(result.isHandComplete).toBe(true);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].playerId).toBe(0);
    expect(result.winners[0].amount).toBe(600);
    expect(result.players[0].chips).toBe(initialChips + 600);
  });

  it('各ボード独立評価: p0 が board1、p1 が board2 を取り、ポットを半分ずつ獲得', () => {
    // Board 1: AhAdQh7c2s — p1 (QcQs) が full house QQQ AA
    // Board 2: 9c9dJcJd3s — p0 (KhKd) が two pair KK JJ T-kicker
    const state = buildShowdownState({
      boards: [
        [card('A', 'h'), card('A', 'd'), card('Q', 'h'), card('7', 'c'), card('2', 's')],
        [card('9', 'c'), card('9', 'd'), card('J', 'c'), card('J', 'd'), card('3', 's')],
      ],
      playersConfig: [
        { holeCards: [card('K', 'h'), card('K', 'd'), card('T', 'd'), card('T', 's')], totalBetThisRound: 500 },
        { holeCards: [card('Q', 'c'), card('Q', 's'), card('5', 'c'), card('5', 's')], totalBetThisRound: 500 },
        null, null, null, null,
      ],
    });

    const beforeP0 = state.players[0].chips;
    const beforeP1 = state.players[1].chips;
    const result = determineBombPotWinner(state);

    // 合計 1000 → 半分ずつ → 各ボード 500
    expect(result.players[0].chips - beforeP0).toBe(500); // p0 board2 win
    expect(result.players[1].chips - beforeP1).toBe(500); // p1 board1 win

    // winners: 各ボード 1 エントリずつ
    expect(result.winners).toHaveLength(2);
    const p0Win = result.winners.find(w => w.playerId === 0)!;
    const p1Win = result.winners.find(w => w.playerId === 1)!;
    expect(p0Win.amount).toBe(500);
    expect(p1Win.amount).toBe(500);
    expect(p0Win.handName.startsWith('Board 2:')).toBe(true);
    expect(p1Win.handName.startsWith('Board 1:')).toBe(true);
  });

  it('スクープ: 1 人が両ボード勝つと両半分を獲得', () => {
    // Board 1 / Board 2 ともに p0 (AhAd) が三 A 役 → 両方勝ち
    const state = buildShowdownState({
      boards: [
        [card('A', 'h'), card('A', 'd'), card('K', 's'), card('7', 'c'), card('2', 's')],
        [card('A', 'c'), card('A', 's'), card('K', 'h'), card('8', 'd'), card('3', 'h')],
      ],
      playersConfig: [
        // Board1: KK + AAA = aces full of kings (フルハウス)
        // Board2: KK + AAA = aces full of kings (フルハウス)
        { holeCards: [card('K', 'd'), card('K', 'c'), card('5', 'd'), card('6', 'd')], totalBetThisRound: 500 },
        // Board1: QQ + AAA = aces full of queens
        // Board2: QQ + AAA = aces full of queens
        { holeCards: [card('Q', 'h'), card('Q', 'd'), card('Q', 'c'), card('Q', 's')], totalBetThisRound: 500 },
        null, null, null, null,
      ],
    });

    const beforeP0 = state.players[0].chips;
    const result = determineBombPotWinner(state);

    expect(result.players[0].chips - beforeP0).toBe(1000); // 両ボード勝ち
    expect(result.winners.filter(w => w.playerId === 0)).toHaveLength(2);
    expect(result.winners.filter(w => w.playerId === 1)).toHaveLength(0);
  });

  it('チョップ: 同役なら半分のさらに半分ずつ', () => {
    // Board 1 = 5h 7d 8c 9c Kd → p0 (6c, Td) と p1 (6h, Th) は両方 6-T ストレート
    // Board 2 = 2d 3d 4d 5d 6d → 両者ともボード上のストレートフラッシュを使えず弱い役 (低 high card)
    //   双方ペア6 (6c+6d / 6h+6d) も同じく同点
    //
    // 実際には board 2 でも同役同点を狙うのは難しいので、シンプルに片方ボードでチョップを検証する
    //
    // pot=200 → 各ボード 100 → board1 でチョップなら p0 と p1 が 50 ずつ
    // board2 で誰かが勝てばその人が 100 (ここでは p0 が勝つよう設計)
    const state = buildShowdownState({
      boards: [
        // Board1: ストレート 6-T 共通
        [card('5', 'h'), card('7', 'd'), card('8', 'c'), card('9', 'c'), card('K', 'd')],
        // Board2: AhAdAs2c3h trips on board → p0(KK) full house aces over kings, p1(QQ) aces over queens
        [card('A', 'h'), card('A', 'd'), card('A', 's'), card('2', 'c'), card('3', 'h')],
      ],
      playersConfig: [
        // p0: 6c Td → board1 の 6-T straight、KhKd → board2 で aces full of kings
        { holeCards: [card('6', 'c'), card('T', 'd'), card('K', 'h'), card('K', 'c')], totalBetThisRound: 100 },
        // p1: 6s Ts → board1 の 6-T straight、QhQs → board2 で aces full of queens
        { holeCards: [card('6', 's'), card('T', 's'), card('Q', 'h'), card('Q', 's')], totalBetThisRound: 100 },
        null, null, null, null,
      ],
    });

    const beforeP0 = state.players[0].chips;
    const beforeP1 = state.players[1].chips;
    const result = determineBombPotWinner(state);

    // pot=200, board1=100 (chop 50/50), board2=100 (p0 単独勝ち)
    expect(result.players[0].chips - beforeP0).toBe(50 + 100); // chop50 + win100
    expect(result.players[1].chips - beforeP1).toBe(50);

    // winners: p0 が board1(50) + board2(100) で 2 エントリ、p1 が board1(50) で 1 エントリ
    expect(result.winners).toHaveLength(3);
  });

  it('半分割の端数 (1 チップ) はボード 1 に付与される', () => {
    // 1 contested pot で奇数額になるよう構築
    // p0 active: 50, p1 active: 50, p2 folded: 1 → contested pot = 50+50+1 = 101
    const state = buildShowdownState({
      boards: [
        // Board1: p0 が勝つ設計
        [card('A', 'h'), card('A', 'd'), card('Q', 'h'), card('7', 'c'), card('2', 's')],
        // Board2: p1 が勝つ設計
        [card('9', 'c'), card('9', 'd'), card('J', 'c'), card('J', 'd'), card('3', 's')],
      ],
      playersConfig: [
        // p0: KK で board1 の AAQ から two pair AA KK / board2 の JJ99 から 99 JJ KK two pair
        { holeCards: [card('K', 'h'), card('K', 'd'), card('4', 'd'), card('5', 'd')], totalBetThisRound: 50 },
        // p1: QQ → board1 で QQQ AA full house (board1 winner)
        //         board2 で QQ JJ + kicker (vs p0 KK JJ)
        { holeCards: [card('Q', 'c'), card('Q', 's'), card('6', 'd'), card('7', 'd')], totalBetThisRound: 50 },
        // p2: folded だがアンテ 1 を出している
        { holeCards: [card('2', 'd'), card('3', 'd'), card('4', 'c'), card('4', 's')], totalBetThisRound: 1, folded: true },
        null, null, null,
      ],
    });

    const beforeP0 = state.players[0].chips;
    const beforeP1 = state.players[1].chips;
    const result = determineBombPotWinner(state);

    // contested pot 101 → board1 = 51 (p1 win), board2 = 50 (p0 win)
    // ※ board1 で p1 (full house QQQ AA) が勝ち、board2 で p0 (two pair KK JJ) が勝つ
    expect(result.players[0].chips - beforeP0).toBe(50);
    expect(result.players[1].chips - beforeP1).toBe(51);
  });

  it('サイドポット: ショートスタックを含む 3-way で各ポット × 各ボードで分配', () => {
    // p0: 全 50 で all-in → small pot のみ参加
    // p1: 150 まで投入 → small + main pot
    // p2: 150 まで投入 → small + main pot
    //
    // calculateSidePots:
    //   level 50: contribution 50*3 = 150, eligible [0,1,2] (small)
    //   level 150: contribution 100*2 = 200, eligible [1,2] (main)
    //
    // Card design:
    //   Board1 = AhAdAs2c3d (trips A on board)
    //     - p0: KhKd → KK+AAA = aces full of kings (best on board1)
    //     - p1: QhQd → aces full of queens
    //     - p2: JhJd → aces full of jacks
    //   Board2 = 6h6s7c8d9c (pair 6 on board)
    //     - p2: JhJd 6c 6d → board2 has 6h 6s; p2 holes 6c 6d → quads 6 (best!)
    //     - p0: 4c 4s + 6h 6s → 2 pair 6/4
    //     - p1: 5c 5s + 6h 6s → 2 pair 6/5
    const state = buildShowdownState({
      boards: [
        [card('A', 'h'), card('A', 'd'), card('A', 's'), card('2', 'c'), card('3', 'd')],
        [card('6', 'h'), card('6', 's'), card('7', 'c'), card('8', 'd'), card('9', 'c')],
      ],
      playersConfig: [
        { holeCards: [card('K', 'h'), card('K', 'd'), card('4', 'c'), card('4', 's')], totalBetThisRound: 50, isAllIn: true },
        { holeCards: [card('Q', 'h'), card('Q', 'd'), card('5', 'c'), card('5', 's')], totalBetThisRound: 150 },
        { holeCards: [card('J', 'h'), card('J', 'd'), card('6', 'c'), card('6', 'd')], totalBetThisRound: 150 },
        null, null, null,
      ],
    });

    const beforeP0 = state.players[0].chips;
    const beforeP1 = state.players[1].chips;
    const beforeP2 = state.players[2].chips;
    const result = determineBombPotWinner(state);

    // Small pot 150 (eligible all 3) → board1=75 (p0), board2=75 (p2)
    // Main pot 200 (eligible 1,2)   → board1=100 (p1), board2=100 (p2)
    expect(result.players[0].chips - beforeP0).toBe(75);
    expect(result.players[1].chips - beforeP1).toBe(100);
    expect(result.players[2].chips - beforeP2).toBe(75 + 100);

    // sidePots は contested 2 件
    expect(result.sidePots).toHaveLength(2);
  });

  it('単独 eligible のサイドポット（オーバーベット返却）は対象プレイヤーに返却される', () => {
    // p0 active, totalBet=100; p1 active, totalBet=200 → 余剰 100 は p1 に返却
    const state = buildShowdownState({
      boards: [
        // 両ボード p0 が勝つ設計 (簡略化のため board1 で trip A on board, p0 = KK)
        [card('A', 'h'), card('A', 'd'), card('A', 's'), card('2', 'c'), card('3', 'd')],
        [card('A', 'c'), card('K', 's'), card('K', 'd'), card('7', 'c'), card('8', 'h')],
      ],
      playersConfig: [
        // p0: KhKd で board1 = aces full of kings、board2 = trips K
        { holeCards: [card('K', 'h'), card('K', 'c'), card('5', 'd'), card('6', 'd')], totalBetThisRound: 100 },
        // p1: QQ で board1 = aces full of queens、board2 = pair Q
        { holeCards: [card('Q', 'h'), card('Q', 'd'), card('Q', 'c'), card('Q', 's')], totalBetThisRound: 200 },
        null, null, null, null,
      ],
    });

    const beforeP0 = state.players[0].chips;
    const beforeP1 = state.players[1].chips;
    const result = determineBombPotWinner(state);

    // contested pot = 100*2 = 200; p1 の単独 eligible 100 は即返却
    // p0 が両ボード勝ち → 200 全額獲得
    expect(result.players[0].chips - beforeP0).toBe(200);
    // p1 は返却 100 のみ
    expect(result.players[1].chips - beforeP1).toBe(100);
  });

  // === 新ルール: アンテはサイドポット非対象（短スタック all-in でも勝てば pot 全額獲得）===

  it('アンテで all-in したショートスタックが両ボード勝てば pot 全額を獲得する', () => {
    // ante=100, p0 chips=30 → all-in 30, p1 chips=200 → 100, p2 chips=200 → 100
    // pot = 30 + 100 + 100 = 230 (アンテのみ、totalBetThisRound = 0 で記録)
    // p0 が両ボード勝った場合、refund 無く 230 全額を獲得すべき
    const state = createBombPotGameState(1000);
    state.ante = 100;
    state.players[0].chips = 30;
    state.players[1].chips = 200;
    state.players[2].chips = 200;
    for (let i = 3; i < 6; i++) state.players[i].isSittingOut = true;

    const after = startBombPotHand(state);
    // アンテ徴収後の状態を直接ショウダウン用に整形
    after.currentStreet = 'showdown';
    after.boards = [
      [card('A', 'h'), card('A', 'd'), card('A', 's'), card('2', 'c'), card('3', 'd')],
      [card('A', 'c'), card('K', 's'), card('K', 'd'), card('7', 'c'), card('8', 'h')],
    ];
    after.communityCards = after.boards[0];
    // p0 = KK で両ボード勝つ設計
    after.players[0].holeCards = [card('K', 'h'), card('K', 'c'), card('5', 'd'), card('6', 'd')];
    after.players[1].holeCards = [card('Q', 'h'), card('Q', 'd'), card('Q', 'c'), card('Q', 's')];
    after.players[2].holeCards = [card('J', 'h'), card('J', 'd'), card('J', 'c'), card('J', 's')];

    const beforeP0 = after.players[0].chips;
    const beforeP1 = after.players[1].chips;
    const beforeP2 = after.players[2].chips;
    const result = determineBombPotWinner(after);

    // p0 が pot 230 を全額獲得（refund 無し）
    expect(result.players[0].chips - beforeP0).toBe(230);
    expect(result.players[1].chips - beforeP1).toBe(0);
    expect(result.players[2].chips - beforeP2).toBe(0);
    expect(result.pot).toBe(230);
  });

  it('アンテのみ + ポストフロップ bet 混合: アンテ主ポットは全 active 対象、bet は side pot', () => {
    // ante=50: p0 30 (all-in), p1 50, p2 50 → pot から 130 (アンテ分)
    // post-flop: p1 が 100 bet、p2 が 100 call → totalBetThisRound: p1=100, p2=100
    // 構築: state.pot = 130 (ante) + 200 (post-flop) = 330
    const state = buildShowdownState({
      boards: [
        // Board1: p0 (KK) が aces full of kings で勝ち
        [card('A', 'h'), card('A', 'd'), card('A', 's'), card('2', 'c'), card('3', 'd')],
        // Board2: p2 (66) が quads 6 で勝ち
        [card('6', 'h'), card('6', 's'), card('7', 'c'), card('8', 'd'), card('9', 'c')],
      ],
      bigBlind: 50, // = ante
      playersConfig: [
        // p0: KK で board1 勝ち / board2 は弱い
        { holeCards: [card('K', 'h'), card('K', 'c'), card('4', 'c'), card('4', 's')], totalBetThisRound: 0, isAllIn: true },
        // p1: QQ で両ボード負ける
        { holeCards: [card('Q', 'h'), card('Q', 'd'), card('5', 'c'), card('5', 's')], totalBetThisRound: 100 },
        // p2: 66 で board2 quads 勝ち
        { holeCards: [card('J', 'h'), card('J', 'd'), card('6', 'c'), card('6', 'd')], totalBetThisRound: 100 },
        null, null, null,
      ],
    });
    // pot は helper が totalBet 合計 (200) で初期化するので、ante 分 (50*3 - 20 = 130) を後付け加算
    // 実際は p0 が 30 ante (all-in)、p1 / p2 が 50 ante → 130
    state.pot = 130 + 200;
    state.players[0].chips = 0; // p0 は ante で all-in したので残 0
    state.players[1].chips = 1000 - 50 - 100; // ante 50 + bet 100
    state.players[2].chips = 1000 - 50 - 100;

    const beforeP0 = state.players[0].chips;
    const beforeP1 = state.players[1].chips;
    const beforeP2 = state.players[2].chips;
    const result = determineBombPotWinner(state);

    // ポット構成:
    //   - アンテ主ポット: 130 (全 active 対象)
    //     → board1 65 (p0 win), board2 65 (p2 win)
    //   - post-flop side pot: 200 (p1 + p2 のみ eligible、p0 は totalBet=0 なので不適格)
    //     → board1 100 (p1, p0 不適格なら p1 が勝つ?) , board2 100 (p2 win)
    //
    // board1 で p0 (KK→AAFull) > p1 (QQ→AAQQQFull) ... 実際は AAA on board + KK = aces full of kings
    // p1 = AA Q Q Q なので aces full of queens → p0 が強い
    // しかし post-flop side pot に p0 は不参加 (totalBet=0)
    // → side pot board1 では p0 不適格なので残った p1 が勝つ
    expect(result.players[0].chips - beforeP0).toBe(65); // ante 主ポット board1 のみ
    expect(result.players[1].chips - beforeP1).toBe(100); // side pot board1
    expect(result.players[2].chips - beforeP2).toBe(65 + 100); // ante board2 + side board2
    // 合計分配 = 330
    expect((result.players[0].chips - beforeP0) + (result.players[1].chips - beforeP1) + (result.players[2].chips - beforeP2)).toBe(330);
  });

  it('全員アンテのみ (post-flop bet 無し) でも アンテ主ポットが全 active に分配される', () => {
    // ante=100 × 3 → pot=300、post-flop 何も起きずショウダウン
    const state = buildShowdownState({
      boards: [
        // Board1: p0 (KK) full house
        [card('A', 'h'), card('A', 'd'), card('A', 's'), card('2', 'c'), card('3', 'd')],
        // Board2: p1 (QQ) full house
        [card('A', 'c'), card('Q', 'h'), card('Q', 's'), card('7', 'c'), card('8', 'h')],
      ],
      bigBlind: 100,
      playersConfig: [
        { holeCards: [card('K', 'h'), card('K', 'c'), card('5', 'd'), card('6', 'd')], totalBetThisRound: 0 },
        { holeCards: [card('Q', 'c'), card('Q', 'd'), card('5', 'c'), card('5', 's')], totalBetThisRound: 0 },
        { holeCards: [card('2', 'h'), card('3', 's'), card('4', 'd'), card('5', 'h')], totalBetThisRound: 0 },
        null, null, null,
      ],
    });
    state.pot = 300; // helper の自動 pot=0 を上書き

    const beforeP0 = state.players[0].chips;
    const beforeP1 = state.players[1].chips;
    const result = determineBombPotWinner(state);

    // pot 300 を 2 ボードに半分割 → board1=150, board2=150
    // p0 が board1 勝ち → 150、p1 が board2 勝ち → 150
    expect(result.players[0].chips - beforeP0).toBe(150);
    expect(result.players[1].chips - beforeP1).toBe(150);
    // 分配済み合計 = 300
    expect(result.winners.reduce((s, w) => s + w.amount, 0)).toBe(300);
  });

  it('レーキを差し引いた額が分配される（rakePercent 指定時）', () => {
    const state = buildShowdownState({
      boards: [
        [card('A', 'h'), card('A', 'd'), card('Q', 'h'), card('7', 'c'), card('2', 's')],
        [card('9', 'c'), card('9', 'd'), card('J', 'c'), card('J', 'd'), card('3', 's')],
      ],
      bigBlind: 100,
      playersConfig: [
        { holeCards: [card('K', 'h'), card('K', 'd'), card('T', 'd'), card('T', 's')], totalBetThisRound: 1000 },
        { holeCards: [card('Q', 'c'), card('Q', 's'), card('5', 'c'), card('5', 's')], totalBetThisRound: 1000 },
        null, null, null, null,
      ],
    });

    const result = determineBombPotWinner(state, 0.05, 3); // 5% / cap 3BB=300
    // contested pot = 2000; raw rake = 100; cap = 300 → rake = 100
    expect(result.rake).toBe(100);
    // 残 1900 を 2 ボードに半分割 → 950 + 950
    // 各ボード 1 人勝ちなので各プレイヤー 950 を獲得
    const p0Total = result.winners.filter(w => w.playerId === 0).reduce((s, w) => s + w.amount, 0);
    const p1Total = result.winners.filter(w => w.playerId === 1).reduce((s, w) => s + w.amount, 0);
    expect(p0Total + p1Total).toBe(1900);
  });
});
