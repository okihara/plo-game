import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { HandDetailDialog } from './HandDetailDialog';
import type { HandDetail, HandDetailPlayer } from './HandDetailDialog';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const PAGE_SIZE = 20;

const SUIT_SYMBOLS: Record<string, string> = {
  h: '\u2665', d: '\u2666', c: '\u2663', s: '\u2660',
};
const SUIT_BG_COLORS: Record<string, string> = {
  h: 'bg-red-600', d: 'bg-blue-600', c: 'bg-green-700', s: 'bg-gray-800',
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
  dealerPosition: number;
  createdAt: string;
  players: HandDetailPlayer[];
}


interface HandHistoryPanelProps {
  onClose: () => void;
}

export function MiniCard({ cardStr }: { cardStr: string }) {
  const rank = cardStr.slice(0, -1);
  const suit = cardStr.slice(-1);
  const symbol = SUIT_SYMBOLS[suit] || suit;
  const bg = SUIT_BG_COLORS[suit] || 'bg-gray-500';

  return (
    <span className={`inline-flex items-center justify-center ${bg} text-white border border-white/30 rounded px-[1.6cqw] py-[0.8cqw] text-[3cqw] font-mono font-bold leading-none shadow-sm`}>
      {rank}{symbol}
    </span>
  );
}

export function ProfitDisplay({ profit, size = 'normal' }: { profit: number; size?: 'normal' | 'large' }) {
  const textSize = size === 'large' ? 'text-base' : 'text-sm';
  if (profit > 0) {
    return <span className={`text-forest font-bold ${textSize}`}>+{profit}</span>;
  }
  if (profit < 0) {
    return <span className={`text-[#C0392B] font-bold ${textSize}`}>-{Math.abs(profit)}</span>;
  }
  return <span className={`text-cream-400 ${textSize}`}>0</span>;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
}

export function getPositionName(seatPosition: number, dealerPosition: number, allSeatPositions: number[]): string {
  if (dealerPosition < 0) return '';
  const sorted = [...allSeatPositions].sort((a, b) => {
    const offsetA = (a - dealerPosition + 6) % 6;
    const offsetB = (b - dealerPosition + 6) % 6;
    return offsetA - offsetB;
  });
  const index = sorted.indexOf(seatPosition);
  const count = sorted.length;
  if (count <= 1) return '';
  if (count === 2) return index === 0 ? 'SB' : 'BB';
  const posMap: Record<number, string[]> = {
    3: ['BTN', 'SB', 'BB'],
    4: ['BTN', 'SB', 'BB', 'CO'],
    5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
    6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  };
  const positions = posMap[count] || posMap[6]!;
  return positions[index] || '';
}


export function PositionBadge({ position }: { position: string }) {
  if (!position) return null;
  return (
    <span className="bg-cream-200 text-cream-800 text-xs font-bold w-8 text-center py-0.5 rounded border border-cream-400 shrink-0 inline-block">
      {position}
    </span>
  );
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
      className="w-full text-left bg-white border border-cream-300 rounded-xl p-3 shadow-[0_2px_8px_rgba(139,126,106,0.12)] transition-all duration-200 hover:bg-cream-50 hover:border-cream-400 active:scale-[0.98]"
    >
      {/* Row 1: meta left, profit right (hero element) */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-cream-600 text-sm font-semibold">#{hand.id.slice(-6)}</span>
          {(() => {
            const me = hand.players.find(p => p.isCurrentUser);
            const pos = me ? getPositionName(me.seatPosition, hand.dealerPosition, hand.players.map(p => p.seatPosition)) : '';
            return pos ? <PositionBadge position={pos} /> : null;
          })()}
          <span className="text-cream-900 text-base font-bold">{hand.blinds}</span>
          <span className="text-cream-500 text-xs font-medium">Pot {hand.potSize}</span>
        </div>
        <div className="flex items-center gap-2">
          <ProfitDisplay profit={hand.profit} size="large" />
          <span className="text-cream-400 text-xs">{formatDate(hand.createdAt)}</span>
        </div>
      </div>
      {/* Row 2: cards */}
      <div className="flex items-center gap-[0.6cqw]">
        {hand.holeCards.map((c, i) => (
          <MiniCard key={i} cardStr={c} />
        ))}
        {hand.communityCards.length > 0 && (
          <>
            <span className="text-cream-300 mx-[0.5cqw] text-lg font-light">|</span>
            {hand.communityCards.map((c, i) => (
              <MiniCard key={`cc-${i}`} cardStr={c} />
            ))}
          </>
        )}
      </div>
    </button>
  );
}

export function HandHistoryPanel({ onClose }: HandHistoryPanelProps) {
  const { user } = useAuth();
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [selectedHand, setSelectedHand] = useState<HandDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
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
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_BASE}/api/history/${handId}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setSelectedHand(data);
    } catch (err) {
      console.error('Failed to fetch hand detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (user) fetchHands(0);
    else setLoading(false);
  }, [user]);

  if (!user) {
    return (
      <div className="h-full light-bg flex items-center justify-center">
        <div className="text-center">
          <p className="text-cream-600 mb-4">ログインするとハンド履歴を確認できます</p>
          <button onClick={onClose} className="text-cream-500 hover:text-cream-700 transition-colors">
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      <div className="h-full overflow-y-auto light-scrollbar">
        {/* ヘッダー */}
        <div className="sticky top-0 bg-white border-b border-cream-300 px-4 py-3 flex items-center z-10 shadow-sm">
          <button onClick={onClose} className="text-cream-700 hover:text-cream-900 mr-3 text-sm font-medium transition-colors">
            &larr; 戻る
          </button>
          <h1 className="text-cream-900 font-bold text-lg tracking-tight">ハンド履歴</h1>
          <span className="ml-auto text-cream-600 text-sm font-medium">{total}件</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
          </div>
        ) : hands.length === 0 ? (
          <div className="text-center text-cream-500 py-20">
            まだハンド履歴がありません
          </div>
        ) : (
          <>
            <div className="p-3 space-y-2">
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
                  className="w-full py-3 text-cream-600 hover:text-cream-900 bg-white hover:bg-cream-50 rounded-xl transition-all text-sm border border-cream-300 hover:border-cream-400"
                >
                  {loadingMore ? '読み込み中...' : 'もっと読む'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {loadingDetail && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="w-8 h-8 border-2 border-cream-300 border-t-forest rounded-full animate-spin relative z-10" />
        </div>
      )}
      {selectedHand && (
        <HandDetailDialog hand={selectedHand} onClose={() => setSelectedHand(null)} />
      )}
    </div>
  );
}
