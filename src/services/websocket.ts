import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ClientGameState,
  OnlinePlayer
} from '../../server/src/shared/types/websocket';
import type { Card, Action } from '../logic/types';

// 本番では同一オリジン（空文字）、開発ではlocalhost:3001
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

class WebSocketService {
  private socket: TypedSocket | null = null;
  private playerId: string | null = null;

  // Event listeners
  private listeners: {
    onConnected?: (playerId: string) => void;
    onDisconnected?: () => void;
    onError?: (message: string) => void;
    onTableJoined?: (tableId: string, seat: number) => void;
    onTableLeft?: () => void;
    onGameState?: (state: ClientGameState) => void;
    onHoleCards?: (cards: Card[]) => void;
    onActionRequired?: (data: {
      playerId: string;
      validActions: { action: Action; minAmount: number; maxAmount: number }[];
      timeoutMs: number;
    }) => void;
    onActionTaken?: (data: { playerId: string; action: Action; amount: number }) => void;
    onStreetChanged?: (street: string, communityCards: Card[]) => void;
    onShowdown?: (data: {
      winners: { playerId: string; amount: number; handName: string; cards: Card[] }[];
      players: { seatIndex: number; odId: string; cards: Card[]; handName: string }[];
    }) => void;
    onHandComplete?: (winners: { playerId: string; amount: number; handName: string }[]) => void;
    onMatchmakingQueued?: (position: number) => void;
    onMatchmakingTableAssigned?: (tableId: string) => void;
    onPlayerJoined?: (seat: number, player: OnlinePlayer) => void;
    onPlayerLeft?: (seat: number, playerId: string) => void;
    onBusted?: (message: string) => void;
    onFastFoldQueued?: () => void;
    onFastFoldTableAssigned?: (tableId: string) => void;
    onSpectating?: (tableId: string) => void;
    onAllHoleCards?: (players: { seatIndex: number; cards: Card[] }[]) => void;
    onMaintenanceStatus?: (data: { isActive: boolean; message: string; activatedAt: string | null }) => void;
  } = {};

  connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        if (this.playerId) {
          resolve(this.playerId);
          return;
        }
      }

      // httpOnly cookieはdocument.cookieで読めないため、
      // サーバー側がhandshake headerからcookieを読み取る
      this.socket = io(SERVER_URL, {
        transports: ['websocket'],
        autoConnect: true,
        withCredentials: true,
      });

      let settled = false;
      const settle = () => {
        settled = true;
        clearTimeout(timeoutId);
      };

      this.socket.on('connection:established', ({ playerId }) => {
        this.playerId = playerId;
        this.listeners.onConnected?.(playerId);
        settle();
        resolve(playerId);
      });

      this.socket.on('connection:error', ({ message }) => {
        this.listeners.onError?.(message);
        settle();
        reject(new Error(message));
      });

      this.socket.on('connect_error', (err) => {
        this.listeners.onError?.(err.message);
        if (!settled) {
          settle();
          reject(new Error(err.message));
        }
      });

      this.socket.on('disconnect', () => {
        this.listeners.onDisconnected?.();
      });

      // Table events
      this.socket.on('table:joined', ({ tableId, seat }) => {
        this.listeners.onTableJoined?.(tableId, seat);
      });

      this.socket.on('table:left', () => {
        this.listeners.onTableLeft?.();
      });

      this.socket.on('table:player_joined', ({ seat, player }) => {
        this.listeners.onPlayerJoined?.(seat, player);
      });

      this.socket.on('table:player_left', ({ seat, playerId }) => {
        this.listeners.onPlayerLeft?.(seat, playerId);
      });

      this.socket.on('table:error', ({ message }) => {
        this.listeners.onError?.(message);
      });

      this.socket.on('table:busted', ({ message }) => {
        this.listeners.onBusted?.(message);
      });

      // Game events
      this.socket.on('game:state', ({ state }) => {
        this.listeners.onGameState?.(state);
      });

      this.socket.on('game:hole_cards', ({ cards }) => {
        this.listeners.onHoleCards?.(cards);
      });

      this.socket.on('game:action_required', (data) => {
        this.listeners.onActionRequired?.(data);
      });

      this.socket.on('game:action_taken', (data) => {
        this.listeners.onActionTaken?.(data);
      });

      this.socket.on('game:street_changed', ({ street, communityCards }) => {
        this.listeners.onStreetChanged?.(street, communityCards);
      });

      this.socket.on('game:showdown', ({ winners, players }) => {
        this.listeners.onShowdown?.({ winners, players });
      });

      this.socket.on('game:hand_complete', ({ winners }) => {
        this.listeners.onHandComplete?.(winners);
      });

      // Matchmaking events
      this.socket.on('matchmaking:queued', ({ position }) => {
        this.listeners.onMatchmakingQueued?.(position);
      });

      this.socket.on('matchmaking:table_assigned', ({ tableId }) => {
        this.listeners.onMatchmakingTableAssigned?.(tableId);
      });

      // Spectator events
      this.socket.on('table:spectating', ({ tableId }) => {
        this.listeners.onSpectating?.(tableId);
      });

      this.socket.on('game:all_hole_cards', ({ players }) => {
        this.listeners.onAllHoleCards?.(players);
      });

      // Maintenance events
      this.socket.on('maintenance:status', (data) => {
        this.listeners.onMaintenanceStatus?.(data);
      });

      // Timeout for initial connection
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.playerId = null;
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  // Set event listeners
  setListeners(listeners: typeof this.listeners): void {
    this.listeners = { ...this.listeners, ...listeners };
  }

  // Table actions
  joinTable(tableId: string, buyIn: number): void {
    this.socket?.emit('table:join', { tableId, buyIn });
  }

  leaveTable(): void {
    this.socket?.emit('table:leave');
  }

  sitDown(seatNumber: number): void {
    this.socket?.emit('table:sit', { seatNumber });
  }

  standUp(): void {
    this.socket?.emit('table:stand');
  }

  // Game actions
  sendAction(action: Action, amount?: number): void {
    this.socket?.emit('game:action', { action, amount });
  }

  // Matchmaking pool
  joinMatchmaking(blinds: string): void {
    this.socket?.emit('matchmaking:join', { blinds });
  }

  leaveMatchmaking(): void {
    this.socket?.emit('matchmaking:leave');
  }

  // Spectator
  spectateTable(tableId: string): void {
    this.socket?.emit('table:spectate', { tableId });
  }
}

// Singleton instance
export const wsService = new WebSocketService();
