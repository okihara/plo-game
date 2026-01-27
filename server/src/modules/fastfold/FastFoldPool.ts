import { Server, Socket } from 'socket.io';
import { redis, REDIS_KEYS } from '../../config/redis.js';
import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';

interface QueuedPlayer {
  odId: string;
  odName: string;
  odAvatarUrl: string | null;
  socket: Socket;
  chips: number;
  queuedAt: number;
  isBot: boolean;
}

export class FastFoldPool {
  private io: Server;
  private tableManager: TableManager;
  private queues: Map<string, QueuedPlayer[]> = new Map(); // blinds -> players
  private processingInterval: NodeJS.Timer | null = null;

  constructor(io: Server, tableManager: TableManager) {
    this.io = io;
    this.tableManager = tableManager;

    // Start queue processing
    this.startProcessing();
  }

  // Add player to fast fold queue
  public async queuePlayer(
    odId: string,
    odName: string,
    odAvatarUrl: string | null,
    socket: Socket,
    chips: number,
    blinds: string,
    isBot: boolean = false
  ): Promise<void> {
    const player: QueuedPlayer = {
      odId,
      odName,
      odAvatarUrl,
      socket,
      chips,
      queuedAt: Date.now(),
      isBot,
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

    // Also store in Redis for persistence
    await redis.zadd(
      REDIS_KEYS.fastfoldQueue(blinds),
      player.queuedAt,
      JSON.stringify({ odId, odName, odAvatarUrl, chips })
    );

    // Notify player of queue position
    socket.emit('fastfold:queued', { position: queue.length });

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

    // Find or create a fast fold table with available seats
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
        player.odAvatarUrl,
        player.socket,
        player.chips,
        undefined, // preferredSeat
        player.isBot
      );

      if (seatNumber !== null) {
        // Track player's table
        this.tableManager.setPlayerTable(player.odId, table.id);

        // Notify player
        player.socket.emit('fastfold:table_assigned', { tableId: table.id });
        player.socket.emit('table:joined', { tableId: table.id, seat: seatNumber });

        // Remove from Redis
        await redis.zrem(REDIS_KEYS.fastfoldQueue(blinds), JSON.stringify({
          odId: player.odId,
          odName: player.odName,
          odAvatarUrl: player.odAvatarUrl,
          chips: player.chips,
        }));
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
      }
    }, 500); // Check every 500ms
  }

  // Stop processing
  public stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
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
