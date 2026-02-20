import { Server, Socket } from 'socket.io';
import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';
import { deductBuyIn, cashOutPlayer } from '../auth/bankroll.js';

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
      console.warn(`[MatchmakingPool] Player ${odId} already in queue for ${blinds}, replacing (prev chips=${queue[existingIndex].chips}, new chips=${chips})`);
      queue.splice(existingIndex, 1);
    }

    queue.push(player);

    // Notify player of queue position
    socket.emit('matchmaking:queued', { position: queue.length });

    // Try to seat immediately
    this.processQueue(blinds);
  }

  // Remove player from queue
  public removeFromQueue(odId: string, blinds: string): void {
    const queue = this.queues.get(blinds);
    if (!queue) return;

    const index = queue.findIndex(p => p.odId === odId);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  // Remove player from ALL queues
  public removeFromAllQueues(odId: string): void {
    for (const blinds of this.queues.keys()) {
      this.removeFromQueue(odId, blinds);
    }
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
        console.warn(`[MatchmakingPool] Skipping disconnected player ${player.odId} (blinds=${blinds})`);
        continue;
      }

      // Deduct buy-in right before seating
      const deducted = await deductBuyIn(player.odId, player.chips);
      if (!deducted) {
        player.socket.emit('table:error', { message: 'Insufficient balance for buy-in' });
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
        this.tableManager.setPlayerTable(player.odId, table.id);
        player.socket.emit('matchmaking:table_assigned', { tableId: table.id });
        table.triggerMaybeStartHand();
      } else {
        // Seating failed - refund and re-queue the player
        console.warn(`[MatchmakingPool] Seating failed for ${player.odId}, refunding and re-queuing`);
        await cashOutPlayer(player.odId, player.chips);
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
        this.processQueue(blinds).catch(err => {
          console.error(`[MatchmakingPool] processQueue error for blinds=${blinds}:`, err);
        });
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
