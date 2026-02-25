import { useEffect, useState, useRef } from 'react';
import { maskName } from '../utils';
import { fetchRankings } from '../utils/rankingsCache';

export interface RankingEntry {
  userId: string;
  username: string;
  avatarUrl: string | null;
  nameMasked: boolean;
  isBot: boolean;
  handsPlayed: number;
  totalAllInEVProfit: number;
  winCount: number;
}

const MAX_DISPLAY_ALL = 30;
const MAX_DISPLAY_PERIOD = 15;

interface RankingPopupProps {
  userId: string;
  onClose: () => void;
}

type Tab = 'profit' | 'winrate';
type Period = 'daily' | 'weekly' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  daily: '今日',
  weekly: '週間',
  all: '全期間',
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatPeriodRange(period: Period): string | null {
  if (period === 'all') return null;
  const now = new Date();
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
  if (period === 'daily') {
    return fmt(now);
  }
  // 今週の月曜〜日曜
  const monday = new Date(now);
  const day = monday.getDay();
  const diff = day === 0 ? 6 : day - 1;
  monday.setDate(monday.getDate() - diff);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return `${fmt(monday)} ~ ${fmt(sunday)}`;
}

export function formatProfit(value: number): string {
  const formatted = Math.abs(value).toLocaleString();
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

function formatWinrate(evProfit: number, hands: number): string {
  if (hands === 0) return '0.0';
  const perHand = evProfit / hands;
  return perHand >= 0 ? `+${perHand.toFixed(1)}` : perHand.toFixed(1);
}

export function RankingPopup({ userId, onClose }: RankingPopupProps) {
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('profit');
  const [period, setPeriod] = useState<Period>('weekly');
  const myRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetchRankings(period)
      .then(setRankings)
      .catch(() => setRankings([]))
      .finally(() => setLoading(false));
  }, [period]);

  // ESCキーで閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const allSorted = [...rankings].sort((a, b) => {
    if (tab === 'profit') {
      return b.totalAllInEVProfit - a.totalAllInEVProfit;
    }
    const aRate = a.handsPlayed > 0 ? a.totalAllInEVProfit / a.handsPlayed : 0;
    const bRate = b.handsPlayed > 0 ? b.totalAllInEVProfit / b.handsPlayed : 0;
    return bRate - aRate;
  });

  const myRank = allSorted.findIndex(r => r.userId === userId) + 1;
  const maxDisplay = period === 'all' ? MAX_DISPLAY_ALL : MAX_DISPLAY_PERIOD;
  const sorted = allSorted.slice(0, maxDisplay);

  return (
    <div
      className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200]"
      onClick={handleBackdropClick}
    >
      <div className="@container w-[88cqw]">
        <div className="bg-white rounded-[5cqw] border border-cream-300 shadow-[0_8px_40px_rgba(139,126,106,0.2)] animate-scale-in flex flex-col max-h-[80dvh]">
          {/* Header */}
          <div className="flex items-center justify-between px-[5cqw] pt-[5cqw] pb-[3cqw]">
            <h2 className="text-[5cqw] font-bold text-cream-900">ランキング</h2>
            <button
              onClick={onClose}
              className="text-cream-400 hover:text-cream-900 text-[7cqw] leading-none"
            >
              ×
            </button>
          </div>

          {/* Period selector */}
          <div className="flex mx-[5cqw] mb-[2cqw] gap-[1.5cqw]">
            {(['daily', 'weekly', 'all'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 py-[1.5cqw] text-[2.8cqw] font-bold rounded-[2cqw] border transition-all ${
                  period === p
                    ? 'bg-cream-900 text-white border-cream-900'
                    : 'bg-white text-cream-500 border-cream-300 hover:text-cream-700 hover:border-cream-400'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Period range label */}
          {formatPeriodRange(period) && (
            <div className="text-center text-[2.5cqw] text-cream-500 mb-[2cqw]">
              {formatPeriodRange(period)}
            </div>
          )}

          {/* Tabs */}
          <div className="flex mx-[5cqw] mb-[3cqw] bg-cream-100 rounded-[2cqw] p-[0.8cqw]">
            <button
              onClick={() => setTab('profit')}
              className={`flex-1 py-[1.5cqw] text-[3cqw] font-bold rounded-[1.5cqw] transition-all ${
                tab === 'profit'
                  ? 'bg-white text-cream-900 shadow-sm'
                  : 'text-cream-500 hover:text-cream-700'
              }`}
            >
              Profit (EV)
            </button>
            <button
              onClick={() => setTab('winrate')}
              className={`flex-1 py-[1.5cqw] text-[3cqw] font-bold rounded-[1.5cqw] transition-all ${
                tab === 'winrate'
                  ? 'bg-white text-cream-900 shadow-sm'
                  : 'text-cream-500 hover:text-cream-700'
              }`}
            >
              Winrate (EV)
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-[5cqw] min-h-0">
            {loading ? (
              <div className="flex flex-col items-center py-[8cqw]">
                <div className="w-[6cqw] h-[6cqw] border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
                <p className="text-cream-500 text-[3cqw] mt-[2cqw]">読み込み中...</p>
              </div>
            ) : sorted.length === 0 ? (
              <div className="text-center py-[8cqw] text-cream-500 text-[3cqw]">
                まだランキングデータがありません
              </div>
            ) : (
              <div className="space-y-[1cqw]">
                {sorted.map((entry, i) => {
                  const rank = i + 1;
                  const isMe = entry.userId === userId;
                  const displayName =
                    isMe ? entry.username : entry.nameMasked ? maskName(entry.username) : entry.username;
                  const value =
                    tab === 'profit'
                      ? formatProfit(entry.totalAllInEVProfit)
                      : formatWinrate(entry.totalAllInEVProfit, entry.handsPlayed);
                  const valueColor =
                    tab === 'profit'
                      ? entry.totalAllInEVProfit >= 0
                        ? 'text-forest'
                        : 'text-[#C0392B]'
                      : (entry.handsPlayed > 0 ? entry.totalAllInEVProfit / entry.handsPlayed : 0) >= 0
                        ? 'text-forest'
                        : 'text-[#C0392B]';

                  return (
                    <div
                      key={entry.userId}
                      ref={isMe ? myRowRef : undefined}
                      className={`flex items-center gap-[2cqw] py-[2cqw] px-[2.5cqw] rounded-[2cqw] ${
                        isMe
                          ? 'bg-forest/10 border border-forest/30'
                          : 'hover:bg-cream-50'
                      }`}
                    >
                      {/* Rank */}
                      <div className="w-[7cqw] text-center shrink-0">
                        {rank <= 3 ? (
                          <span className="text-[4cqw]">
                            {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
                          </span>
                        ) : (
                          <span className="text-[3.2cqw] font-bold text-cream-500">{rank}</span>
                        )}
                      </div>

                      {/* Avatar + Name */}
                      <div className="flex items-center gap-[2cqw] flex-1 min-w-0">
                        <div className="w-[7cqw] h-[7cqw] rounded-full bg-cream-200 border border-cream-300 overflow-hidden shrink-0">
                          <img
                            src={entry.avatarUrl || '/images/icons/anonymous.svg'}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <span className={`text-[3cqw] truncate ${isMe ? 'font-bold text-forest' : 'text-cream-800'}`}>
                          {displayName}
                        </span>
                      </div>

                      {/* Value */}
                      <div className="text-right shrink-0">
                        <span className={`text-[3.2cqw] font-bold ${valueColor}`}>{value}</span>
                        {tab === 'winrate' && (
                          <div className="text-[2cqw] text-cream-500">{entry.handsPlayed.toLocaleString()}h</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer - my rank */}
          {myRank > 0 && (
            <div className="px-[5cqw] py-[3cqw] border-t border-cream-200 text-center">
              <span className="text-[3cqw] text-cream-600">
                あなたの順位: <span className="font-bold text-cream-900">{myRank}位</span> / {allSorted.length}人
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
