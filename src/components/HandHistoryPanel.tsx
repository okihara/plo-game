import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { HandDetailDialog } from './HandDetailDialog';
import type { HandDetail, HandDetailPlayer } from './HandDetailDialog';
import { evaluateCurrentHand } from '../logic/handEvaluator';
import type { Card } from '../logic/types';
const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const PAGE_SIZE = 20;

const SUIT_SYMBOLS: Record<string, string> = {
  h: '\u2665', d: '\u2666', c: '\u2663', s: '\u2660',
};
const SUIT_BORDER_COLORS: Record<string, string> = {
  h: 'border-red-500', d: 'border-blue-500', c: 'border-green-600', s: 'border-gray-700',
};
const SUIT_TEXT_COLORS: Record<string, string> = {
  h: 'text-red-600', d: 'text-blue-600', c: 'text-green-700', s: 'text-gray-800',
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
  const borderColor = SUIT_BORDER_COLORS[suit] || 'border-gray-400';
  const textColor = SUIT_TEXT_COLORS[suit] || 'text-gray-800';

  return (
    <span className={`inline-flex items-center justify-center bg-white ${textColor} border ${borderColor} rounded-[0.8cqw] px-[1.6cqw] py-[0.8cqw] text-[3cqw] font-mono font-bold leading-none shadow-sm`}>
      {rank}{symbol}
    </span>
  );
}

export function ProfitDisplay({ profit, size = 'normal' }: { profit: number; size?: 'normal' | 'large' }) {
  const textSize = size === 'large' ? 'text-[3.5cqw]' : 'text-[3cqw]';
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
    <span className="bg-cream-200 text-cream-800 text-[2.5cqw] font-bold w-[7cqw] text-center py-[0.5cqw] rounded-[0.8cqw] border border-cream-400 shrink-0 inline-block">
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
      className="w-full text-left bg-white border border-cream-300 rounded-[2.5cqw] p-[3cqw] shadow-[0_2px_8px_rgba(139,126,106,0.12)] transition-all duration-200 hover:bg-cream-50 hover:border-cream-400 active:scale-[0.98]"
    >
      {/* Row 1: meta left, profit right (hero element) */}
      <div className="flex items-center justify-between mb-[2cqw]">
        <div className="flex items-center gap-[1.5cqw]">
          <span className="text-cream-700 text-[3cqw] w-[15cqw] shrink-0">{formatDate(hand.createdAt)}</span>
          <span className="text-cream-900 text-[2.8cqw] font-bold shrink-0">{hand.blinds}</span>
          {(() => {
            const me = hand.players.find(p => p.isCurrentUser);
            const pos = me ? getPositionName(me.seatPosition, hand.dealerPosition, hand.players.map(p => p.seatPosition)) : '';
            return pos ? <PositionBadge position={pos} /> : null;
          })()}
          {(() => {
            const name = hand.finalHand
              || (hand.holeCards.length === 4 && hand.communityCards.length >= 3
                ? evaluateCurrentHand(
                    hand.holeCards.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
                    hand.communityCards.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
                  )?.name
                : null);
            return name ? <span className="text-cream-800 text-[2.5cqw] font-medium">{name}</span> : null;
          })()}
        </div>
        <ProfitDisplay profit={hand.profit} size="large" />
      </div>
      {/* Row 2: cards */}
      <div className="flex items-center gap-[0.6cqw]">
        {hand.holeCards.map((c, i) => (
          <MiniCard key={i} cardStr={c} />
        ))}
        {hand.communityCards.length > 0 && (
          <>
            <span className="text-cream-600 mx-[1.5cqw] text-[4cqw] font-light">|</span>
            {hand.communityCards.map((c, i) => (
              <MiniCard key={`cc-${i}`} cardStr={c} />
            ))}
          </>
        )}
      </div>
    </button>
  );
}

type GameType = 'cash' | 'tournament';

export function HandHistoryPanel({ onClose }: HandHistoryPanelProps) {
  const { user } = useAuth();
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [selectedHand, setSelectedHand] = useState<HandDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [gameType, setGameType] = useState<GameType>('cash');

  const switchTab = (type: GameType) => {
    setGameType(type);
    setHands([]);
    setTotal(0);
    setOffset(0);
  };

  const fetchHands = async (offsetVal: number, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await fetch(
        `${API_BASE}/api/history?limit=${PAGE_SIZE}&offset=${offsetVal}&gameType=${gameType}`,
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
  }, [user, gameType]);

  if (!user) {
    return (
      <div className="h-full light-bg flex items-center justify-center">
        <div className="text-center">
          <p className="text-cream-600 mb-[4cqw] text-[3cqw]">ログインするとハンド履歴を確認できます</p>
          <button onClick={onClose} className="text-cream-500 hover:text-cream-700 transition-colors text-[3cqw]">
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full relative light-bg">
      <div className="h-full overflow-y-auto light-scrollbar">
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-white shadow-sm">
          <div className="border-b border-cream-300 px-[4cqw] py-[3cqw] flex items-center">
            <button onClick={onClose} className="text-cream-700 hover:text-cream-900 mr-[2.5cqw] text-[3cqw] font-medium transition-colors">
              &larr; 戻る
            </button>
            <h1 className="text-cream-900 font-bold text-[4cqw] tracking-tight">ハンド履歴</h1>
            <span className="ml-auto text-cream-600 text-[3cqw] font-medium">{total}件</span>
          </div>
          <div className="flex border-b border-cream-300">
            {([['cash', 'キャッシュ'], ['tournament', 'トーナメント']] as const).map(([type, label]) => (
              <button
                key={type}
                onClick={() => switchTab(type)}
                className={`flex-1 py-[2.5cqw] text-[3cqw] font-semibold transition-colors ${
                  gameType === type
                    ? 'text-forest border-b-[0.5cqw] border-forest'
                    : 'text-cream-500 hover:text-cream-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-[20cqw]">
            <div className="w-[7cqw] h-[7cqw] border-[0.4cqw] border-cream-300 border-t-forest rounded-full animate-spin" />
          </div>
        ) : hands.length === 0 ? (
          <div className="text-center text-cream-500 py-[20cqw] text-[3cqw]">
            まだハンド履歴がありません
          </div>
        ) : (
          <>
            <div className="p-[3cqw] space-y-[2cqw]">
              {hands.map(hand => (
                <HandSummaryCard
                  key={hand.id}
                  hand={hand}
                  onClick={() => fetchHandDetail(hand.id)}
                />
              ))}
            </div>

            {hands.length < total && (
              <div className="px-[4cqw] pb-[6cqw]">
                <button
                  onClick={() => fetchHands(offset + PAGE_SIZE, true)}
                  disabled={loadingMore}
                  className="w-full py-[3cqw] text-cream-600 hover:text-cream-900 bg-white hover:bg-cream-50 rounded-[2.5cqw] transition-all text-[3cqw] border border-cream-300 hover:border-cream-400"
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
          <div className="w-[7cqw] h-[7cqw] border-[0.4cqw] border-cream-300 border-t-forest rounded-full animate-spin relative z-10" />
        </div>
      )}
      {selectedHand && (
        <HandDetailDialog hand={selectedHand} onClose={() => setSelectedHand(null)} />
      )}
    </div>
  );
}
