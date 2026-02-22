// プレイヤー着席/離席管理

import { Socket } from 'socket.io';
import { SeatInfo } from '../types.js';
import { TABLE_CONSTANTS } from '../constants.js';

export interface SeatPlayerParams {
  odId: string;
  odName: string;
  socket: Socket;
  buyIn: number;
  avatarUrl?: string | null;
  preferredSeat?: number;
  isHandInProgress: boolean;
  nameMasked?: boolean;
}

export class PlayerManager {
  private seats: (SeatInfo | null)[] = Array(TABLE_CONSTANTS.MAX_PLAYERS).fill(null);

  getSeat(index: number): SeatInfo | null {
    return this.seats[index];
  }

  getSeats(): (SeatInfo | null)[] {
    return this.seats;
  }

  findSeatByOdId(odId: string): number {
    return this.seats.findIndex(s => s?.odId === odId);
  }

  /**
   * プレイヤーを着席させる
   */
  seatPlayer(params: SeatPlayerParams): number | null {
    const { odId, odName, socket, buyIn, avatarUrl, preferredSeat, isHandInProgress, nameMasked } = params;

    // 空き席を探す
    let seatIndex = preferredSeat ?? -1;
    if (seatIndex >= 0 && seatIndex < TABLE_CONSTANTS.MAX_PLAYERS && this.seats[seatIndex] === null) {
      // 希望席が空いている
    } else {
      seatIndex = this.seats.findIndex(s => s === null);
    }

    if (seatIndex === -1) return null;

    // ランダムなアバターIDを割り当て
    const avatarId = Math.floor(Math.random() * TABLE_CONSTANTS.DEFAULT_AVATAR_COUNT);

    this.seats[seatIndex] = {
      odId,
      odName,
      avatarId,
      avatarUrl: avatarUrl ?? null,
      socket,
      chips: buyIn,
      buyIn,
      waitingForNextHand: isHandInProgress, // ハンド中に着席した場合は次のハンドから参加
      nameMasked: nameMasked ?? true,
    };

    return seatIndex;
  }

  /**
   * プレイヤーを離席させる
   */
  unseatPlayer(seatIndex: number): SeatInfo | null {
    const seat = this.seats[seatIndex];
    this.seats[seatIndex] = null;
    return seat;
  }

  /**
   * FastFold移動済みマーク（席情報は残してソケット参照を切る）
   */
  markLeftForFastFold(seatIndex: number): void {
    const seat = this.seats[seatIndex];
    if (seat) {
      seat.leftForFastFold = true;
      seat.socket = null;
    }
  }

  /**
   * 新しいハンド開始時にwaitingForNextHandフラグをクリア
   */
  clearWaitingFlags(): void {
    for (const seat of this.seats) {
      if (seat) {
        seat.waitingForNextHand = false;
      }
    }
  }

  /**
   * プレイヤーのチップを更新
   */
  updateChips(seatIndex: number, chips: number): void {
    const seat = this.seats[seatIndex];
    if (seat) {
      seat.chips = chips;
    }
  }

  /**
   * 着席プレイヤー数を取得
   */
  getPlayerCount(): number {
    return this.seats.filter(s => s !== null && !s.leftForFastFold).length;
  }

  /**
   * 接続中のプレイヤー数を取得
   */
  getConnectedPlayerCount(): number {
    return this.seats.filter(s => s?.socket?.connected).length;
  }

  /**
   * 空席があるかどうか
   */
  hasAvailableSeat(): boolean {
    return this.seats.some(s => s === null);
  }

  /**
   * 全シートをイテレート
   */
  forEachSeat(callback: (seat: SeatInfo | null, index: number) => void): void {
    this.seats.forEach((seat, index) => callback(seat, index));
  }
}
