import { useEffect, useState } from 'react';
import { Share2, Link, Check } from 'lucide-react';
import { ProfitChart } from '../components/ProfitChart';
import { buildStatsShareText, openXShare } from '../utils/share';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface PlayerStats {
  handsPlayed: number;
  winRate: number;
  totalProfit: number;
  totalAllInEVProfit: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  fourBet: number;
  afq: number;
  cbet: number;
  foldToCbet: number;
  foldTo3Bet: number;
  wtsd: number;
  wsd: number;
}

interface DisplayBadge {
  category: string;
  type: string;
  label: string;
  description: string;
  flavor: string;
  imageUrl: string;
  count: number;
  awardedAt: string;
}

interface PlayerProfileProps {
  userId: string;
  onBack: () => void;
}

function formatProfit(profit: number): string {
  const sign = profit >= 0 ? '+' : '';
  return `${sign}${profit.toLocaleString()}`;
}

function formatRate(rate: number): string {
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${rate.toFixed(1)}`;
}

export function PlayerProfile({ userId, onBack }: PlayerProfileProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [badges, setBadges] = useState<DisplayBadge[]>([]);
  const [profitHistory, setProfitHistory] = useState<{ p: number; c: number; s: number; n: number; e: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);

  const shareUrl = `${window.location.origin}/player/${userId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    setShowShareMenu(false);
  };

  const handleShareX = () => {
    openXShare(buildStatsShareText(playerName ?? 'Player'), shareUrl);
    setShowShareMenu(false);
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/stats/${userId}`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : null)
        .catch(() => null),
      fetch(`${API_BASE}/api/stats/${userId}/profit-history`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : null)
        .catch(() => null),
    ]).then(([statsData, historyData]) => {
      if (statsData?.stats) setStats(statsData.stats);
      if (statsData?.badges) setBadges(statsData.badges);
      if (statsData?.displayName) setPlayerName(statsData.displayName);
      if (historyData?.points) setProfitHistory(historyData.points);
    }).finally(() => setLoading(false));
  }, [userId]);

  return (
    <div className="flex flex-col h-full bg-cream-200">
      {/* Header */}
      <div className="@container w-full shrink-0">
        <div className="flex items-center justify-between px-[4cqw] py-[3cqw]">
          <div className="flex items-center">
            <button
              onClick={onBack}
              className="text-cream-700 text-[3.5cqw] font-bold mr-[3cqw]"
            >
              ← 戻る
            </button>
            <h1 className="text-[4cqw] font-bold text-cream-900 truncate">プレイヤースタッツ</h1>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowShareMenu(v => !v)}
              className="w-[8cqw] h-[8cqw] flex items-center justify-center rounded-full bg-cream-100 active:bg-cream-300"
            >
              <Share2 className="w-[4cqw] h-[4cqw] text-cream-700" />
            </button>
            {showShareMenu && (
              <>
                <div className="fixed inset-0 z-[299]" onClick={() => setShowShareMenu(false)} />
                <div className="absolute right-0 top-full mt-[1cqw] z-[300] bg-white border border-cream-300 rounded-[2cqw] shadow-lg overflow-hidden min-w-[40cqw]">
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center gap-[2cqw] w-full px-[3cqw] py-[2.5cqw] text-[3cqw] text-cream-900 hover:bg-cream-100 active:bg-cream-200"
                  >
                    {copied ? <Check className="w-[4cqw] h-[4cqw] text-forest" /> : <Link className="w-[4cqw] h-[4cqw]" />}
                    {copied ? 'コピーしました' : 'リンクをコピー'}
                  </button>
                  <button
                    onClick={handleShareX}
                    className="flex items-center gap-[2cqw] w-full px-[3cqw] py-[2.5cqw] text-[3cqw] text-cream-900 hover:bg-cream-100 active:bg-cream-200 border-t border-cream-200"
                  >
                    <svg className="w-[4cqw] h-[4cqw]" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    X でシェア
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="@container w-full flex-1 overflow-y-auto">
        <div className="px-[4cqw] pb-[4cqw]">

          {/* Badges */}
          {badges.length > 0 && (
            <div className="flex gap-[2cqw] mb-[3cqw]">
              {badges.map((badge) => (
                <div key={badge.type} className="flex flex-col items-center">
                  <div className="relative w-[11cqw] h-[11cqw]">
                    <div className="w-full h-full rounded-full bg-cream-100 border border-cream-300 overflow-hidden">
                      <img src={badge.imageUrl} alt={badge.label} className="w-full h-full object-cover" />
                    </div>
                    {badge.count > 1 && (
                      <span className="absolute -top-[0.5cqw] -right-[1cqw] bg-cream-900 text-white text-[1.8cqw] font-bold rounded-full min-w-[3.5cqw] h-[3.5cqw] flex items-center justify-center px-[0.3cqw]">
                        ×{badge.count}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Stats Card */}
          <div className="bg-cream-100 rounded-[3cqw] p-[3.5cqw]">
            {loading ? (
              <div className="flex flex-col items-center py-[6cqw]">
                <div className="w-[5cqw] h-[5cqw] border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
                <p className="text-cream-500 text-[2.5cqw] mt-[1.5cqw]">読み込み中...</p>
              </div>
            ) : stats ? (
              <>
                {/* 収支セクション */}
                <div className="grid grid-cols-3 gap-x-[2cqw] gap-y-[1.5cqw] mb-[2.5cqw]">
                  <StatItem label="総ハンド数" value={stats.handsPlayed.toLocaleString()} />
                  <StatItem label="実収支" value={formatProfit(stats.totalProfit)} color={stats.totalProfit >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                  <StatItem label="Win Rate" value={formatRate(stats.winRate)} color={stats.winRate >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                  <div />
                  <StatItem label="収支 (EV)" value={formatProfit(stats.totalAllInEVProfit ?? stats.totalProfit)} color={(stats.totalAllInEVProfit ?? stats.totalProfit) >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                  <StatItem label="Win Rate (EV)" value={formatRate((stats.totalAllInEVProfit ?? stats.totalProfit) / stats.handsPlayed)} color={(stats.totalAllInEVProfit ?? stats.totalProfit) >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                </div>
                {/* ポーカースタッツ */}
                <div className="grid grid-cols-4 gap-x-[1.5cqw] gap-y-[1.5cqw]">
                  <StatItem label="VPIP" value={`${stats.vpip.toFixed(1)}%`} />
                  <StatItem label="PFR" value={`${stats.pfr.toFixed(1)}%`} />
                  <StatItem label="3Bet" value={`${stats.threeBet.toFixed(1)}%`} />
                  <StatItem label="4Bet" value={`${stats.fourBet.toFixed(1)}%`} />
                  <StatItem label="AFq" value={`${stats.afq.toFixed(1)}%`} />
                  <StatItem label="CBet" value={`${stats.cbet.toFixed(1)}%`} />
                  <StatItem label="Fold to CB" value={`${stats.foldToCbet.toFixed(1)}%`} />
                  <StatItem label="Fold to 3B" value={`${stats.foldTo3Bet.toFixed(1)}%`} />
                </div>
              </>
            ) : (
              <p className="text-cream-500 text-[3cqw] text-center py-[6cqw]">
                スタッツはまだありません
              </p>
            )}
          </div>

          {/* Profit Chart */}
          {!loading && profitHistory.length >= 2 && (
            <div className="bg-cream-100 rounded-[3cqw] p-[3.5cqw] mt-[2cqw]">
              <ProfitChart points={profitHistory} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <div className="text-cream-600 text-[2.5cqw] mb-[0.5cqw]">{label}</div>
      <div className={`text-[4.5cqw] font-bold ${color || 'text-cream-900'}`}>{value}</div>
    </div>
  );
}
