// チップ表示倍率 (chipUnit) のスケーリングヘルパー。
//
// サーバー/クライアント間およびエンジン内部のチップ値はすべて素の整数 1 単位で扱う。
// UI 表示・ハンドヒストリー保存時に chipUnit を掛けて「見かけ上のチップ数」に変換する。
//
// 用途:
//   - useOnlineGameState の onGameState 境界で ClientGameState を表示用に乗算
//   - useTournamentState の onTournamentState 境界で blind level / averageStack を乗算
//   - イベント単発で受け取るチップ系数値 (game:action_taken の amount 等) を乗算
//
// chipUnit が 1 (= キャッシュゲーム) または未指定なら no-op で同じオブジェクトを返す。

import type { ClientGameState } from './protocol';
import type { BlindLevel, ClientTournamentState } from './tournament';

/** ClientGameState の全チップ系列値を chipUnit 倍する */
export function scaleClientGameStateForDisplay(state: ClientGameState): ClientGameState {
  const u = state.chipUnit ?? 1;
  if (u <= 1) return state;
  return {
    ...state,
    pot: state.pot * u,
    sidePots: state.sidePots.map(sp => ({ ...sp, amount: sp.amount * u })),
    currentBet: state.currentBet * u,
    minRaise: state.minRaise * u,
    smallBlind: state.smallBlind * u,
    bigBlind: state.bigBlind * u,
    ante: state.ante * u,
    bringIn: state.bringIn * u,
    rake: state.rake * u,
    players: state.players.map(p => p ? {
      ...p,
      chips: p.chips * u,
      currentBet: p.currentBet * u,
    } : null),
    validActions: state.validActions?.map(a => ({
      ...a,
      minAmount: a.minAmount * u,
      maxAmount: a.maxAmount * u,
    })) ?? null,
  };
}

/** BlindLevel の sb/bb/ante を chipUnit 倍する */
export function scaleBlindLevelForDisplay(level: BlindLevel, chipUnit: number | undefined): BlindLevel {
  const u = chipUnit ?? 1;
  if (u <= 1) return level;
  return {
    ...level,
    smallBlind: level.smallBlind * u,
    bigBlind: level.bigBlind * u,
    ante: level.ante * u,
  };
}

/** ClientTournamentState の chip 系数値を chipUnit 倍する */
export function scaleClientTournamentStateForDisplay(state: ClientTournamentState): ClientTournamentState {
  const u = state.chipUnit ?? 1;
  if (u <= 1) return state;
  return {
    ...state,
    averageStack: state.averageStack * u,
    currentBlindLevel: scaleBlindLevelForDisplay(state.currentBlindLevel, u),
    nextBlindLevel: state.nextBlindLevel ? scaleBlindLevelForDisplay(state.nextBlindLevel, u) : null,
  };
}
