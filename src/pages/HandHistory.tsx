import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const PAGE_SIZE = 20;

const SUIT_SYMBOLS: Record<string, string> = {
  h: '\u2665', d: '\u2666', c: '\u2663', s: '\u2660',
};
const SUIT_COLORS: Record<string, string> = {
  h: 'text-red-500', d: 'text-blue-400', c: 'text-green-400', s: 'text-gray-300',
};

interface HandSummary {
  id: string;
  handNumber: number;
  blinds: string;
  communityCards: string[];
  potSize: number;
  profit: number;
  finalHand: string | null;
  holeCards: string[];
  isWinner: boolean;
  createdAt: string;
}

interface HandDetailPlayer {
  username: string;
  avatarUrl: string | null;
  seatPosition: number;
  holeCards: string[];
  finalHand: string | null;
  profit: number;
  isCurrentUser: boolean;
}

interface HandDetailAction {
  seatIndex: number;
  odId: string;
  odName: string;
  action: string;
  amount: number;
}

interface HandDetail {
  id: string;
  handNumber: number;
  blinds: string;
  communityCards: string[];
  potSize: number;
  winners: string[];
  actions: HandDetailAction[];
  createdAt: string;
  players: HandDetailPlayer[];
}

interface HandHistoryProps {
  onBack: () => void;
}

function MiniCard({ cardStr }: { cardStr: string }) {
  const rank = cardStr.slice(0, -1);
  const suit = cardStr.slice(-1);
  const symbol = SUIT_SYMBOLS[suit] || suit;
  const color = SUIT_COLORS[suit] || 'text-white';

  return (
    <span className={`inline-flex items-center justify-center w-7 h-9 bg-white/90 rounded text-xs font-bold shadow-sm ${color}`}>
      {rank}{symbol}
    </span>
  );
}

function ProfitDisplay({ profit }: { profit: number }) {
  if (profit > 0) {
    return <span className="text-green-400 font-bold">+${profit}</span>;
  }
  if (profit < 0) {
    return <span className="text-red-400 font-bold">-${Math.abs(profit)}</span>;
  }
  return <span className="text-white/40">$0</span>;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    fold: 'Fold', check: 'Check', call: 'Call',
    bet: 'Bet', raise: 'Raise', allin: 'All-in',
  };
  return map[action] || action;
}

function HandSummaryCard({
  hand,
  onClick,
}: {
  hand: HandSummary;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white/5 hover:bg-white/10 rounded-xl p-3 border border-white/10 hover:border-white/20 transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-xs">#{hand.handNumber}</span>
          <span className="text-white/70 text-sm">${hand.blinds}</span>
          <span className="text-white/40 text-xs">Pot ${hand.potSize}</span>
        </div>
        <div className="flex items-center gap-2">
          <ProfitDisplay profit={hand.profit} />
          <span className="text-white/30 text-xs">{formatDate(hand.createdAt)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {hand.holeCards.map((c, i) => (
          <MiniCard key={i} cardStr={c} />
        ))}
        {hand.finalHand && (
          <span className="ml-2 text-yellow-400/80 text-xs">{hand.finalHand}</span>
        )}
      </div>
    </button>
  );
}

function HandDetailView({
  hand,
  onBack,
}: {
  hand: HandDetail;
  onBack: () => void;
}) {
  return (
    <div className="h-full bg-gradient-to-br from-purple-900 via-blue-900 to-black overflow-y-auto">
      {/* ヘッダー */}
      <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center z-10">
        <button onClick={onBack} className="text-white/70 hover:text-white mr-3 text-sm">
          &larr; 戻る
        </button>
        <h1 className="text-white font-bold">
          Hand #{hand.handNumber}
        </h1>
        <span className="ml-2 text-white/50 text-sm">${hand.blinds}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* コミュニティカード */}
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <div className="text-white/50 text-xs mb-2">ボード</div>
          <div className="flex gap-1.5 justify-center">
            {hand.communityCards.map((c, i) => (
              <MiniCard key={i} cardStr={c} />
            ))}
          </div>
          <div className="text-center text-white/50 text-sm mt-2">
            Pot ${hand.potSize}
          </div>
        </div>

        {/* プレイヤー */}
        <div className="space-y-2">
          <div className="text-white/50 text-xs">プレイヤー</div>
          {hand.players
            .sort((a, b) => (a.isCurrentUser ? -1 : b.isCurrentUser ? 1 : 0))
            .map((p, i) => (
              <div
                key={i}
                className={`bg-white/5 rounded-lg p-3 border ${
                  p.isCurrentUser ? 'border-cyan-500/30' : 'border-white/10'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {p.avatarUrl && (
                      <img src={p.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                    )}
                    <span className={`text-sm font-medium ${p.isCurrentUser ? 'text-cyan-400' : 'text-white/80'}`}>
                      {p.username}
                    </span>
                    <span className="text-white/30 text-xs">Seat {p.seatPosition + 1}</span>
                  </div>
                  <ProfitDisplay profit={p.profit} />
                </div>
                <div className="flex items-center gap-1">
                  {p.holeCards.map((c, j) => (
                    <MiniCard key={j} cardStr={c} />
                  ))}
                  {p.finalHand && (
                    <span className="ml-2 text-yellow-400/80 text-xs">{p.finalHand}</span>
                  )}
                </div>
              </div>
            ))}
        </div>

        {/* アクション履歴 */}
        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
          <div className="text-white/50 text-xs mb-2">アクション</div>
          <div className="space-y-1 text-sm">
            {hand.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-white/60 w-20 truncate">{a.odName}</span>
                <span className="text-white/90">{formatAction(a.action)}</span>
                {a.amount > 0 && (
                  <span className="text-white/50">${a.amount}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 日時 */}
        <div className="text-center text-white/30 text-xs">
          {new Date(hand.createdAt).toLocaleString('ja-JP')}
        </div>
      </div>
    </div>
  );
}

export function HandHistory({ onBack }: HandHistoryProps) {
  const { user } = useAuth();
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [selectedHand, setSelectedHand] = useState<HandDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  const fetchHands = async (offsetVal: number, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await fetch(
        `${API_BASE}/api/history?limit=${PAGE_SIZE}&offset=${offsetVal}`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json();
      setHands(prev => append ? [...prev, ...data.hands] : data.hands);
      setTotal(data.total);
      setOffset(offsetVal);
    } catch (err) {
      console.error('Failed to fetch hand history:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const fetchHandDetail = async (handId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/${handId}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setSelectedHand(data);
    } catch (err) {
      console.error('Failed to fetch hand detail:', err);
    }
  };

  useEffect(() => {
    if (user) fetchHands(0);
    else setLoading(false);
  }, [user]);

  if (!user) {
    return (
      <div className="h-full bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/60 mb-4">ログインするとハンド履歴を確認できます</p>
          <button onClick={onBack} className="text-cyan-400 hover:text-cyan-300">
            戻る
          </button>
        </div>
      </div>
    );
  }

  if (selectedHand) {
    return <HandDetailView hand={selectedHand} onBack={() => setSelectedHand(null)} />;
  }

  return (
    <div className="h-full bg-gradient-to-br from-purple-900 via-blue-900 to-black overflow-y-auto">
      {/* ヘッダー */}
      <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center z-10">
        <button onClick={onBack} className="text-white/70 hover:text-white mr-3 text-sm">
          &larr; 戻る
        </button>
        <h1 className="text-white font-bold text-lg">ハンド履歴</h1>
        <span className="ml-auto text-white/50 text-sm">{total}件</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      ) : hands.length === 0 ? (
        <div className="text-center text-white/40 py-20">
          まだハンド履歴がありません
        </div>
      ) : (
        <>
          <div className="p-4 space-y-2">
            {hands.map(hand => (
              <HandSummaryCard
                key={hand.id}
                hand={hand}
                onClick={() => fetchHandDetail(hand.id)}
              />
            ))}
          </div>

          {hands.length < total && (
            <div className="px-4 pb-6">
              <button
                onClick={() => fetchHands(offset + PAGE_SIZE, true)}
                disabled={loadingMore}
                className="w-full py-3 text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all text-sm border border-white/10"
              >
                {loadingMore ? '読み込み中...' : 'もっと読む'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
