import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const REFRESH_INTERVAL_MS = 10_000;

interface PrivateRoomPlayer {
  odId: string;
  odName: string;
  seatNumber: number;
  chips: number;
  isConnected: boolean;
}

interface PrivateRoom {
  tableId: string;
  inviteCode: string | null;
  blinds: string;
  playerCount: number;
  maxPlayers: number;
  isHandInProgress: boolean;
  currentStreet: string;
  pot: number;
  spectatorCount: number;
  players: PrivateRoomPlayer[];
}

interface PrivateRoomsProps {
  onWatch: (tableId: string, inviteCode: string | null) => void;
  onBack: () => void;
}

/** プライベートルーム一覧（ADMIN role のユーザー専用）。観戦ページへは招待コード付きで遷移する。 */
export function PrivateRooms({ onWatch, onBack }: PrivateRoomsProps) {
  const { user, loading: authLoading } = useAuth();
  const [rooms, setRooms] = useState<PrivateRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/private-rooms`, {
        credentials: 'include',
      });
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setRooms(data.rooms);
      setError(null);
    } catch {
      setError('一覧の取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== 'ADMIN') {
      setForbidden(true);
      return;
    }
    fetchRooms();
    const timer = setInterval(fetchRooms, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [authLoading, user, fetchRooms]);

  const header = (
    <div className="flex items-center justify-between px-[4cqw] py-[3cqw] border-b border-cream-300">
      <button
        type="button"
        onClick={onBack}
        className="text-[3cqw] text-cream-700 hover:text-cream-900 active:scale-[0.98]"
      >
        ← 戻る
      </button>
      <h1 className="text-[4cqw] font-bold text-cream-900">プライベートルーム一覧</h1>
      <button
        type="button"
        onClick={fetchRooms}
        className="text-[3cqw] px-[3cqw] py-[1.5cqw] rounded-lg bg-cream-100 border border-cream-300 text-cream-700 hover:bg-cream-200 active:scale-[0.98]"
      >
        更新
      </button>
    </div>
  );

  if (authLoading || (!forbidden && rooms === null && !error)) {
    return (
      <div className="h-full light-bg flex flex-col">
        {header}
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[3.5cqw] text-cream-700">読み込み中…</p>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="h-full light-bg flex flex-col">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center px-[8cqw]">
          <p className="text-[3.5cqw] text-cream-800 text-center mb-[4cqw]">
            このページを表示する権限がありません。
          </p>
          <button
            type="button"
            onClick={onBack}
            className="text-[3.5cqw] px-[6cqw] py-[2.5cqw] rounded-lg bg-cream-900 text-white font-bold active:scale-[0.98]"
          >
            ロビーに戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full light-bg flex flex-col">
      {header}
      <div className="flex-1 overflow-y-auto light-scrollbar px-[4cqw] py-[3cqw]">
        {error && (
          <div className="mb-[3cqw] px-[3cqw] py-[2cqw] rounded-lg bg-cream-50 border border-cream-400 text-cream-800 text-[3cqw]">
            {error}
          </div>
        )}
        {rooms && rooms.length === 0 && (
          <div className="flex flex-col items-center justify-center py-[16cqw]">
            <p className="text-[3.5cqw] text-cream-700">現在プライベートルームはありません</p>
            <p className="text-[2.8cqw] text-cream-600 mt-[2cqw]">
              {REFRESH_INTERVAL_MS / 1000}秒ごとに自動更新されます
            </p>
          </div>
        )}
        {rooms?.map(room => (
          <div
            key={room.tableId}
            className="mb-[3cqw] rounded-xl bg-white border border-cream-300 shadow-[0_2px_8px_rgba(139,126,106,0.12)] px-[4cqw] py-[3cqw]"
          >
            <div className="flex items-center justify-between mb-[2cqw]">
              <div className="flex items-center gap-[2cqw]">
                <span className="text-[4cqw] font-bold text-cream-900 font-mono tracking-wider">
                  {room.inviteCode ?? '—'}
                </span>
                <span className="text-[2.8cqw] text-cream-700">PLO {room.blinds}</span>
              </div>
              <button
                type="button"
                onClick={() => onWatch(room.tableId, room.inviteCode)}
                className="text-[3cqw] px-[4cqw] py-[2cqw] rounded-lg bg-forest hover:bg-forest-light text-white font-bold shadow-[0_4px_20px_rgba(45,90,61,0.3)] active:scale-[0.98]"
              >
                観戦
              </button>
            </div>
            <div className="flex items-center gap-[3cqw] text-[2.8cqw] text-cream-700 mb-[2cqw]">
              <span>
                {room.playerCount}/{room.maxPlayers}人
              </span>
              <span>
                {room.isHandInProgress ? `ハンド進行中（${room.currentStreet}） / ポット ${room.pot}` : '待機中'}
              </span>
              {room.spectatorCount > 0 && <span>観戦 {room.spectatorCount}人</span>}
            </div>
            {room.players.length > 0 && (
              <div className="flex flex-wrap gap-[1.5cqw]">
                {room.players.map(p => (
                  <span
                    key={p.odId}
                    className={`text-[2.8cqw] px-[2.5cqw] py-[1cqw] rounded-full border ${
                      p.isConnected
                        ? 'bg-cream-100 border-cream-300 text-cream-800'
                        : 'bg-cream-50 border-cream-400 text-cream-500'
                    }`}
                  >
                    {p.odName}（{p.chips.toLocaleString()}）
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
