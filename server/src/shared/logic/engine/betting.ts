// ベッティング構造の実装
//
// 6 エンジンにコピペされていた bet/raise/all-in ロジックの唯一の置き場。
//   - potLimit:        PLO 系（ポットリミット + フルレイズ・リオープン規則）
//   - drawNoLimit:     NL 2-7 Single Draw（上限なし + リオープン規則）
//   - boardFixedLimit: Limit Hold'em / Omaha Hi-Lo（固定額・betCount 上限）
//   - drawFixedLimit:  Limit 2-7 Triple Draw
//   - studFixedLimit:  Stud 系（ブリングイン/コンプリートを含む）
//
// 微妙に異なる端数・オールイン境界の挙動（例: チップがちょうど固定ベット額の
// ときに bet を出すか allin を出すか）は既存エンジンごとの挙動を維持している。

import { GameState, Player, Action } from '../types.js';
import { BettingRules, ValidAction } from './descriptor.js';

/** 現在のストリートに応じた固定ベット額 (small bet / big bet) を返す関数 */
export type BetSizeSchedule = (state: GameState) => number;

/** チップを場に出す共通処理（オールインフラグ含む） */
function commitChips(state: GameState, player: Player, amount: number): void {
  player.chips -= amount;
  player.currentBet += amount;
  player.totalBetThisRound += amount;
  state.pot += amount;
  if (player.chips === 0) player.isAllIn = true;
}

/** ベット/レイズ後、他のプレイヤーに再アクション権を与える */
function reopenActionForOthers(state: GameState, actorId: number): void {
  for (const p of state.players) {
    if (p.id !== actorId && !p.folded && !p.isAllIn) {
      p.hasActed = false;
    }
  }
}

/** fold + (check | call) の共通部分を積み、toCall を返す */
function pushFoldCheckCall(state: GameState, player: Player, actions: ValidAction[]): number {
  const toCall = state.currentBet - player.currentBet;
  actions.push({ action: 'fold', minAmount: 0, maxAmount: 0 });
  if (toCall === 0) {
    actions.push({ action: 'check', minAmount: 0, maxAmount: 0 });
  } else {
    const callAmount = Math.min(toCall, player.chips);
    actions.push({ action: 'call', minAmount: callAmount, maxAmount: callAmount });
  }
  return toCall;
}

/** NL/PL 共通のフルレイズ・リオープン判定（hasActed 済みでも lastFullRaiseBet 未満ならリレイズ可） */
function canReraise(state: GameState, player: Player): boolean {
  return !player.hasActed || player.currentBet < state.lastFullRaiseBet;
}

/** NL/PL 共通の bet/raise 適用（amount = プレイヤーが追加で出す額） */
function applyBigBetRaise(state: GameState, playerIndex: number, amount: number): void {
  const player = state.players[playerIndex];
  // レイズ額を計算（前のベットからの増分）
  const raiseBy = amount - (state.currentBet - player.currentBet);
  if (raiseBy > state.minRaise) {
    state.minRaise = raiseBy;  // 次のレイズの最小額を更新
  }
  commitChips(state, player, amount);
  state.currentBet = player.currentBet;  // 新しい最高ベット額
  state.lastRaiserIndex = playerIndex;
  state.lastFullRaiseBet = state.currentBet;  // bet/raiseは常にフルレイズ
  reopenActionForOthers(state, player.id);
}

/** NL/PL 共通: フルレイズ相当オールイン時の minRaise / リオープン更新 */
function onBigBetAllInFullRaise(state: GameState, playerIndex: number, raiseBy: number): void {
  if (raiseBy > state.minRaise) {
    state.minRaise = raiseBy;
  }
  state.lastRaiserIndex = playerIndex;
  reopenActionForOthers(state, state.players[playerIndex].id);
}

// =========================================================================
//  Pot Limit（PLO / PLO5 / PLO6 / PLO8 / Big-O / Bomb Pot）
// =========================================================================

export function potLimitBetting(opts: {
  minRaiseForStreet: (state: GameState) => number;
  minRaiseBeforeAdvance?: (state: GameState) => number;
}): BettingRules {
  return {
    getActions(state, playerIndex) {
      const player = state.players[playerIndex];
      const actions: ValidAction[] = [];
      const toCall = pushFoldCheckCall(state, player, actions);

      // === フルレイズルール: リレイズ権の判定 ===
      // 非フルレイズのオールインに対して、既にアクション済みプレイヤーはコール/フォールドのみ
      const canRaise = canReraise(state, player);

      // === ポットリミット計算 ===
      // 最大レイズ = コール額 + (現在のポット + コール額)
      const potAfterCall = state.pot + toCall;
      const potLimitRaise = toCall + potAfterCall;
      const maxByPotLimit = Math.min(potLimitRaise, player.chips);

      if (canRaise && player.chips > toCall) {
        const minRaiseTotal = state.currentBet + state.minRaise;  // 最小レイズ後の合計ベット額
        const minRaiseAmount = minRaiseTotal - player.currentBet; // プレイヤーが追加で出す額

        if (state.currentBet === 0) {
          // ポットリミットベット = 現在のポット額。
          // 最小ベットは state.minRaise（新ストリート開始時に bigBlind / bomb pot は
          // ante にリセットされる）。bomb pot は bigBlind=0 のため bigBlind を直接
          // 参照すると 0 ベット = 実質チェックを許してしまう。
          const potLimitBet = Math.min(state.pot, player.chips);
          const minBet = Math.min(state.minRaise, player.chips);
          actions.push({ action: 'bet', minAmount: minBet, maxAmount: potLimitBet });
        } else if (player.chips >= minRaiseAmount) {
          actions.push({ action: 'raise', minAmount: minRaiseAmount, maxAmount: maxByPotLimit });
        }
      }

      // オールイン（チップがポットリミット以下の場合のみ選択肢として表示、かつリレイズ権あり）
      if (canRaise && player.chips > 0) {
        const maxBetOrRaise = state.currentBet === 0 ? state.pot : potLimitRaise;
        if (player.chips <= maxBetOrRaise) {
          actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
        }
      }

      return actions;
    },

    applyBetRaise(state, playerIndex, _action, amount) {
      applyBigBetRaise(state, playerIndex, amount);
    },

    fullRaiseThreshold: (state) => state.minRaise,
    onAllInFullRaise: onBigBetAllInFullRaise,
    allInFullRaiseSetsLastFullRaiseBet: true,
    minRaiseForStreet: opts.minRaiseForStreet,
    minRaiseBeforeAdvance: opts.minRaiseBeforeAdvance,
  };
}

// =========================================================================
//  No Limit（NL 2-7 Single Draw）
// =========================================================================

export function noLimitBetting(): BettingRules {
  return {
    getActions(state, playerIndex) {
      const player = state.players[playerIndex];
      const actions: ValidAction[] = [];
      const toCall = pushFoldCheckCall(state, player, actions);
      const canRaise = canReraise(state, player);

      if (canRaise && player.chips > toCall) {
        if (state.currentBet === 0) {
          // ベット: min=BB, max=全チップ
          const minBet = Math.min(state.bigBlind, player.chips);
          actions.push({ action: 'bet', minAmount: minBet, maxAmount: player.chips });
        } else {
          // レイズ: min=minRaise, max=全チップ
          const minRaiseTotal = state.currentBet + state.minRaise;
          const minRaiseAmount = minRaiseTotal - player.currentBet;
          if (player.chips >= minRaiseAmount) {
            actions.push({ action: 'raise', minAmount: minRaiseAmount, maxAmount: player.chips });
          }
        }
      }

      // No-Limit ではポット上限が無いため、レイズ権がありチップが残っている限り
      // 常に全額投入できる（フルレイズに満たない短スタックも含む）
      if (canRaise && player.chips > 0) {
        actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
      }

      return actions;
    },

    applyBetRaise(state, playerIndex, _action, amount) {
      applyBigBetRaise(state, playerIndex, amount);
    },

    fullRaiseThreshold: (state) => state.minRaise,
    onAllInFullRaise: onBigBetAllInFullRaise,
    allInFullRaiseSetsLastFullRaiseBet: true,
    minRaiseForStreet: (state) => state.bigBlind,
  };
}

// =========================================================================
//  Fixed Limit — ボードゲーム系（Limit Hold'em / Omaha Hi-Lo）
// =========================================================================

export function boardFixedLimitBetting(betSize: BetSizeSchedule): BettingRules {
  return {
    getActions(state, playerIndex) {
      const player = state.players[playerIndex];
      const actions: ValidAction[] = [];
      const toCall = state.currentBet - player.currentBet;
      const size = betSize(state);
      const canRaiseMore = state.betCount < (state.maxBetsPerRound || 4);

      actions.push({ action: 'fold', minAmount: 0, maxAmount: 0 });

      if (toCall === 0) {
        actions.push({ action: 'check', minAmount: 0, maxAmount: 0 });

        if (canRaiseMore && player.chips > 0) {
          const betAmount = Math.min(size, player.chips);
          if (player.chips <= size) {
            actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
          } else {
            actions.push({ action: 'bet', minAmount: betAmount, maxAmount: betAmount });
          }
        }
      } else {
        const callAmount = Math.min(toCall, player.chips);
        actions.push({ action: 'call', minAmount: callAmount, maxAmount: callAmount });

        if (canRaiseMore && player.chips > toCall) {
          const raiseAmount = toCall + size;
          if (player.chips <= raiseAmount) {
            actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
          } else {
            actions.push({ action: 'raise', minAmount: raiseAmount, maxAmount: raiseAmount });
          }
        }
      }

      return actions;
    },

    applyBetRaise(state, playerIndex, _action, amount) {
      // クライアントから渡された額をそのまま投入する（getActions が固定額を提示済み）
      const player = state.players[playerIndex];
      commitChips(state, player, amount);
      state.currentBet = player.currentBet;
      state.lastRaiserIndex = playerIndex;
      state.lastFullRaiseBet = state.currentBet;
      state.betCount++;
      reopenActionForOthers(state, player.id);
    },

    fullRaiseThreshold: (state) => betSize(state),
    onAllInFullRaise(state, playerIndex) {
      state.lastRaiserIndex = playerIndex;
      state.betCount++;
      reopenActionForOthers(state, state.players[playerIndex].id);
    },
    allInFullRaiseSetsLastFullRaiseBet: true,
    minRaiseForStreet: (state) => betSize(state),
    minRaiseBeforeAdvance: (state) => betSize(state),
  };
}

// =========================================================================
//  Fixed Limit — 固定額をエンジン側で算出する系（Stud / Triple Draw）
// =========================================================================

/** bet=コンプリート込みの目標額 / raise=現在ベット+固定額、を自前計算して投入する */
function applyComputedFixedBetRaise(state: GameState, playerIndex: number, action: Action, size: number): void {
  const player = state.players[playerIndex];
  const targetBet = action === 'bet' ? size : state.currentBet + size;
  const betAmount = targetBet - player.currentBet;
  const actualAmount = Math.min(betAmount, player.chips);
  commitChips(state, player, actualAmount);
  state.currentBet = player.currentBet;
  state.lastRaiserIndex = playerIndex;
  state.betCount++;
  reopenActionForOthers(state, player.id);
}

export function drawFixedLimitBetting(betSize: BetSizeSchedule): BettingRules {
  return {
    getActions(state, playerIndex) {
      const player = state.players[playerIndex];
      const actions: ValidAction[] = [];
      const toCall = pushFoldCheckCall(state, player, actions);
      const size = betSize(state);
      const canRaise = state.betCount < state.maxBetsPerRound;

      if (canRaise && player.chips > toCall) {
        if (state.currentBet === 0) {
          if (player.chips >= size) {
            actions.push({ action: 'bet', minAmount: size, maxAmount: size });
          } else if (player.chips > 0) {
            actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
          }
        } else {
          const raiseTotal = state.currentBet + size;
          const raiseAmount = raiseTotal - player.currentBet;
          if (player.chips >= raiseAmount) {
            actions.push({ action: 'raise', minAmount: raiseAmount, maxAmount: raiseAmount });
          } else if (player.chips > toCall) {
            actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
          }
        }
      }

      return actions;
    },

    applyBetRaise(state, playerIndex, action) {
      applyComputedFixedBetRaise(state, playerIndex, action, betSize(state));
    },

    fullRaiseThreshold: (state) => betSize(state),
    onAllInFullRaise(state, playerIndex) {
      state.betCount++;
      state.lastRaiserIndex = playerIndex;
      reopenActionForOthers(state, state.players[playerIndex].id);
    },
    allInFullRaiseSetsLastFullRaiseBet: true,
    minRaiseForStreet: (state) => betSize(state),
  };
}

export function studFixedLimitBetting(betSize: BetSizeSchedule): BettingRules {
  /** 3rd street、まだ誰もベットしていない = ブリングイン選択フェーズ */
  const isBringInPhase = (state: GameState) =>
    state.currentStreet === 'third' && state.currentBet === 0 && state.betCount === 0;

  return {
    getActions(state, playerIndex) {
      const player = state.players[playerIndex];
      const actions: ValidAction[] = [];
      const size = betSize(state);

      // === ブリングインフェーズ ===
      // ブリングインプレイヤーは「ブリングイン」か「コンプリート」を選択（フォールド不可）
      if (isBringInPhase(state)) {
        const bringInAmount = Math.min(state.bringIn, player.chips);
        // call = ブリングイン（最低額を投入）
        actions.push({ action: 'call', minAmount: bringInAmount, maxAmount: bringInAmount });
        // bet = コンプリート（スモールベット額を投入）
        if (player.chips >= size) {
          actions.push({ action: 'bet', minAmount: size, maxAmount: size });
        } else if (player.chips > bringInAmount) {
          actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
        }
        return actions;
      }

      const toCall = pushFoldCheckCall(state, player, actions);
      const canRaise = state.betCount < state.maxBetsPerRound;

      // ブリングイン後のコンプリートは「レイズ」ではなく「ベット」として扱う
      const isBringInOnly = state.currentStreet === 'third' && state.betCount === 0 && state.currentBet === state.bringIn;

      if (canRaise && player.chips > toCall) {
        if (state.currentBet === 0 || isBringInOnly) {
          const betAmount = size - player.currentBet;
          if (player.chips >= betAmount) {
            actions.push({ action: 'bet', minAmount: betAmount, maxAmount: betAmount });
          } else if (player.chips > toCall) {
            actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
          }
        } else {
          const raiseTotal = state.currentBet + size;
          const raiseAmount = raiseTotal - player.currentBet;
          if (player.chips >= raiseAmount) {
            actions.push({ action: 'raise', minAmount: raiseAmount, maxAmount: raiseAmount });
          } else if (player.chips > toCall) {
            actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
          }
        }
      }

      return actions;
    },

    applyBetRaise(state, playerIndex, action) {
      // Stud の bet はコンプリート（目標額 = betSize）を含むため自前計算
      applyComputedFixedBetRaise(state, playerIndex, action, betSize(state));
    },

    applyCallOverride(state, playerIndex) {
      // ブリングインフェーズの call = ブリングイン投入（currentBet を確立する）
      if (!isBringInPhase(state)) return false;
      const player = state.players[playerIndex];
      const toCall = Math.min(state.bringIn, player.chips);
      commitChips(state, player, toCall);
      state.currentBet = toCall;
      state.lastRaiserIndex = playerIndex;
      return true;
    },

    fullRaiseThreshold: (state) => betSize(state),
    onAllInFullRaise(state, playerIndex) {
      state.betCount++;
      state.lastRaiserIndex = playerIndex;
      reopenActionForOthers(state, state.players[playerIndex].id);
    },
    // Stud エンジンはオールインで lastFullRaiseBet を更新しない（従来挙動の維持）
    allInFullRaiseSetsLastFullRaiseBet: false,
    minRaiseForStreet: (state) => betSize(state),
  };
}
