import { Server, Socket } from 'socket.io';
import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { InternalBotSpawner } from './InternalBotSpawner.js';

interface QueuedPlayer {
  odId: string;
  odName: string;
  odAvatarUrl: string | null;
  socket: Socket;
  chips: number;
  queuedAt: number;
}

// 人間プレイヤーが待機中のとき、Bot投入するまでの待機時間
const BOT_FILL_DELAY_MS = 5000;
// Bot投入する最大数（テーブルを埋めるのに必要な数）
const BOT_FILL_COUNT = 3;

export class MatchmakingPool {
  private io: Server;
  private tableManager: TableManager;
  private queues: Map<string, QueuedPlayer[]> = new Map(); // blinds -> players
  private processingInterval: ReturnType<typeof setInterval> | null = null;
  private botSpawner: InternalBotSpawner | null = null;
  private botFillScheduled: Set<string> = new Set(); // blinds that already have bot fill scheduled
  private serverPort: number;

  constructor(io: Server, tableManager: TableManager, serverPort?: number) {
    this.io = io;
    this.tableManager = tableManager;
    this.serverPort = serverPort || parseInt(process.env.PORT || '3001', 10);

    // Start queue processing
    this.startProcessing();
  }

  /** サーバー起動後にBot自動投入を有効化 */
  public enableAutoFill(): void {
    this.botSpawner = new InternalBotSpawner(this.serverPort);
    console.log('[MatchmakingPool] Auto-fill bots enabled');
  }

  // Add player to matchmaking queue
  public async queuePlayer(
    odId: string,
    odName: string,
    odAvatarUrl: string | null,
    socket: Socket,
    chips: number,
    blinds: string
  ): Promise<void> {
    const player: QueuedPlayer = {
      odId,
      odName,
      odAvatarUrl,
      socket,
      chips,
      queuedAt: Date.now(),
    };

    // Get or create queue for this blind level
    let queue = this.queues.get(blinds);
    if (!queue) {
      queue = [];
      this.queues.set(blinds, queue);
    }

    // Remove if already in queue
    const existingIndex = queue.findIndex(p => p.odId === odId);
    if (existingIndex !== -1) {
      queue.splice(existingIndex, 1);
    }

    queue.push(player);

    // Notify player of queue position
    socket.emit('matchmaking:queued', { position: queue.length });

    // Try to seat immediately
    this.processQueue(blinds);
  }

  // Remove player from queue
  public async removeFromQueue(odId: string, blinds: string): Promise<void> {
    const queue = this.queues.get(blinds);
    if (!queue) return;

    const index = queue.findIndex(p => p.odId === odId);
    if (index !== -1) {
      queue.splice(index, 1);
    }

    // Remove from Redis
    // (Note: This is a simplified approach - in production, would need to scan and remove)
  }

  // Process queue and seat players
  private async processQueue(blinds: string): Promise<void> {
    const queue = this.queues.get(blinds);
    if (!queue || queue.length === 0) return;

    // Find or create a table with available seats
    let table = this.tableManager.findAvailableTable(blinds, true);
    if (!table) {
      table = this.tableManager.createTable(blinds, true);
    }

    // Seat players from queue
    while (queue.length > 0 && table.hasAvailableSeat()) {
      const player = queue.shift()!;

      // Check if socket is still connected
      if (!player.socket.connected) {
        continue;
      }

      const seatNumber = table.seatPlayer(
        player.odId,
        player.odName,
        player.socket,
        player.chips,
        player.odAvatarUrl
      );

      if (seatNumber !== null) {
        // Track player's table
        this.tableManager.setPlayerTable(player.odId, table.id);

        // Notify player
        player.socket.emit('matchmaking:table_assigned', { tableId: table.id });
        player.socket.emit('table:joined', { tableId: table.id, seat: seatNumber });
      } else {
        // Seating failed - re-queue the player
        console.log(`[MatchmakingPool] Seating failed for ${player.odId}, re-queuing`);
        queue.push(player);
        break; // Exit loop to avoid infinite retry
      }
    }

    // Create additional tables if needed
    if (queue.length >= 6) {
      const newTable = this.tableManager.createTable(blinds, true);
      this.processQueue(blinds); // Recursive call to fill new table
    }
  }

  // Start periodic queue processing
  private startProcessing(): void {
    this.processingInterval = setInterval(() => {
      for (const blinds of this.queues.keys()) {
        this.processQueue(blinds);
        this.maybeScheduleBotFill(blinds);
      }
    }, 500); // Check every 500ms
  }

  /**
   * 人間プレイヤーが一定時間待機中で、テーブルにプレイヤーが不足している場合、
   * Botを自動投入してゲームを開始させる
   */
  private maybeScheduleBotFill(blinds: string): void {
    if (!this.botSpawner) return;

    const queue = this.queues.get(blinds);
    if (!queue || queue.length === 0) return;

    // 既にこのブラインドにBot投入スケジュール済みならスキップ
    if (this.botFillScheduled.has(blinds)) return;

    // Bot自身がキューにいる場合はスキップ（人間プレイヤーのみ対象）
    const hasHumanWaiting = queue.some(p => !p.odId.startsWith('guest_') && !p.odName.includes('bot'));
    if (!hasHumanWaiting) return;

    // 最も長く待っているプレイヤーの待ち時間をチェック
    const now = Date.now();
    const longestWait = Math.max(...queue.map(p => now - p.queuedAt));

    if (longestWait >= BOT_FILL_DELAY_MS) {
      this.botFillScheduled.add(blinds);
      console.log(`[MatchmakingPool] Auto-filling bots for ${blinds} (waited ${Math.round(longestWait / 1000)}s)`);

      this.botSpawner.spawnBots(BOT_FILL_COUNT, blinds)
        .then(() => {
          console.log(`[MatchmakingPool] Bots spawned for ${blinds}`);
        })
        .catch(err => {
          console.error(`[MatchmakingPool] Bot spawn failed:`, err);
        })
        .finally(() => {
          // 30秒後に再度Bot投入可能にする
          setTimeout(() => {
            this.botFillScheduled.delete(blinds);
          }, 30000);
        });
    }
  }

  // Stop processing
  public stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    this.botSpawner?.disconnectAll();
  }

  // Get queue status
  public getQueueStatus(blinds: string): { count: number; avgWaitMs: number } {
    const queue = this.queues.get(blinds);
    if (!queue || queue.length === 0) {
      return { count: 0, avgWaitMs: 0 };
    }

    const now = Date.now();
    const totalWait = queue.reduce((sum, p) => sum + (now - p.queuedAt), 0);

    return {
      count: queue.length,
      avgWaitMs: totalWait / queue.length,
    };
  }
}
