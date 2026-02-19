// ClientGameState変換（静的メソッド）

import { GameState, Player } from '../../../shared/logic/types.js';
import { ClientGameState, OnlinePlayer } from '../../../shared/types/websocket.js';
import { SeatInfo, PendingAction } from '../types.js';

export class StateTransformer {
  /**
   * SeatInfoからOnlinePlayerを生成
   * getClientGameState内とgetOnlinePlayerで重複していた処理を統一
   */
  static seatToOnlinePlayer(
    seat: SeatInfo | null,
    seatIndex: number,
    player: Player | null
  ): OnlinePlayer | null {
    if (!seat) return null;

    // waitingForNextHandプレイヤーの特殊処理
    if (seat.waitingForNextHand) {
      return {
        odId: seat.odId,
        odName: seat.odName,
        avatarId: seat.avatarId,
        avatarUrl: seat.avatarUrl,
        seatNumber: seatIndex,
        chips: seat.chips, // buyIn時のチップを表示
        currentBet: 0,
        folded: true, // 参加していないのでfolded扱い
        isAllIn: false,
        hasActed: true,
        isConnected: seat.socket?.connected ?? false,
      };
    }

    return {
      odId: seat.odId,
      odName: seat.odName,
      avatarId: seat.avatarId,
      avatarUrl: seat.avatarUrl,
      seatNumber: seatIndex,
      chips: player?.chips ?? seat.chips,
      currentBet: player?.currentBet ?? 0,
      folded: player?.folded ?? false,
      isAllIn: player?.isAllIn ?? false,
      hasActed: player?.hasActed ?? false,
      isConnected: seat.socket?.connected ?? false,
    };
  }

  /**
   * GameStateからClientGameStateを生成
   */
  static toClientGameState(
    tableId: string,
    seats: (SeatInfo | null)[],
    gameState: GameState | null,
    pendingAction: PendingAction | null,
    isHandInProgress: boolean,
    smallBlind: number,
    bigBlind: number
  ): ClientGameState {
    // タイムアウト情報を計算
    const actionTimeoutAt = pendingAction
      ? pendingAction.requestedAt + pendingAction.timeoutMs
      : null;
    const actionTimeoutMs = pendingAction?.timeoutMs ?? null;

    if (!gameState) {
      return {
        tableId,
        players: seats.map((seat, i) =>
          this.seatToOnlinePlayer(seat, i, null)
        ),
        communityCards: [],
        pot: 0,
        sidePots: [],
        currentStreet: 'preflop',
        dealerSeat: 0,
        currentPlayerSeat: null,
        currentBet: 0,
        minRaise: bigBlind,
        smallBlind,
        bigBlind,
        isHandInProgress: false,
        actionTimeoutAt: null,
        actionTimeoutMs: null,
      };
    }

    return {
      tableId,
      players: seats.map((seat, i) =>
        this.seatToOnlinePlayer(seat, i, gameState.players[i])
      ),
      communityCards: gameState.communityCards,
      pot: gameState.pot,
      sidePots: (gameState.sidePots || []).map(sp => ({
        amount: sp.amount,
        eligiblePlayerSeats: sp.eligiblePlayers,
      })),
      currentStreet: gameState.currentStreet,
      dealerSeat: gameState.dealerPosition,
      currentPlayerSeat: (gameState.isHandComplete || gameState.currentPlayerIndex === -1) ? null : gameState.currentPlayerIndex,
      currentBet: gameState.currentBet,
      minRaise: gameState.minRaise,
      smallBlind: gameState.smallBlind,
      bigBlind: gameState.bigBlind,
      isHandInProgress,
      actionTimeoutAt,
      actionTimeoutMs,
    };
  }
}
