import { useEffect, useState } from 'react';
import { fetchRankings } from '../utils/rankingsCache';
import { formatProfit } from './RankingPopup';
import type { RankingEntry } from './RankingPopup';

interface Champion {
  userId: string;
  username: string;
  avatarUrl: string | null;
  awardedAt: string;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** バッジ付与日から、その週の月曜〜日曜の範囲を表示 */
function getWeekLabel(awardedAt: string): string {
  const awarded = new Date(awardedAt);
  const sunday = new Date(awarded);
  sunday.setDate(sunday.getDate() - 1);
  const monday = new Date(sunday);
  monday.setDate(monday.getDate() - 6);

  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(monday)} - ${fmt(sunday)}`;
}

/** weekOffset から対象週の月曜〜日曜の範囲ラベルを生成 */
function getWeekRangeLabel(weekOffset: number): string {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(monday.getDate() - diffToMonday - 7 * weekOffset);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(monday)} ~ ${fmt(sunday)}`;
}

/** プルダウン用の週リスト（今週 + 過去11週 = 計12週） */
function buildWeekOptions(): { value: number; label: string }[] {
  return Array.from({ length: 12 }, (_, i) => ({
    value: i,
    label: i === 0 ? `今週 (${getWeekRangeLabel(0)})` : getWeekRangeLabel(i),
  }));
}

export function WeeklyChampions() {
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    const apiBase = import.meta.env.VITE_SERVER_URL || '';
    fetch(`${apiBase}/api/stats/weekly-champions`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => setChampions(data.champions ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || champions.length === 0) return null;

  return (
    <>
      <div
        className="mt-[3cqw] bg-white border border-cream-300 rounded-[3cqw] px-[4cqw] py-[3cqw] shadow-[0_2px_8px_rgba(139,126,106,0.12)] cursor-pointer hover:bg-cream-50 transition-colors"
        onClick={() => setShowDialog(true)}
      >
        <div className="flex items-center justify-between mb-[2cqw]">
          <span className="text-[3cqw] font-bold text-cream-900">最近のチャンピオン</span>
          <span className="text-[2.5cqw] text-cream-400">もっと見る &gt;</span>
        </div>
        <div className="grid grid-cols-3 gap-[1.5cqw]">
          {champions.map((c, i) => (
            <div key={`${c.userId}-${i}`} className="flex flex-col min-w-0">
              <span className="text-[1.8cqw] text-cream-700 mb-[0.5cqw] text-center">{getWeekLabel(c.awardedAt)}</span>
              <div className="flex items-center gap-[1.5cqw]">
                <div className="w-[5cqw] h-[5cqw] rounded-full bg-cream-200 border border-cream-300 overflow-hidden shrink-0">
                  <img
                    src={c.avatarUrl || '/images/icons/anonymous.svg'}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-[2.3cqw] font-bold text-cream-900 truncate">{c.username}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showDialog && (
        <WeeklyRankingDialog onClose={() => setShowDialog(false)} />
      )}
    </>
  );
}

function WeeklyRankingDialog({ onClose }: { onClose: () => void }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const weekOptions = buildWeekOptions();

  useEffect(() => {
    setLoading(true);
    fetchRankings('weekly', weekOffset)
      .then(setRankings)
      .catch(() => setRankings([]))
      .finally(() => setLoading(false));
  }, [weekOffset]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const sorted = [...rankings]
    .sort((a, b) => b.totalAllInEVProfit - a.totalAllInEVProfit)
    .slice(0, 10);

  return (
    <div className="absolute inset-0 z-[200] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-[92%] h-[90%] bg-white rounded-[4cqw] shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-[4cqw] pt-[4cqw] pb-[2cqw] border-b border-cream-200">
          <div className="flex items-center justify-between mb-[2cqw]">
            <h2 className="text-[4cqw] font-bold text-cream-900">週間ランキング</h2>
            <button
              onClick={onClose}
              className="text-[5cqw] text-cream-400 hover:text-cream-700 leading-none"
            >
              &times;
            </button>
          </div>
          <select
            value={weekOffset}
            onChange={e => setWeekOffset(Number(e.target.value))}
            className="w-full px-[3cqw] py-[2cqw] text-[3cqw] border border-cream-300 rounded-[2cqw] bg-cream-50 text-cream-900"
          >
            {weekOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-[4cqw] py-[3cqw]">
          {loading ? (
            <div className="flex justify-center py-[6cqw]">
              <div className="w-[6cqw] h-[6cqw] border-[0.5cqw] border-cream-300 border-t-cream-600 rounded-full animate-spin" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-center text-cream-500 text-[3cqw] py-[6cqw]">データがありません</p>
          ) : (
            <div className="space-y-[2cqw]">
              {sorted.map((entry, i) => {
                const profit = entry.totalAllInEVProfit;
                return (
                  <div key={entry.userId} className="flex items-center gap-[2cqw]">
                    <span className="text-[3.5cqw] w-[5cqw] text-center shrink-0">
                      {i < 3 ? MEDALS[i] : <span className="text-[2.8cqw] font-bold text-cream-500">{i + 1}</span>}
                    </span>
                    <div className="w-[6cqw] h-[6cqw] rounded-full bg-cream-200 border border-cream-300 overflow-hidden shrink-0">
                      <img
                        src={entry.avatarUrl || '/images/icons/anonymous.svg'}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[3cqw] text-cream-800 truncate">{entry.username}</span>
                      <span className="text-[2.2cqw] text-cream-500">{entry.handsPlayed} hands</span>
                    </div>
                    <span className={`text-[3cqw] font-bold shrink-0 ${profit >= 0 ? 'text-forest' : 'text-[#C0392B]'}`}>
                      {formatProfit(profit)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
