// WebSocket通信ラッパー

import { Server, Socket } from 'socket.io';
import { MessageLog } from '../types.js';
import { TABLE_CONSTANTS } from '../constants.js';

export class BroadcastService {
  private messageLog: MessageLog[] = [];

  constructor(
    private io: Server,
    private roomName: string
  ) {}

  // ルームにブロードキャスト
  emitToRoom<T>(event: string, data: T): void {
    this.io.to(this.roomName).emit(event, data);
    this.logMessage(event, 'all', data);
  }

  // 特定ソケットに送信
  emitToSocket<T>(socket: Socket, playerId: string, event: string, data: T): void {
    socket.emit(event, data);
    this.logMessage(event, playerId, data);
  }

  // メッセージログ記録
  private logMessage(event: string, target: 'all' | string, data: unknown): void {
    this.messageLog.push({
      timestamp: Date.now(),
      event,
      target,
      data,
    });
    // 古いログを削除
    if (this.messageLog.length > TABLE_CONSTANTS.MAX_MESSAGE_LOG) {
      this.messageLog.shift();
    }
  }

  getMessageLog(): MessageLog[] {
    return this.messageLog;
  }
}
