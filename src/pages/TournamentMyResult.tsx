import { useEffect, useState } from 'react';
import { EliminationOverlay } from '../components/EliminationOverlay';
import type { HandSummaryForResult } from '../components/EliminationOverlay';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface MyResultData {
  tournamentName: string;
  position: number | null;
  totalPlayers: number;
  prizeAmount: number;
  playerName?: string;
}

interface HandStatsData {
  lastHand: HandSummaryForResult | null;
  bestHand: HandSummaryForResult | null;
  worstHand: HandSummaryForResult | null;
  totalHands: number;
}

interface TournamentMyResultProps {
  tournamentId: string;
  onBack: () => void;
}

export function TournamentMyResult({ tournamentId, onBack }: TournamentMyResultProps) {
  const [result, setResult] = useState<MyResultData | null>(null);
  const [handStats, setHandStats] = useState<HandStatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 順位カードとハンド統計は別々に取得する。
  // ハンド統計は重いクエリになりうるため、待ち合わせると順位表示まで巻き添えで遅れ、
  // 最悪ローディングのまま画面が固まる。統計は「後から埋まる付加情報」として扱う。
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetchWithTimeout(
          `${API_BASE}/api/tournaments/${tournamentId}/my-result`,
          { credentials: 'include' },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data: MyResultData = await res.json();
        if (!cancelled) setResult(data);
      } catch (err) {
        if (cancelled) return;
        const isTimeout = err instanceof DOMException && err.name === 'AbortError';
        setError(isTimeout ? '結果の取得に時間がかかっています' : (err instanceof Error ? err.message : '取得に失敗しました'));
      }
    })();

    (async () => {
      try {
        const res = await fetchWithTimeout(
          `${API_BASE}/api/tournaments/${tournamentId}/my-hand-stats`,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const stats: HandStatsData = await res.json();
        if (!cancelled) setHandStats(stats);
      } catch {
        // 統計は取れなくても順位カードは表示する
      }
    })();

    return () => { cancelled = true; };
  }, [tournamentId]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-h-0 light-bg px-[4cqw]">
        <p className="text-cream-700 text-[3.5cqw] mb-[4cqw]">{error}</p>
        <button
          type="button"
          onClick={onBack}
          className="px-[6cqw] py-[2.5cqw] bg-forest hover:bg-forest-light text-white rounded-[2cqw] font-bold text-[3.5cqw] transition-colors"
        >
          戻る
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-h-0 light-bg px-[4cqw]">
        <Loader2 className="w-[8cqw] h-[8cqw] animate-spin text-cream-700" />
        {/* 取得が長引いても画面から抜けられるようにする（無反応に見える状態を作らない） */}
        <button
          type="button"
          onClick={onBack}
          className="mt-[6cqw] px-[6cqw] py-[2.5cqw] text-cream-700 underline text-[3.2cqw]"
        >
          トーナメント一覧に戻る
        </button>
      </div>
    );
  }

  // レイト登録中は順位未確定 → プレイスカードではなく「集計中」表示
  if (result.position === null) {
    return (
      <div className="relative h-full w-full min-h-0 light-bg flex flex-col items-center justify-center px-[6cqw]">
        <div className="bg-white rounded-[2cqw] shadow-[0_4px_24px_rgba(0,0,0,0.12)] w-full max-w-[88cqw] px-[6cqw] py-[10cqw] text-center">
          <div className="text-red-600 font-black text-[6cqw] mb-[2cqw]">Busted</div>
          <div className="text-cream-700 text-[3.2cqw] leading-relaxed">
            順位はレイト登録締切後に確定します
          </div>
          {result.tournamentName && (
            <div className="text-cream-700 text-[3cqw] mt-[4cqw] border-t border-cream-300 pt-[3cqw]">
              {result.tournamentName}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="w-full max-w-[88cqw] mt-[4cqw] py-[3cqw] bg-forest hover:bg-forest-light text-white rounded-[2cqw] font-bold text-[3.5cqw] transition-colors shadow-[0_4px_20px_rgba(45,90,61,0.3)]"
        >
          トーナメント一覧に戻る
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full min-h-0 light-bg">
      <EliminationOverlay
        position={result.position}
        totalPlayers={result.totalPlayers}
        prizeAmount={result.prizeAmount}
        tournamentName={result.tournamentName}
        playerName={result.playerName}
        handStats={handStats ?? undefined}
        closeLabel="トーナメント一覧に戻る"
        onClose={onBack}
      />
    </div>
  );
}
