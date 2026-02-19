import { GameState } from '../../../shared/logic/types.js';
import { DebugState, AdminSeat } from '../types.js';
import { PlayerManager } from './PlayerManager.js';
import { BroadcastService } from './BroadcastService.js';
import { ActionController } from './ActionController.js';

export class AdminHelper {
  constructor(
    private readonly playerManager: PlayerManager,
    private readonly broadcast: BroadcastService,
    private readonly actionController: ActionController,
  ) {}

  /** ダッシュボード用：ゲーム状態詳細を取得 */
  getDebugState(gameState: GameState | null, isHandInProgress: boolean): DebugState {
    return {
      messageLog: this.broadcast.getMessageLog(),
      pendingAction: this.actionController.getPendingAction(),
      gamePhase: isHandInProgress
        ? (gameState?.currentStreet ?? 'unknown')
        : 'waiting',
    };
  }

  /** 管理ダッシュボード用: 各シートの詳細情報を返す */
  getAdminSeats(gameState: GameState | null): (AdminSeat | null)[] {
    const seats = this.playerManager.getSeats();
    return seats.map((seat, i) => {
      if (!seat) return null;
      const player = gameState?.players[i] ?? null;
      return {
        seatNumber: i,
        odId: seat.odId,
        odName: seat.odName,
        chips: player?.chips ?? seat.chips,
        isConnected: seat.socket?.connected ?? false,
        folded: player?.folded ?? false,
        isAllIn: player?.isAllIn ?? false,
        position: player?.position ?? '',
        currentBet: player?.currentBet ?? 0,
        totalBetThisRound: player?.totalBetThisRound ?? 0,
        hasActed: player?.hasActed ?? false,
        isSittingOut: player?.isSittingOut ?? false,
        buyIn: seat.buyIn,
        waitingForNextHand: seat.waitingForNextHand,
      };
    });
  }

  /** デバッグ用: プレイヤーのチップを強制的に変更する */
  debugSetChips(odId: string, chips: number, gameState: GameState | null): boolean {
    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return false;

    this.playerManager.updateChips(seatIndex, chips);
    if (gameState && gameState.players[seatIndex]) {
      gameState.players[seatIndex].chips = chips;
    }

    return true;
  }
}
