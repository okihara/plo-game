import type { ClientGameState } from '@plo/shared';
import { convertOnlinePlayerToPlayer } from '@plo/shared';
import type { Card, GameState, Street, GameVariant } from '../logic/types';

export { convertOnlinePlayerToPlayer };

export function convertClientStateToGameState(
  clientState: ClientGameState,
  myHoleCards: Card[],
  mySeat: number | null,
  showdownCards: Map<number, Card[]>
): GameState {
  const players = clientState.players.map((p, i) => convertOnlinePlayerToPlayer(p, i, clientState.dealerSeat));

  if (mySeat !== null && players[mySeat]) {
    players[mySeat].holeCards = myHoleCards;
  }

  for (const [seatIndex, cards] of showdownCards) {
    if (players[seatIndex] && seatIndex !== mySeat) {
      players[seatIndex].holeCards = cards;
      players[seatIndex].isShowdown = true;
    }
  }

  return {
    tableId: clientState.tableId,
    players,
    deck: [],
    communityCards: clientState.communityCards,
    boards: clientState.boards,
    pot: clientState.pot,
    sidePots: (clientState.sidePots || []).map(sp => ({
      amount: sp.amount,
      eligiblePlayers: sp.eligiblePlayerSeats,
    })),
    currentStreet: clientState.currentStreet as Street,
    currentBet: clientState.currentBet,
    minRaise: clientState.minRaise,
    dealerPosition: clientState.dealerSeat,
    smallBlind: clientState.smallBlind,
    bigBlind: clientState.bigBlind,
    currentPlayerIndex: clientState.currentPlayerSeat ?? -1,
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: !clientState.isHandInProgress,
    winners: [],
    rake: clientState.rake ?? 0,
    variant: (clientState.variant as GameVariant) ?? 'plo',
    ante: clientState.ante ?? 0,
    bringIn: clientState.bringIn ?? 0,
    betCount: 0,
    maxBetsPerRound: 4,
    validActions: clientState.validActions ?? null,
    chipUnit: clientState.chipUnit,
  };
}

/** コーチング機能（ポーズ・ハンドオープン）の表示状態 */
export interface PauseState {
  isPaused: boolean;
  /** 自分がコーチング機能を操作できるか（プライベート卓の作成者のみ true） */
  canControl: boolean;
  /** 自動解除の時刻（UNIXタイムスタンプ、ミリ秒）。ポーズ中のみ */
  pausedUntil: number | null;
  /** ハンド完了時に全員のホールカードが公開される設定になっている */
  revealAllHands: boolean;
}

export const NO_PAUSE: PauseState = {
  isPaused: false,
  canControl: false,
  pausedUntil: null,
  revealAllHands: false,
};

/**
 * game:state からコーチング機能の表示状態を導出する（プレイ中・観戦中で共通）。
 * コーチング機能を扱わない卓（通常キャッシュ／トーナメント）では NO_PAUSE を返す。
 */
export function derivePauseState(state: ClientGameState, myOdId: string | null): PauseState {
  if (!state.isPaused && !state.pauseOwnerOdId) return NO_PAUSE;
  return {
    isPaused: state.isPaused ?? false,
    canControl: !!myOdId && state.pauseOwnerOdId === myOdId,
    pausedUntil: state.pausedUntil ?? null,
    revealAllHands: state.revealAllHands ?? false,
  };
}
