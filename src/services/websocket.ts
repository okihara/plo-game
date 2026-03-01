import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ClientGameState,
} from '@plo/shared';
import type { Card, Action } from '../logic/types';

// 本番では同一オリジン（空文字）、開発ではlocalhost:3001
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

const wsLog = (event: string, ...args: unknown[]) => {
  const t = new Date();
  const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}.${String(t.getMilliseconds()).padStart(3, '0')}`;
  console.log(`[WS ${ts}] ${event}`, ...args);
};

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

class WebSocketService {
  private socket: TypedSocket | null = null;
  private playerId: string | null = null;
  private connectionTimeoutId: ReturnType<typeof setTimeout> | null = null;

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
    onShowdown?: (data: {
      winners: { playerId: string; amount: number; handName: string; cards: Card[] }[];
      players: { seatIndex: number; odId: string; cards: Card[]; handName: string }[];
    }) => void;
    onHandComplete?: (winners: { playerId: string; amount: number; handName: string }[]) => void;
    onTableChanged?: (tableId: string, seat: number) => void;
    onBusted?: (message: string) => void;
    onSpectating?: (tableId: string) => void;
    onAllHoleCards?: (players: { seatIndex: number; cards: Card[] }[]) => void;
    onMaintenanceStatus?: (data: { isActive: boolean; message: string; activatedAt: string | null }) => void;
    onAnnouncementStatus?: (data: { isActive: boolean; message: string }) => void;
    onPrivateCreated?: (data: { tableId: string; inviteCode: string }) => void;
  } = {};

  connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        if (this.playerId) {
          resolve(this.playerId);
          return;
        }
      }

      // 前回の接続タイムアウトが残っていたらクリア
      if (this.connectionTimeoutId) {
        clearTimeout(this.connectionTimeoutId);
        this.connectionTimeoutId = null;
      }

      // 前回のソケットが残っていたら切断してから新規作成
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
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
        if (this.connectionTimeoutId) {
          clearTimeout(this.connectionTimeoutId);
          this.connectionTimeoutId = null;
        }
      };

      this.socket.on('connection:established', ({ playerId }) => {
        wsLog('connection:established', { playerId });
        this.playerId = playerId;
        this.listeners.onConnected?.(playerId);
        settle();
        resolve(playerId);
      });

      this.socket.on('connect_error', (err) => {
        wsLog('connect_error', err.message);
        this.listeners.onError?.(err.message);
        if (!settled) {
          settle();
          reject(new Error(err.message));
        }
      });

      this.socket.on('disconnect', () => {
        wsLog('disconnect');
        this.listeners.onDisconnected?.();
      });

      // Table events
      this.socket.on('table:joined', ({ tableId, seat }) => {
        wsLog('table:joined', { tableId, seat });
        this.listeners.onTableJoined?.(tableId, seat);
      });

      this.socket.on('table:left', () => {
        wsLog('table:left');
        this.listeners.onTableLeft?.();
      });

      this.socket.on('table:error', ({ message }) => {
        wsLog('table:error', { message });
        this.listeners.onError?.(message);
      });

      this.socket.on('table:change', ({ tableId, seat }) => {
        wsLog('table:change', { tableId, seat });
        this.listeners.onTableChanged?.(tableId, seat);
      });

      this.socket.on('table:busted', ({ message }) => {
        wsLog('table:busted', { message });
        this.listeners.onBusted?.(message);
      });

      // Game events
      this.socket.on('game:state', ({ state }) => {
        wsLog('game:state', { street: state.currentStreet, pot: state.pot });
        this.listeners.onGameState?.(state);
      });

      this.socket.on('game:hole_cards', ({ cards }) => {
        wsLog('game:hole_cards', { cards });
        this.listeners.onHoleCards?.(cards);
      });

      this.socket.on('game:action_required', (data) => {
        wsLog('game:action_required', { playerId: data.playerId, validActions: data.validActions });
        this.listeners.onActionRequired?.(data);
      });

      this.socket.on('game:action_taken', (data) => {
        wsLog('game:action_taken', data);
        this.listeners.onActionTaken?.(data);
      });

      this.socket.on('game:showdown', ({ winners, players }) => {
        wsLog('game:showdown', { winners, players });
        this.listeners.onShowdown?.({ winners, players });
      });

      this.socket.on('game:hand_complete', ({ winners }) => {
        wsLog('game:hand_complete', { winners });
        this.listeners.onHandComplete?.(winners);
      });

      // Spectator events
      this.socket.on('table:spectating', ({ tableId }) => {
        wsLog('table:spectating', { tableId });
        this.listeners.onSpectating?.(tableId);
      });

      this.socket.on('game:all_hole_cards', ({ players }) => {
        wsLog('game:all_hole_cards', { players });
        this.listeners.onAllHoleCards?.(players);
      });

      // Maintenance events
      this.socket.on('maintenance:status', (data) => {
        wsLog('maintenance:status', data);
        this.listeners.onMaintenanceStatus?.(data);
      });

      // Announcement events
      this.socket.on('announcement:status', (data) => {
        wsLog('announcement:status', data);
        this.listeners.onAnnouncementStatus?.(data);
      });

      // Private table events
      this.socket.on('private:created', (data) => {
        wsLog('private:created', data);
        this.listeners.onPrivateCreated?.(data);
      });

      // Timeout for initial connection
      this.connectionTimeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.connectionTimeoutId = null;
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  disconnect(): void {
    if (this.connectionTimeoutId) {
      clearTimeout(this.connectionTimeoutId);
      this.connectionTimeoutId = null;
    }
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
  leaveTable(): void {
    this.socket?.emit('table:leave');
  }

  // Game actions
  sendAction(action: Action, amount?: number): void {
    this.socket?.emit('game:action', { action, amount });
  }

  sendFastFold(): void {
    (this.socket as any)?.emit('game:fast_fold');
  }

  // Matchmaking pool
  joinMatchmaking(blinds: string, isFastFold?: boolean): void {
    this.socket?.emit('matchmaking:join', { blinds, isFastFold });
  }

  leaveMatchmaking(): void {
    this.socket?.emit('matchmaking:leave');
  }

  // Spectator
  spectateTable(tableId: string): void {
    this.socket?.emit('table:spectate', { tableId });
  }

  // Private table
  createPrivateTable(blinds: string): void {
    this.socket?.emit('private:create', { blinds });
  }

  joinPrivateTable(inviteCode: string): void {
    this.socket?.emit('private:join', { inviteCode });
  }

}

// Singleton instance
export const wsService = new WebSocketService();
