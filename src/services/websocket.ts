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
import { Sentry, sentryEnabled } from '../lib/sentry';

// 本番では同一オリジン（空文字）、開発ではlocalhost:3001
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

// socket.io-client が auto-reconnect を試みる disconnect reason の集合。
// 'io server disconnect' / 'io client disconnect' はライブラリ側で auto-reconnect しないので除外。
// 参考: https://socket.io/docs/v4/client-socket-instance/#disconnect
const AUTO_RECONNECT_DISCONNECT_REASONS = new Set<string>([
  'transport close',
  'transport error',
  'ping timeout',
  'parse error',
]);

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
  /** auto-reconnect を試みる disconnect の直後に呼ばれる。UI は「再接続中」を出す想定。 */
  onReconnecting?: (reason: string) => void;
  /** reconnectionAttempts を使い切って再接続を諦めた時に呼ばれる。UI はエラーダイアログに切り替える。 */
  onReconnectFailed?: () => void;
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
      //
      // 自動再接続: Railway の 15 分接続上限、モバイルのスリープ復帰、
      // 一時的なネットワーク断などで切れた際に socket.io-client が再接続を試みる。
      // Cookie ベース認証なので再接続時も同じ odId で繋がり、
      // サーバー側の io.on('connection') がトーナメントなら handleReconnect で席復帰する。
      // 'io server disconnect' / 'io client disconnect' では auto-reconnect は走らない（標準仕様）。
      // reconnectionAttempts: 1〜5秒の指数バックオフで 10 回 ≈ 約 30 秒の試行。
      // 長く粘っても繋がらないなら諦めてエラーダイアログに切り替える。
      this.socket = io(SERVER_URL, {
        transports: ['websocket'],
        autoConnect: true,
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 6,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
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
        // 初回接続失敗時のみ Sentry / onError に流す。
        // 再接続試行中の連続失敗は disconnect イベントで既に捕捉済みなので、ここではログのみ。
        if (!settled) {
          if (sentryEnabled) {
            Sentry.withScope((scope) => {
              scope.setTag('source', 'socket.io');
              scope.setTag('socket.phase', 'connect_error');
              Sentry.captureException(err);
            });
          }
          this.emit('onError', err.message);
          settle();
          reject(new Error(err.message));
        }
      });

      // 再接続のライフサイクルを記録（manager レベルのイベント）
      this.socket.io.on('reconnect_attempt', (attempt) => {
        wsLog('reconnect_attempt', attempt);
      });
      this.socket.io.on('reconnect', (attempt) => {
        wsLog('reconnect', attempt);
      });
      this.socket.io.on('reconnect_failed', () => {
        wsLog('reconnect_failed', 'giving up after max attempts');
        // auto-reconnect が走った末に復旧できなかったケースだけを Sentry に送る。
        // 一時的な切断（即座に再接続成功）は本番運用上ノイズなので報告しない。
        if (sentryEnabled) {
          Sentry.withScope((scope) => {
            scope.setTag('source', 'socket.io');
            scope.setTag('socket.phase', 'reconnect_failed');
            Sentry.captureMessage('Socket reconnection failed after max attempts', 'error');
          });
        }
        // 再接続を諦めたので socket を明示的に閉じておく
        // (this.socket は次回 connect() で再生成される)
        this.socket?.disconnect();
        this.emit('onReconnectFailed');
      });

      this.socket.on('disconnect', (reason) => {
        wsLog('disconnect', reason);
        this.emit('onDisconnected', reason);
        // auto-reconnect が走るケースでは UI 側で「再接続中」表示に切り替えてもらう。
        // React 18 の自動バッチで onDisconnected/onReconnecting の setState がまとめられるので、
        // エラーダイアログがちらつくことはない。
        if (AUTO_RECONNECT_DISCONNECT_REASONS.has(reason)) {
          this.emit('onReconnecting', reason);
        }
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

  /**
   * 開発用: サーバーに transport を閉じさせて auto-reconnect の動作確認をする。
   * サーバープロセスを生かしたまま WS だけ落とせるので、テーブル状態を保ったまま再接続テストできる。
   * DevTools Console から `wsService.debugForceDisconnect()` で呼ぶ想定。
   */
  debugForceDisconnect(): void {
    if (!this.socket) {
      console.warn('[wsService] socket not connected');
      return;
    }
    console.log('[wsService] requesting server to force-close transport');
    // dev 専用イベントで protocol 型には載せていないので emit にキャストが必要
    (this.socket as unknown as { emit: (ev: string) => void }).emit('debug:force_disconnect');
  }

}

// Singleton instance
export const wsService = new WebSocketService();

// 開発時のみ DevTools Console から wsService にアクセスできるよう window に露出
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { wsService: WebSocketService }).wsService = wsService;
}
