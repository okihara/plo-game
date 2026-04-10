import { useEffect, useState } from 'react';
import { ChevronLeft, Loader2, Trophy } from 'lucide-react';
import type { TournamentRankingEntry } from '@plo/shared';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface TournamentRankingProps {
  onBack: () => void;
}

interface RankingResponse {
  rankings: TournamentRankingEntry[];
  pointsTable: number[];
}

function rankBadge(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

export function TournamentRanking({ onBack }: TournamentRankingProps) {
  const [data, setData] = useState<RankingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tournaments/rankings`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: RankingResponse = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '取得に失敗しました');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="h-full w-full light-bg text-cream-900 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-[2cqw] px-[4cqw] py-[3cqw] border-b border-cream-300">
        <button
          type="button"
          onClick={onBack}
          className="p-[1.5cqw] rounded-[2cqw] hover:bg-cream-200 transition-colors"
        >
          <ChevronLeft className="w-[5cqw] h-[5cqw]" />
        </button>
        <Trophy className="w-[5cqw] h-[5cqw] text-amber-500 shrink-0" />
        <h1 className="text-[4.5cqw] font-bold text-cream-900">トーナメント総合ランキング</h1>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <div className="px-[4cqw] py-[4cqw] text-center text-[3.5cqw] text-cream-700">
            {error}
          </div>
        )}

        {!error && !data && (
          <div className="flex items-center justify-center py-[20cqw]">
            <Loader2 className="w-[6cqw] h-[6cqw] animate-spin text-cream-700 shrink-0" />
            <span className="ml-[2cqw] text-[3cqw] text-cream-700">読み込み中...</span>
          </div>
        )}

        {data && (
          <>
            {/* Points table explainer */}
            <div className="mx-[4cqw] mt-[3cqw] px-[3cqw] py-[2.5cqw] bg-white rounded-[2cqw] border border-cream-200 shadow-[0_2px_8px_rgba(139,126,106,0.12)]">
              <div className="text-[2.8cqw] text-cream-700 mb-[1cqw]">
                各トーナメントの上位 {data.pointsTable.length} 人にポイント付与 → 合算で順位決定
              </div>
              <div className="flex flex-wrap gap-[1.5cqw]">
                {data.pointsTable.map((pts, idx) => (
                  <span
                    key={idx}
                    className="text-[2.6cqw] px-[1.5cqw] py-[0.4cqw] rounded-full bg-cream-100 text-cream-800 tabular-nums"
                  >
                    {idx + 1}位 {pts}
                  </span>
                ))}
              </div>
            </div>

            {data.rankings.length === 0 ? (
              <div className="text-center py-[16cqw] text-[3cqw] text-cream-700">
                <Trophy className="w-[12cqw] h-[12cqw] mx-auto mb-[3cqw] opacity-30" />
                <p>まだランキングはありません</p>
              </div>
            ) : (
              <div className="px-[4cqw] py-[3cqw] space-y-[1.5cqw] pb-[6cqw]">
                {data.rankings.map((entry) => (
                  <div
                    key={entry.userId}
                    className="flex items-center gap-[2.5cqw] py-[2.5cqw] px-[3cqw] rounded-[2cqw] bg-white border border-cream-200 shadow-[0_2px_8px_rgba(139,126,106,0.12)]"
                  >
                    {/* Rank */}
                    <div className="w-[9cqw] text-center shrink-0">
                      {rankBadge(entry.rank) ? (
                        <span className="text-[5cqw]">{rankBadge(entry.rank)}</span>
                      ) : (
                        <span className="text-[4cqw] font-bold tabular-nums text-cream-700">
                          {entry.rank}
                        </span>
                      )}
                    </div>

                    {/* Avatar + Name */}
                    <div className="flex items-center gap-[2.5cqw] flex-1 min-w-0">
                      <div className="w-[10cqw] h-[10cqw] rounded-full bg-cream-200 border border-cream-300 overflow-hidden shrink-0">
                        <img
                          src={entry.avatarUrl || '/images/icons/anonymous.svg'}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[4cqw] text-cream-800 truncate block">
                          {entry.username}
                        </span>
                        <span className="text-[2.6cqw] text-cream-700">
                          入賞 {entry.tournamentsCashed}回
                          {entry.firstPlaces > 0 && ` ・ 優勝 ${entry.firstPlaces}回`}
                        </span>
                      </div>
                    </div>

                    {/* Points */}
                    <div className="text-right shrink-0">
                      <div className="text-[5cqw] font-bold text-forest tabular-nums leading-none">
                        {entry.totalPoints.toLocaleString()}
                      </div>
                      <div className="text-[2.4cqw] text-cream-700 mt-[0.3cqw]">pts</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
