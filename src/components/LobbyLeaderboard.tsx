import { useEffect, useState } from 'react';
import type { RankingEntry } from './RankingPopup';
import { formatProfit } from './RankingPopup';
import { fetchRankings } from '../utils/rankingsCache';
const MEDALS = ['🥇', '🥈', '🥉'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function getWeekRange(): string {
  const now = new Date();
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
  const monday = new Date(now);
  const day = monday.getDay();
  const diff = day === 0 ? 6 : day - 1;
  monday.setDate(monday.getDate() - diff);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return `${fmt(monday)} ~ ${fmt(sunday)}`;
}

interface LobbyLeaderboardProps {
  userId?: string;
  onShowFull: () => void;
  refreshKey?: number;
}

export function LobbyLeaderboard({ userId, onShowFull, refreshKey }: LobbyLeaderboardProps) {
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchRankings('weekly')
      .then(setRankings)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [refreshKey]);

  const sorted = [...rankings]
    .sort((a, b) => b.totalAllInEVProfit - a.totalAllInEVProfit)
    .slice(0, 10);

  if (!loaded || sorted.length === 0) return null;

  return (
    <div
      className="mt-[3cqw] bg-white border border-cream-300 rounded-[3cqw] px-[4cqw] py-[3cqw] shadow-[0_2px_8px_rgba(139,126,106,0.12)] cursor-pointer hover:bg-cream-50 transition-colors"
      onClick={onShowFull}
    >
      <div className="flex items-center justify-between mb-[2cqw]">
        <div>
          <span className="text-[3cqw] font-bold text-cream-900">週間ランキング</span>
          <span className="text-[2.2cqw] text-cream-600 ml-[1.5cqw]">{getWeekRange()}</span>
        </div>
        <span className="text-[2.5cqw] text-cream-400">もっと見る &gt;</span>
      </div>
      <div className="space-y-[1.5cqw]">
        {sorted.map((entry, i) => {
          const isMe = entry.userId === userId;
          const displayName = entry.username;
          const profit = entry.totalAllInEVProfit;

          return (
            <div
              key={entry.userId}
              className={`flex items-center gap-[2cqw] ${isMe ? 'font-bold' : ''}`}
            >
              <span className="text-[3.5cqw] w-[5cqw] text-center shrink-0">
                {i < 3 ? MEDALS[i] : <span className="text-[2.8cqw] font-bold text-cream-500">{i + 1}</span>}
              </span>
              <div className="w-[5.5cqw] h-[5.5cqw] rounded-full bg-cream-200 border border-cream-300 overflow-hidden shrink-0">
                <img
                  src={entry.avatarUrl || '/images/icons/anonymous.svg'}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <span className={`text-[2.8cqw] truncate flex-1 ${isMe ? 'text-forest' : 'text-cream-800'}`}>
                {displayName}
              </span>
              <span className={`text-[2.8cqw] font-bold shrink-0 ${profit >= 0 ? 'text-forest' : 'text-[#C0392B]'}`}>
                {formatProfit(profit)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
