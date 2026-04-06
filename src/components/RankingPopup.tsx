import { useEffect, useState, useRef } from 'react';
import { fetchRankings } from '../utils/rankingsCache';
import { formatProfit, ordinalSuffix, type RankingEntry } from './RankingUtils';

const MAX_DISPLAY_ALL = 30;
const MAX_DISPLAY_PERIOD = 15;

interface RankingPopupProps {
  userId?: string;
  onClose?: () => void;
}

type Tab = 'profit' | 'winrate';
type Period = 'daily' | 'weekly' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  daily: '今日',
  weekly: '週間',
  all: '全期間',
};

/** weekOffset=0 → 今週, 1 → 先週, … */
function getWeekRange(weekOffset: number): { monday: Date; sunday: Date } {
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay();
  const diff = day === 0 ? 6 : day - 1;
  monday.setDate(monday.getDate() - diff - 7 * weekOffset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { monday, sunday };
}

const MAX_WEEK_OFFSET = 8;

function buildWeekOptions(): { value: number; label: string }[] {
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  const options: { value: number; label: string }[] = [];
  for (let i = 0; i <= MAX_WEEK_OFFSET; i++) {
    const { monday, sunday } = getWeekRange(i);
    const label = i === 0
      ? `今週 (${fmt(monday)}~${fmt(sunday)})`
      : `${fmt(monday)}~${fmt(sunday)}`;
    options.push({ value: i, label });
  }
  return options;
}

function formatPeriodRange(period: Period): string {
  if (period === 'all') return '全期間の累計';
  if (period === 'daily') return '毎日 0:00 ~ 24:00';
  return '月曜 0:00 ~ 日曜 24:00';
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
  const [weekOffset, setWeekOffset] = useState(0);
  const myRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetchRankings(period, period === 'weekly' ? weekOffset : 0)
      .then(setRankings)
      .catch(() => setRankings([]))
      .finally(() => setLoading(false));
  }, [period, weekOffset]);

  // ESCキーで閉じる
  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
      className="absolute inset-0 z-[200] bg-cream-200 flex flex-col"
    >
      <div className="@container w-full flex-1 overflow-y-auto min-h-0">
        <div className="px-[4cqw] pt-[4cqw] pb-[2cqw]">
          {/* Header */}
          <h2 className="text-[5cqw] font-bold text-cream-900 mb-[3cqw]">ランキング</h2>

          {/* Period selector */}
          <div className="flex mb-[2cqw] gap-[1.5cqw]">
            {(['daily', 'weekly', 'all'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => { setPeriod(p); if (p !== 'weekly') setWeekOffset(0); }}
                className={`flex-1 py-[1.5cqw] text-[2.8cqw] font-bold rounded-[2cqw] border transition-all ${
                  period === p
                    ? 'bg-cream-900 text-white border-cream-900'
                    : 'bg-white text-cream-700 border-cream-300 hover:text-cream-700 hover:border-cream-400'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Period range label */}
          <div className="text-center text-[2.5cqw] text-cream-700 mb-[2cqw]">
            集計期間: {formatPeriodRange(period)}
          </div>

          {/* Tabs */}
          <div className="flex mb-[2cqw] bg-cream-100 rounded-[2cqw] p-[0.8cqw]">
            <button
              onClick={() => setTab('profit')}
              className={`flex-1 py-[1.5cqw] text-[3cqw] font-bold rounded-[1.5cqw] transition-all ${
                tab === 'profit'
                  ? 'bg-cream-900 text-white shadow-sm'
                  : 'text-cream-700'
              }`}
            >
              Profit (EV)
            </button>
            <button
              onClick={() => setTab('winrate')}
              className={`flex-1 py-[1.5cqw] text-[3cqw] font-bold rounded-[1.5cqw] transition-all ${
                tab === 'winrate'
                  ? 'bg-cream-900 text-white shadow-sm'
                  : 'text-cream-700'
              }`}
            >
              Winrate (EV)
            </button>
          </div>

          {/* Week selector (weekly only) */}
          {period === 'weekly' && (
            <div className="mb-[3cqw]">
              <select
                value={weekOffset}
                onChange={e => setWeekOffset(Number(e.target.value))}
                className="w-full py-[1.5cqw] px-[2cqw] text-[2.8cqw] text-cream-800 bg-white border border-cream-300 rounded-[2cqw] appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%236b7280%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:5cqw_5cqw] bg-[right_1cqw_center] bg-no-repeat"
              >
                {buildWeekOptions().map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="flex flex-col items-center py-[8cqw]">
              <div className="w-[6cqw] h-[6cqw] border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
              <p className="text-cream-700 text-[3cqw] mt-[2cqw]">読み込み中...</p>
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-[8cqw] text-cream-700 text-[3cqw]">
              まだランキングデータがありません
            </div>
          ) : (
            <div className="space-y-[1cqw]">
              {sorted.map((entry, i) => {
                const rank = i + 1;
                const isMe = entry.userId === userId;
                const displayName = entry.username;
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
                    className={`flex items-center gap-[2cqw] py-[2cqw] px-[2.5cqw] rounded-[2cqw] shadow-[0_2px_8px_rgba(139,126,106,0.12)] ${
                      isMe
                        ? 'bg-forest/10 border border-forest/30'
                        : 'bg-white border border-cream-200'
                    }`}
                  >
                    {/* Rank */}
                    <div className="w-[7cqw] text-center shrink-0">
                      <span className="text-[3.2cqw] font-bold text-cream-700">{rank}<sup className="text-[1.8cqw]">{ordinalSuffix(rank)}</sup></span>
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
                        <div className="text-[2cqw] text-cream-700">{entry.handsPlayed.toLocaleString()}h</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* My rank */}
          {myRank > 0 && (
            <div className="py-[3cqw] border-t border-cream-200 text-center mt-[2cqw]">
              <span className="text-[3cqw] text-cream-700">
                あなたの順位: <span className="font-bold text-cream-900">{myRank}位</span> / {allSorted.length}人
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Footer Button */}
      {onClose && (
        <div className="@container w-full shrink-0 px-[4cqw] pb-[4cqw] pt-[1cqw]">
          <button
            onClick={onClose}
            className="w-full py-[3cqw] bg-cream-900 text-white text-[4cqw] font-bold rounded-[3cqw] active:bg-cream-800"
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}
