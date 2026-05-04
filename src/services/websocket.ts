import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ClientGameState,
  ClientTournamentState,
  TournamentEliminationInfo,
  TournamentPlayerEliminatedData,
  TournamentCompletedData,
  BlindLevel,
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

/** リスナーオブジェクトの型定義 */
export type WsListeners = {
  onConnected?: (playerId: string) => void;
  onDisconnected?: (reason: string) => void;
  onError?: (message: string) => void;
  onTableJoined?: (tableId: string, seat: number) => void;
  onTableLeft?: () => void;
  onGameState?: (state: ClientGameState) => void;
  onHoleCards?: (data: { cards: Card[]; seatIndex?: number }) => void;
  onActionTaken?: (data: { playerId: string; action: Action; amount: number; drawCount?: number }) => void;
  onShowdown?: (data: {
    winners: { playerId: string; amount: number; handName: string; cards: Card[]; hiLoType?: 'high' | 'low' | 'scoop' }[];
    players: { seatIndex: number; odId: string; cards: Card[]; handName: string }[];
  }) => void;
  onHandComplete?: (winners: { playerId: string; amount: number; handName: string; hiLoType?: 'high' | 'low' | 'scoop' }[]) => void;
  onTableChanged?: (tableId: string, seat: number) => void;
  onBusted?: (message: string) => void;
  onMaintenanceStatus?: (data: { isActive: boolean; message: string; activatedAt: string | null }) => void;
  onAnnouncementStatus?: (data: { isActive: boolean; message: string }) => void;
  onPrivateCreated?: (data: { tableId: string; inviteCode: string }) => void;
  onDisplaced?: () => void;
  onSpectateJoined?: (tableId: string) => void;
  onSpectateLeft?: () => void;
  // Tournament events
  onTournamentUnregistered?: (data: { tournamentId: string }) => void;
  onTournamentState?: (state: ClientTournamentState) => void;
  onTournamentTableAssigned?: (data: { tableId: string; tournamentId: string }) => void;
  onTournamentTableMove?: (data: { fromTableId: string; toTableId: string; reason: string }) => void;
  onTournamentBlindChange?: (data: { level: BlindLevel; nextLevel: BlindLevel | null; nextLevelAt: number }) => void;
  onTournamentPlayerEliminated?: (data: TournamentPlayerEliminatedData) => void;
  onTournamentEliminated?: (data: TournamentEliminationInfo) => void;
  onTournamentFinalTable?: (data: { tableId: string }) => void;
  onTournamentCompleted?: (data: TournamentCompletedData) => void;
  onTournamentError?: (data: { message: string }) => void;
  onTournamentCancelled?: (data: { tournamentId: string }) => void;
};

class WebSocketService {
  private socket: TypedSocket | null = null;
  private playerId: string | null = null;
  private connectionTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastConnectionMode: 'play' | 'spectate' = 'play';

  /**
   * 複数コンポーネントが共存できるサブスクライバーマップ
   * key: サブスクライバーID（"game", "tournament" 等）
   * value: そのサブスクライバーのリスナーオブジェクト
   */
  private subscribers: Map<string, WsListeners> = new Map();

  /** 全サブスクライバーの指定イベントハンドラを呼び出す */
  private emit<K extends keyof WsListeners>(event: K, ...args: Parameters<NonNullable<WsListeners[K]>>): void {
    for (const listeners of this.subscribers.values()) {
      const handler = listeners[event];
      if (handler) {
        (handler as (...a: any[]) => void)(...args);
      }
    }
  }

  connect(options?: { connectionMode?: 'play' | 'spectate' }): Promise<string> {
    return new Promise((resolve, reject) => {
      const connectionMode = options?.connectionMode ?? 'play';

      if (this.socket?.connected) {
        if (this.lastConnectionMode === connectionMode && this.playerId) {
          resolve(this.playerId);
          return;
        }
        this.socket.disconnect();
        this.socket = null;
        this.playerId = null;
      }
      this.lastConnectionMode = connectionMode;

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
        auth: { connectionMode },
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
        this.emit('onConnected', playerId);
        settle();
        resolve(playerId);
      });

      this.socket.on('connect_error', (err) => {
        wsLog('connect_error', err.message);
        this.emit('onError', err.message);
        if (!settled) {
          settle();
          reject(new Error(err.message));
        }
      });

      this.socket.on('disconnect', (reason) => {
        wsLog('disconnect', reason);
        this.emit('onDisconnected', reason);
      });

      this.socket.on('connection:displaced', ({ reason }) => {
        wsLog('connection:displaced', { reason });
        this.emit('onDisplaced');
        // サーバーからの強制切断（io server disconnect）では自動再接続されないが、
        // 念のためsocket参照をクリーンアップ
        this.socket?.disconnect();
        this.socket = null;
        this.playerId = null;
      });

      // Table events
      this.socket.on('table:joined', ({ tableId, seat }) => {
        wsLog('table:joined', { tableId, seat });
        this.emit('onTableJoined', tableId, seat);
      });

      this.socket.on('table:left', () => {
        wsLog('table:left');
        this.emit('onTableLeft');
      });

      this.socket.on('table:error', ({ message }) => {
        wsLog('table:error', { message });
        this.emit('onError', message);
      });

      this.socket.on('table:change', ({ tableId, seat }) => {
        wsLog('table:change', { tableId, seat });
        this.emit('onTableChanged', tableId, seat);
      });

      this.socket.on('table:busted', ({ message }) => {
        wsLog('table:busted', { message });
        this.emit('onBusted', message);
      });

      // Game events
      this.socket.on('game:state', ({ state }) => {
        wsLog('game:state', state);
        this.emit('onGameState', state);
      });

      this.socket.on('game:hole_cards', (data) => {
        wsLog('game:hole_cards', data);
        this.emit('onHoleCards', data);
      });

      this.socket.on('game:action_taken', (data) => {
        wsLog('game:action_taken', data);
        this.emit('onActionTaken', data);
      });

      this.socket.on('game:showdown', ({ winners, players }) => {
        wsLog('game:showdown', { winners, players });
        this.emit('onShowdown', { winners, players });
      });

      this.socket.on('game:hand_complete', ({ winners }) => {
        wsLog('game:hand_complete', { winners });
        this.emit('onHandComplete', winners);
      });

      // Maintenance events
      this.socket.on('maintenance:status', (data) => {
        wsLog('maintenance:status', data);
        this.emit('onMaintenanceStatus', data);
      });

      // Announcement events
      this.socket.on('announcement:status', (data) => {
        wsLog('announcement:status', data);
        this.emit('onAnnouncementStatus', data);
      });

      // Private table events
      this.socket.on('private:created', (data) => {
        wsLog('private:created', data);
        this.emit('onPrivateCreated', data);
      });

      this.socket.on('table:spectate_joined', (data) => {
        wsLog('table:spectate_joined', data);
        this.emit('onSpectateJoined', data.tableId);
      });

      this.socket.on('table:spectate_left', () => {
        wsLog('table:spectate_left');
        this.emit('onSpectateLeft');
      });

      // Tournament events
      this.socket.on('tournament:unregistered', (data) => {
        wsLog('tournament:unregistered', data);
        this.emit('onTournamentUnregistered', data);
      });
      this.socket.on('tournament:state', (data) => {
        wsLog('tournament:state', data);
        this.emit('onTournamentState', data);
      });
      this.socket.on('tournament:table_assigned', (data) => {
        wsLog('tournament:table_assigned', data);
        this.emit('onTournamentTableAssigned', data);
      });
      this.socket.on('tournament:table_move', (data) => {
        wsLog('tournament:table_move', data);
        this.emit('onTournamentTableMove', data);
      });
      this.socket.on('tournament:blind_change', (data) => {
        wsLog('tournament:blind_change', data);
        this.emit('onTournamentBlindChange', data);
      });
      this.socket.on('tournament:player_eliminated', (data) => {
        wsLog('tournament:player_eliminated', data);
        this.emit('onTournamentPlayerEliminated', data);
      });
      this.socket.on('tournament:eliminated', (data) => {
        wsLog('tournament:eliminated', data);
        this.emit('onTournamentEliminated', data);
      });
      this.socket.on('tournament:final_table', (data) => {
        wsLog('tournament:final_table', data);
        this.emit('onTournamentFinalTable', data);
      });
      this.socket.on('tournament:completed', (data) => {
        wsLog('tournament:completed', data);
        this.emit('onTournamentCompleted', data);
      });
      this.socket.on('tournament:error', (data) => {
        wsLog('tournament:error', data);
        this.emit('onTournamentError', data);
      });
      this.socket.on('tournament:cancelled', (data) => {
        wsLog('tournament:cancelled', data);
        this.emit('onTournamentCancelled', data);
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
    this.lastConnectionMode = 'play';
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  /**
   * リスナーを登録する（複数コンポーネントが共存可能）
   * @param key サブスクライバーID（"game", "tournament" 等）
   * @param listeners イベントリスナーオブジェクト
   */
  addListeners(key: string, listeners: WsListeners): void {
    this.subscribers.set(key, listeners);
  }

  /**
   * リスナーを解除する
   * @param key 登録時に使ったサブスクライバーID
   */
  removeListeners(key: string): void {
    this.subscribers.delete(key);
  }

  /**
   * @deprecated addListeners/removeListeners を使用してください
   */
  setListeners(listeners: WsListeners): void {
    // 後方互換: 'default' キーで登録
    this.subscribers.set('default', listeners);
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
    this.socket?.emit('game:fast_fold');
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

  joinSpectate(tableId: string, inviteCode?: string): void {
    this.socket?.emit('table:spectate_join', { tableId, inviteCode });
  }

  leaveSpectate(): void {
    this.socket?.emit('table:spectate_leave');
  }

  // Tournament actions
  unregisterTournament(tournamentId: string): void {
    this.socket?.emit('tournament:unregister', { tournamentId });
  }

  requestTournamentState(tournamentId: string): void {
    this.socket?.emit('tournament:request_state', { tournamentId });
  }

}

// Singleton instance
export const wsService = new WebSocketService();
