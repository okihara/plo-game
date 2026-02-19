import { Socket } from 'socket.io';
import { GameState, Card } from '../../../shared/logic/types.js';
import { TABLE_CONSTANTS } from '../constants.js';
import { PlayerManager } from './PlayerManager.js';

export class SpectatorManager {
  private spectators: Set<Socket> = new Set();

  constructor(
    private readonly roomName: string,
    private readonly playerManager: PlayerManager,
  ) {}

  /** スペクテーターを追加し、切断時に自動削除する */
  addSpectator(socket: Socket): void {
    this.spectators.add(socket);
    socket.join(this.roomName);
    socket.on('disconnect', () => {
      this.spectators.delete(socket);
    });
  }

  /** 特定のスペクテーターに全員のホールカードを送信 */
  sendAllHoleCards(socket: Socket, gameState: GameState | null, isHandInProgress: boolean): void {
    if (!gameState || !isHandInProgress) return;

    const players = this.collectHoleCards(gameState);
    if (players.length > 0) {
      socket.emit('game:all_hole_cards', { players });
    }
  }

  /** 全スペクテーターに全員のホールカードをブロードキャスト */
  broadcastAllHoleCards(gameState: GameState | null): void {
    if (!gameState || this.spectators.size === 0) return;

    const players = this.collectHoleCards(gameState);
    if (players.length > 0) {
      for (const socket of this.spectators) {
        socket.emit('game:all_hole_cards', { players });
      }
    }
  }

  private collectHoleCards(gameState: GameState): { seatIndex: number; cards: Card[] }[] {
    const seats = this.playerManager.getSeats();
    const players: { seatIndex: number; cards: Card[] }[] = [];

    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      if (seats[i] && gameState.players[i].holeCards.length > 0) {
        players.push({
          seatIndex: i,
          cards: gameState.players[i].holeCards,
        });
      }
    }

    return players;
  }
}
