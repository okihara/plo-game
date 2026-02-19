import { Server, Socket } from 'socket.io';
import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';

interface QueuedPlayer {
  odId: string;
  odName: string;
  odAvatarUrl: string | null;
  socket: Socket;
  chips: number;
  queuedAt: number;
}

export class MatchmakingPool {
  private io: Server;
  private tableManager: TableManager;
  private queues: Map<string, QueuedPlayer[]> = new Map(); // blinds -> players
  private processingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(io: Server, tableManager: TableManager) {
    this.io = io;
    this.tableManager = tableManager;

    // Start queue processing
    this.startProcessing();
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

  // Remove player from queue (returns refund chip amount, 0 if not found)
  public async removeFromQueue(odId: string, blinds: string): Promise<number> {
    const queue = this.queues.get(blinds);
    if (!queue) return 0;

    const index = queue.findIndex(p => p.odId === odId);
    if (index !== -1) {
      const [removed] = queue.splice(index, 1);
      return removed.chips;
    }

    return 0;
  }

  // Remove player from ALL queues (returns total refund chip amount)
  public async removeFromAllQueues(odId: string): Promise<number> {
    let totalRefund = 0;
    for (const blinds of this.queues.keys()) {
      totalRefund += await this.removeFromQueue(odId, blinds);
    }
    return totalRefund;
  }

  // Process queue and seat players
  private async processQueue(blinds: string): Promise<void> {
    if (maintenanceService.isMaintenanceActive()) return;

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
