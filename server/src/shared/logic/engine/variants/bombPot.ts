// PLO Double Board Bomb Pot 記述子
//
// 仕様詳細: docs/double-board-bomb-pot.md
//
// 通常 PLO との差分:
//   - プリフロップなし。全員 1 BB のアンテを支払い、即フロップから開始
//   - 2つの独立したボード（各 5 枚）を同時に進行
//   - ベッティングは 1 系統（フロップ → ターン → リバー、Pot Limit）
//   - 各 contested side pot を半分ずつ 2 ボードに分け、ボード毎に独立評価

import { GameState } from '../../types.js';
import { dealCards } from '../../deck.js';
import { evaluatePLOHand, compareHands, formatHandName } from '../../handEvaluator.js';
import { MAX_PLAYERS, assignBlindPostingPositions, findFirstActorFromSb, getActivePlayers } from '../players.js';
import { potLimitBetting } from '../betting.js';
import { calculateSidePots, splitChipsEvenly, SidePot, PotWinnerEntry } from '../pots.js';
import { VariantDescriptor } from '../descriptor.js';
import { buildBaseGameState, findBlindSeats, dealHoleCardsToAll, getActivePlayerCount, runOutAndFinish } from '../core.js';

const HOLE_CARD_COUNT = 4; // PLO 固定（plo5 は対象外）
const BOARD_COUNT = 2;     // double board 固定

/** 各ボードに 1 枚ずつカードを配る */
function dealOneToEachBoard(state: GameState): void {
  if (!state.boards) state.boards = [[], []];
  for (let b = 0; b < BOARD_COUNT; b++) {
    if (state.boards[b].length >= 5) continue;
    const { cards, remainingDeck } = dealCards(state.deck, 1);
    state.boards[b].push(...cards);
    state.deck = remainingDeck;
  }
  state.communityCards = state.boards[0]; // 後方互換ミラー
}

/** 両ボードが 5 枚に達していなければ true */
function boardNeedsMore(state: GameState): boolean {
  if (!state.boards) return false;
  return state.boards.some(b => b.length < 5);
}

export const bombPotDescriptor: VariantDescriptor = {
  resetHand(state) {
    state.boards = [[], []];
    state.currentBet = 0;
    // bomb pot ではポストフロップの最小ベット = アンテ額（= 1BB 相当）
    state.minRaise = state.ante;
  },

  setup(state) {
    const activeCount = getActivePlayerCount(state);

    // === SB/BB ラベル付与（位置決定のため。投稿はしない）===
    const seats = findBlindSeats(state, activeCount);
    const sbIndex = seats.sbIndex;
    const bbIndex = seats.bbIndex === -1 ? sbIndex : seats.bbIndex;
    assignBlindPostingPositions(state, state.dealerPosition, sbIndex, bbIndex, activeCount, MAX_PLAYERS);

    // === アンテ徴収（全員 1 BB 相当、不足は持っているチップ全部）===
    // 標準ポーカーの ante ルール: アンテはベットではないので side pot を作らない。
    // 短スタックがアンテで all-in でも勝てば pot 全額を獲得できるよう、
    // totalBetThisRound には記録せず pot に直接加算する。
    // post-flop で bet/raise した分のみが totalBetThisRound に乗り、そこから
    // 通常通り side pot が形成される。
    const ante = state.ante;
    for (const p of state.players) {
      if (p.isSittingOut) continue;
      const paid = Math.min(ante, p.chips);
      p.chips -= paid;
      p.totalBetThisRound = 0;
      p.currentBet = 0;
      if (p.chips === 0) p.isAllIn = true;
      state.pot += paid;
    }

    // === ホールカード配布 (4 枚) ===
    dealHoleCardsToAll(state, HOLE_CARD_COUNT);

    // === 各ボードにフロップ 3 枚を配布 ===
    for (let b = 0; b < BOARD_COUNT; b++) {
      const { cards, remainingDeck } = dealCards(state.deck, 3);
      state.boards![b] = cards;
      state.deck = remainingDeck;
    }
    state.communityCards = state.boards![0]; // 後方互換ミラー

    state.currentStreet = 'flop';

    // === 最初に行動するプレイヤー（ポストフロップ規則: SB から時計回り）===
    const firstActor = findFirstActorFromSb(state);
    if (firstActor === -1) {
      // 全員 all-in (アンテで破産) → ランアウトしてショーダウン
      return runOutAndFinish(state, bombPotDescriptor);
    }
    state.currentPlayerIndex = firstActor;

    return state;
  },

  betting: potLimitBetting({
    // bomb pot は bigBlind=0 / ante=N で統一表現するため minRaise の基準は ante
    minRaiseForStreet: (state) => state.ante,
    minRaiseBeforeAdvance: (state) => state.ante,
  }),

  flow: {
    nextStreet(state) {
      switch (state.currentStreet) {
        case 'flop': return 'turn';
        case 'turn': return 'river';
        case 'river': return 'showdown';
        default:
          // 'preflop' からは来ない（setup で 'flop' になっている）想定
          throw new Error(`bomb pot: unexpected street transition from ${state.currentStreet}`);
      }
    },
    onEnterStreet(state) {
      dealOneToEachBoard(state);
    },
    firstToAct(state) {
      return findFirstActorFromSb(state);
    },
    whenBettingImpossible: 'runout',
    runOutDealsBeforeShowdown: true,
    runOut(state) {
      while (boardNeedsMore(state)) {
        dealOneToEachBoard(state);
      }
    },
  },

  showdown: {
    // bomb pot はプリフロップが存在しないため常にレーキ対象
    noDropStreet: null,
    // bigBlind=0 で表現しているため、レーキ cap には ante を使う
    rakeCapBase: (state) => state.ante,

    buildPots(state) {
      // アンテは totalBetThisRound に記録していないため、calculateSidePots は
      // ポストフロップで bet/raise した分のサイドポットだけを返す。
      // pot - サイドポット合計 = アンテで集まった分 (= 全 active 対象の主ポット)。
      const postflopSidePots = calculateSidePots(state.players);
      const contestedPostflopPots = postflopSidePots.filter(p => p.eligiblePlayers.length >= 2);
      const uncontestedPostflopPots = postflopSidePots.filter(p => p.eligiblePlayers.length === 1);

      // post-flop で uncontested になった分（自分一人しか出していない bet）は本人に返却
      for (const pot of uncontestedPostflopPots) {
        const player = state.players.find(p => p.id === pot.eligiblePlayers[0])!;
        player.chips += pot.amount;
        state.pot -= pot.amount;
      }

      // pot からポストフロップ contested 分を引いた残りがアンテ主ポット
      const postflopContestedTotal = contestedPostflopPots.reduce((sum, p) => sum + p.amount, 0);
      const antePot = state.pot - postflopContestedTotal;

      // 分配対象ポット = [アンテ主ポット (全 active 対象), ...各 post-flop contested ポット]
      const contestedPots: SidePot[] = [];
      if (antePot > 0) {
        contestedPots.push({ amount: antePot, eligiblePlayers: getActivePlayers(state).map(p => p.id) });
      }
      contestedPots.push(...contestedPostflopPots);
      return contestedPots;
    },

    resolvePots(state, activePlayers, pots) {
      // === 各ボードについて、各プレイヤーのハンドを評価 ===
      const handByBoard: Map<number, ReturnType<typeof evaluatePLOHand>>[] = [];
      for (let b = 0; b < BOARD_COUNT; b++) {
        const map = new Map<number, ReturnType<typeof evaluatePLOHand>>();
        for (const player of activePlayers) {
          map.set(player.id, evaluatePLOHand(player.holeCards, state.boards![b]));
        }
        handByBoard.push(map);
      }

      // === 各 sidepot を 2 ボードに半分割し、ボード毎に勝者決定 ===
      // 半分割の端数（chipUnit 未満）はボード 1 へ。ボード内チョップの端数は最初の勝者へ。
      // winners[] には (playerId × board) ごとに 1 エントリを積む。
      const entries: PotWinnerEntry[] = [];
      const chipUnit = state.chipUnit ?? 1;

      for (const pot of pots) {
        const boardAmounts = splitChipsEvenly(pot.amount, BOARD_COUNT, chipUnit);

        for (let b = 0; b < BOARD_COUNT; b++) {
          const boardPotAmount = boardAmounts[b];
          if (boardPotAmount === 0) continue;

          const eligibleHands = pot.eligiblePlayers
            .filter(id => handByBoard[b].has(id))
            .map(id => ({ playerId: id, hand: handByBoard[b].get(id)! }));

          if (eligibleHands.length === 0) continue;

          eligibleHands.sort((a, b2) => compareHands(b2.hand, a.hand));
          const top = [eligibleHands[0]];
          for (let i = 1; i < eligibleHands.length; i++) {
            if (compareHands(eligibleHands[i].hand, eligibleHands[0].hand) === 0) {
              top.push(eligibleHands[i]);
            } else {
              break;
            }
          }

          const shares = splitChipsEvenly(boardPotAmount, top.length, chipUnit);
          for (let i = 0; i < top.length; i++) {
            entries.push({
              playerId: top[i].playerId,
              amount: shares[i],
              handName: `Board ${b + 1}: ${formatHandName(top[i].hand)}`,
            });
          }
        }
      }

      return entries;
    },
  },

  createTableState(_variant, buyInChips, smallBlind, bigBlind, ante) {
    const state = createBombPotBaseState(buyInChips);
    // SB/BB は投稿せず全員アンテのみ。blind level の ante フィールドを直接使う。
    state.smallBlind = smallBlind;
    state.bigBlind = bigBlind;
    state.ante = ante;
    return state;
  },
};

/** Bomb pot 用の初期 GameState（シムの createBombPotGameState と共用） */
export function createBombPotBaseState(playerChips: number): GameState {
  return buildBaseGameState({
    playerChips,
    currentStreet: 'preflop', // startHand で 'flop' に切り替え
    minRaise: 0,
    // bomb pot は SB/BB を投稿せず全員アンテのみ。"sb=0 / bb=0 / ante=N" で統一表現。
    smallBlind: 0,
    bigBlind: 0,
    variant: 'plo_double_board_bomb',
    ante: 3, // 後で VariantAdapter / TableInstance が blind level の値で上書き
    extra: { boards: [[], []] },
  });
}
