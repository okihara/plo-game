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
    onDisconnected?: (reason: string) => void;
    onError?: (message: string) => void;
    onTableJoined?: (tableId: string, seat: number) => void;
    onTableLeft?: () => void;
    onGameState?: (state: ClientGameState) => void;
    onHoleCards?: (cards: Card[]) => void;
    onActionTaken?: (data: { playerId: string; action: Action; amount: number; drawCount?: number }) => void;
    onShowdown?: (data: {
      winners: { playerId: string; amount: number; handName: string; cards: Card[] }[];
      players: { seatIndex: number; odId: string; cards: Card[]; handName: string }[];
    }) => void;
    onHandComplete?: (winners: { playerId: string; amount: number; handName: string }[]) => void;
    onTableChanged?: (tableId: string, seat: number) => void;
    onBusted?: (message: string) => void;
    onMaintenanceStatus?: (data: { isActive: boolean; message: string; activatedAt: string | null }) => void;
    onAnnouncementStatus?: (data: { isActive: boolean; message: string }) => void;
    onPrivateCreated?: (data: { tableId: string; inviteCode: string }) => void;
    onDisplaced?: () => void;
    // Tournament events
    onTournamentList?: (data: { tournaments: any[] }) => void;
    onTournamentRegistered?: (data: { tournamentId: string }) => void;
    onTournamentUnregistered?: (data: { tournamentId: string }) => void;
    onTournamentState?: (state: any) => void;
    onTournamentTableAssigned?: (data: { tableId: string; tournamentId: string }) => void;
    onTournamentTableMove?: (data: { fromTableId: string; toTableId: string; reason: string }) => void;
    onTournamentBlindChange?: (data: { level: any; nextLevel: any | null; nextLevelAt: number }) => void;
    onTournamentPlayerEliminated?: (data: { odId: string; odName: string; position: number; playersRemaining: number }) => void;
    onTournamentEliminated?: (data: { position: number; totalPlayers: number; prizeAmount: number }) => void;
    onTournamentFinalTable?: (data: { tableId: string }) => void;
    onTournamentCompleted?: (data: { results: any[]; totalPlayers: number; prizePool: number }) => void;
    onTournamentError?: (data: { message: string }) => void;
    onTournamentCancelled?: (data: { tournamentId: string }) => void;
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
        reconnection: false,
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

      this.socket.on('disconnect', (reason) => {
        wsLog('disconnect', reason);
        this.listeners.onDisconnected?.(reason);
      });

      this.socket.on('connection:displaced', ({ reason }) => {
        wsLog('connection:displaced', { reason });
        this.listeners.onDisplaced?.();
        // サーバーからの強制切断（io server disconnect）では自動再接続されないが、
        // 念のためsocket参照をクリーンアップ
        this.socket?.disconnect();
        this.socket = null;
        this.playerId = null;
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
        wsLog('game:state', state);
        this.listeners.onGameState?.(state);
      });

      this.socket.on('game:hole_cards', ({ cards }) => {
        wsLog('game:hole_cards', { cards });
        this.listeners.onHoleCards?.(cards);
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

      // Tournament events
      (this.socket as any).on('tournament:list', (data: any) => {
        wsLog('tournament:list', data);
        this.listeners.onTournamentList?.(data);
      });
      (this.socket as any).on('tournament:registered', (data: any) => {
        wsLog('tournament:registered', data);
        this.listeners.onTournamentRegistered?.(data);
      });
      (this.socket as any).on('tournament:unregistered', (data: any) => {
        wsLog('tournament:unregistered', data);
        this.listeners.onTournamentUnregistered?.(data);
      });
      (this.socket as any).on('tournament:state', (data: any) => {
        wsLog('tournament:state', data);
        this.listeners.onTournamentState?.(data);
      });
      (this.socket as any).on('tournament:table_assigned', (data: any) => {
        wsLog('tournament:table_assigned', data);
        this.listeners.onTournamentTableAssigned?.(data);
      });
      (this.socket as any).on('tournament:table_move', (data: any) => {
        wsLog('tournament:table_move', data);
        this.listeners.onTournamentTableMove?.(data);
      });
      (this.socket as any).on('tournament:blind_change', (data: any) => {
        wsLog('tournament:blind_change', data);
        this.listeners.onTournamentBlindChange?.(data);
      });
      (this.socket as any).on('tournament:player_eliminated', (data: any) => {
        wsLog('tournament:player_eliminated', data);
        this.listeners.onTournamentPlayerEliminated?.(data);
      });
      (this.socket as any).on('tournament:eliminated', (data: any) => {
        wsLog('tournament:eliminated', data);
        this.listeners.onTournamentEliminated?.(data);
      });
      (this.socket as any).on('tournament:final_table', (data: any) => {
        wsLog('tournament:final_table', data);
        this.listeners.onTournamentFinalTable?.(data);
      });
      (this.socket as any).on('tournament:completed', (data: any) => {
        wsLog('tournament:completed', data);
        this.listeners.onTournamentCompleted?.(data);
      });
      (this.socket as any).on('tournament:error', (data: any) => {
        wsLog('tournament:error', data);
        this.listeners.onTournamentError?.(data);
      });
      (this.socket as any).on('tournament:cancelled', (data: any) => {
        wsLog('tournament:cancelled', data);
        this.listeners.onTournamentCancelled?.(data);
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
  sendAction(action: Action, amount?: number, discardIndices?: number[]): void {
    this.socket?.emit('game:action', { action, amount, discardIndices });
  }

  sendFastFold(): void {
    (this.socket as any)?.emit('game:fast_fold');
  }

  // Matchmaking pool
  joinMatchmaking(blinds: string, isFastFold?: boolean, variant?: string): void {
    this.socket?.emit('matchmaking:join', { blinds, isFastFold, variant });
  }

  leaveMatchmaking(): void {
    this.socket?.emit('matchmaking:leave');
  }

  // Private table
  createPrivateTable(blinds: string): void {
    this.socket?.emit('private:create', { blinds });
  }

  joinPrivateTable(inviteCode: string): void {
    this.socket?.emit('private:join', { inviteCode });
  }

  // Tournament actions
  listTournaments(): void {
    (this.socket as any)?.emit('tournament:list');
  }

  registerTournament(tournamentId: string): void {
    (this.socket as any)?.emit('tournament:register', { tournamentId });
  }

  unregisterTournament(tournamentId: string): void {
    (this.socket as any)?.emit('tournament:unregister', { tournamentId });
  }

  reenterTournament(tournamentId: string): void {
    (this.socket as any)?.emit('tournament:reenter', { tournamentId });
  }

}

// Singleton instance
export const wsService = new WebSocketService();
