// 座席・プレイヤー走査の共通ヘルパー
// 全バリアント共通の「次の席を探す」系ロジックを一箇所に集約する

import { GameState, Player, Position, POSITIONS } from '../types.js';

export const MAX_PLAYERS = 6;

/** ローカル対戦用のデフォルトプレイヤー名（createGameState 系で共用） */
export const DEFAULT_PLAYER_NAMES = ['You', 'Miko', 'Kento', 'Luna', 'Hiro', 'Tomoka'];

/** フォールドしていないプレイヤー一覧 */
export function getActivePlayers(state: GameState): Player[] {
  return state.players.filter(p => !p.folded);
}

/** アクション可能なプレイヤー一覧（フォールドしておらず、オールインでもない） */
export function getPlayersWhoCanAct(state: GameState): Player[] {
  return state.players.filter(p => !p.folded && !p.isAllIn);
}

/** ハンドに参加しているプレイヤー数（着席中でフォールドしていない） */
export function getActivePlayerCount(state: GameState): number {
  return state.players.filter(p => !p.isSittingOut && !p.folded).length;
}

/**
 * 次のアクション可能なプレイヤーを探す
 * @param fromIndex この位置の次から探し始める
 * @returns プレイヤーインデックス、見つからない場合は-1
 */
export function getNextActivePlayer(state: GameState, fromIndex: number): number {
  let index = ((fromIndex % MAX_PLAYERS) + MAX_PLAYERS + 1) % MAX_PLAYERS;
  for (let count = 0; count < MAX_PLAYERS; count++) {
    const p = state.players[index];
    if (!p.isSittingOut && !p.folded && !p.isAllIn) {
      return index;
    }
    index = (index + 1) % MAX_PLAYERS;
  }
  return -1;
}

/**
 * 指定位置から次のハンド参加席（着席中・未フォールド）を探す
 * ディーラーボタン移動やブラインド位置決定に使用
 */
export function getNextSeatInHand(state: GameState, fromIndex: number): number {
  let index = ((fromIndex % MAX_PLAYERS) + MAX_PLAYERS + 1) % MAX_PLAYERS;
  for (let count = 0; count < MAX_PLAYERS; count++) {
    if (!state.players[index].isSittingOut && !state.players[index].folded) {
      return index;
    }
    index = (index + 1) % MAX_PLAYERS;
  }
  return -1;
}

/**
 * SB 側（dealer+1）から時計回りで最初に行動できるプレイヤーを探す
 * @param includeAllIn ドローフェーズはオールインでもカード交換するため true
 */
export function findFirstActorFromSb(state: GameState, includeAllIn: boolean = false): number {
  const sbIndex = (state.dealerPosition + 1) % MAX_PLAYERS;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const idx = (sbIndex + i) % MAX_PLAYERS;
    const p = state.players[idx];
    if (!p.folded && !p.isSittingOut && (includeAllIn || !p.isAllIn)) {
      return idx;
    }
  }
  return -1;
}

/** BB 以降（人数に応じて）— 5-max は HJ を省略して UTG→CO */
const POST_BB_POSITION_LABELS: Record<number, readonly Position[]> = {
  1: ['UTG'],
  2: ['UTG', 'CO'],
  3: ['UTG', 'HJ', 'CO'],
};

function getNextOccupiedSeatForLabels(
  state: GameState,
  fromIndex: number,
  assigned: Set<number>,
  maxSeats: number,
): number {
  let index = (fromIndex + 1) % maxSeats;
  for (let c = 0; c < maxSeats; c++) {
    if (!assigned.has(index)) {
      const p = state.players[index];
      if (!p.isSittingOut && !p.folded) {
        return index;
      }
    }
    index = (index + 1) % maxSeats;
  }
  return -1;
}

/**
 * 空席を挟むテーブルでも BTN/SB/BB/UTG… を実際のブラインド順と一致させる
 */
export function assignBlindPostingPositions(
  state: GameState,
  dealerPosition: number,
  sbIndex: number,
  bbIndex: number,
  activeCount: number,
  maxSeats: number = MAX_PLAYERS,
): void {
  const assigned = new Set<number>();

  if (activeCount === 2) {
    state.players[sbIndex].position = 'BTN';
    state.players[bbIndex].position = 'BB';
    assigned.add(sbIndex).add(bbIndex);
  } else {
    state.players[dealerPosition].position = 'BTN';
    state.players[sbIndex].position = 'SB';
    state.players[bbIndex].position = 'BB';
    assigned.add(dealerPosition).add(sbIndex).add(bbIndex);

    const extra = activeCount - 3;
    const labels = POST_BB_POSITION_LABELS[extra] ?? [];
    let cursor = bbIndex;
    for (const label of labels) {
      const next = getNextOccupiedSeatForLabels(state, cursor, assigned, maxSeats);
      if (next === -1) break;
      state.players[next].position = label;
      assigned.add(next);
      cursor = next;
    }
  }

  for (let i = 0; i < maxSeats; i++) {
    if (state.players[i].isSittingOut) {
      state.players[i].position = POSITIONS[(i - dealerPosition + maxSeats) % maxSeats];
    }
  }
}

/** ディーラー位置を基準に全席のポジション名を機械的に再計算する（Stud 系） */
export function rotatePositionLabels(state: GameState): void {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const posIndex = (i - state.dealerPosition + MAX_PLAYERS) % MAX_PLAYERS;
    state.players[i].position = POSITIONS[posIndex];
  }
}
