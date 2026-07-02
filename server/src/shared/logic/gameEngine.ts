// PLO 系（PLO / PLO5 / PLO6 / PLO8 / Big-O）エンジン
//
// 実装は engine/ の共通コア + Omaha 記述子（engine/variants/omaha.ts）に移行済み。
// このファイルは従来の公開 API を維持する薄い委譲層で、テスト・AI・テーブル層からの
// import はここを経由する。汎用ヘルパー（getActivePlayers 等）の re-export もここ。

import { GameState, Action, POSITIONS } from './types.js';
import {
  buildBaseGameState,
  startHandCore,
  getValidActionsCore,
  applyActionCore,
  wouldAdvanceStreetCore,
  determineNextActionCore,
  determineWinnerCore,
} from './engine/core.js';
import { omahaDescriptor } from './engine/variants/omaha.js';

export { getActivePlayers, getPlayersWhoCanAct, assignBlindPostingPositions } from './engine/players.js';
export { calculateSidePots, calculateRake, splitChipsEvenly } from './engine/pots.js';

/**
 * ゲームの初期状態を作成する
 * @param playerChips 各プレイヤーの初期チップ量（デフォルト: 600）
 */
export function createInitialGameState(playerChips: number = 600): GameState {
  return buildBaseGameState({
    playerChips,
    currentStreet: 'preflop',
    minRaise: 0,
    smallBlind: 1,
    bigBlind: 3,
    variant: 'plo',
  });
}

/**
 * 新しいハンドを開始する
 * デッキのシャッフル、ブラインド投稿、カード配布を行う
 */
export function startNewHand(state: GameState): GameState {
  return startHandCore(state, omahaDescriptor);
}

/**
 * 指定プレイヤーが取れる有効なアクション一覧を取得
 * ポットリミット制限を考慮したベット/レイズ額を計算
 */
export function getValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  return getValidActionsCore(state, playerIndex, omahaDescriptor);
}

/**
 * プレイヤーのアクションをゲーム状態に適用する
 */
export function applyAction(state: GameState, playerIndex: number, action: Action, amount: number = 0, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  return applyActionCore(state, playerIndex, action, amount, omahaDescriptor, rakePercent, rakeCapBB);
}

/**
 * アクションを適用した結果、次のストリートに進むかどうかを判定する（immutable）
 */
export function wouldAdvanceStreet(state: GameState, playerIndex: number, action: Action, amount: number = 0): boolean {
  return wouldAdvanceStreetCore(state, playerIndex, action, amount, omahaDescriptor);
}

/**
 * 次にアクションすべきプレイヤーを決定する
 * @returns nextPlayerIndex: 次のプレイヤー（-1なら終了）, moveToNextStreet: 次のストリートに進むか
 */
export const determineNextAction = determineNextActionCore;

/**
 * 勝者を決定し、ポットを分配する
 */
export function determineWinner(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  return determineWinnerCore(state, omahaDescriptor, rakePercent, rakeCapBB);
}

/**
 * ポジションを回転する（次のハンドの準備）
 * ディーラーボタンを1つ進め、全プレイヤーのポジション名を更新
 */
export function rotatePositions(state: GameState): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  newState.dealerPosition = (newState.dealerPosition + 1) % 6;

  // ディーラー位置を基準にポジション名を再計算
  for (let i = 0; i < 6; i++) {
    const posIndex = (i - newState.dealerPosition + 6) % 6;
    newState.players[i].position = POSITIONS[posIndex];
  }

  return newState;
}
