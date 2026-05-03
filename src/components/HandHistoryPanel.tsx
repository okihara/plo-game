import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { HandDetailDialog } from './HandDetailDialog';
import type { HandDetail, HandDetailPlayer } from './HandDetailDialog';
import { evaluateCurrentHand } from '../logic/handEvaluator';
import type { Card } from '../logic/types';
import { MiniCard, ProfitDisplay, PositionBadge, getPositionName, parseBB } from './HandHistoryUtils';
import { toPokerStarsText } from '../utils/pokerStarsFormat';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const PAGE_SIZE = 20;

interface HandSummary {
  id: string;
  handNumber: number;
  blinds: string;
  communityCards: string[];
  /** Double Board Bomb Pot のセカンドボード。空配列なら通常ハンド扱い。 */
  communityCards2?: string[];
  potSize: number;
  profit: number;
  finalHand: string | null;
  holeCards: string[];
  isWinner: boolean;
  dealerPosition: number;
  createdAt: string;
  players: HandDetailPlayer[];
}

interface TournamentOption {
  id: string;
  name: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface HandHistoryPanelProps {
  onClose?: () => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
}


function HandSummaryCard({
  hand,
  onClick,
  bb,
}: {
  hand: HandSummary;
  onClick: () => void;
  bb?: number;
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
            const isBombPot = hand.communityCards2 != null && hand.communityCards2.length > 0;
            let name: string | null | undefined = hand.finalHand;
            if (!name) {
              if (isBombPot && hand.holeCards.length === 4
                  && hand.communityCards.length >= 3 && hand.communityCards2!.length >= 3) {
                try {
                  const h1 = evaluateCurrentHand(
                    hand.holeCards.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
                    hand.communityCards.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
                  )?.name;
                  const h2 = evaluateCurrentHand(
                    hand.holeCards.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
                    hand.communityCards2!.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
                  )?.name;
                  name = h1 && h2 ? `B1: ${h1} / B2: ${h2}` : (h1 ?? h2 ?? null);
                } catch { name = null; }
              } else if ((hand.holeCards.length === 4 || hand.holeCards.length === 5) && hand.communityCards.length >= 3) {
                name = evaluateCurrentHand(
                  hand.holeCards.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
                  hand.communityCards.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
                )?.name;
              }
            }
            return name ? <span className="text-cream-800 text-[2.5cqw] font-medium">{name}</span> : null;
          })()}
        </div>
        <ProfitDisplay profit={hand.profit} size="large" bb={bb} />
      </div>
      {/* Row 2: cards (bomb pot は board 1/2 を 2 段表示) */}
      {(() => {
        const isBombPot = hand.communityCards2 != null && hand.communityCards2.length > 0;
        if (isBombPot) {
          return (
            <div className="flex flex-col gap-[0.6cqw]">
              <div className="flex items-center gap-[0.6cqw]">
                {hand.holeCards.map((c, i) => (
                  <MiniCard key={i} cardStr={c} />
                ))}
              </div>
              <div className="flex items-center gap-[0.6cqw]">
                <span className="text-cream-700 text-[2.4cqw] font-bold w-[5cqw] shrink-0">B1</span>
                {hand.communityCards.map((c, i) => (
                  <MiniCard key={`b1-${i}`} cardStr={c} />
                ))}
              </div>
              <div className="flex items-center gap-[0.6cqw]">
                <span className="text-cream-700 text-[2.4cqw] font-bold w-[5cqw] shrink-0">B2</span>
                {hand.communityCards2!.map((c, i) => (
                  <MiniCard key={`b2-${i}`} cardStr={c} />
                ))}
              </div>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-[0.6cqw]">
            {hand.holeCards.map((c, i) => (
              <MiniCard key={i} cardStr={c} />
            ))}
            {hand.communityCards.length > 0 && (
              <>
                <span className="text-cream-700 mx-[1.5cqw] text-[4cqw] font-light">|</span>
                {hand.communityCards.map((c, i) => (
                  <MiniCard key={`cc-${i}`} cardStr={c} />
                ))}
              </>
            )}
          </div>
        );
      })()}
    </button>
  );
}

type GameType = 'cash' | 'tournament';
type DisplayUnit = 'chips' | 'bb';

export function HandHistoryPanel({ onClose }: HandHistoryPanelProps = {}) {
  const { user } = useAuth();
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [selectedHand, setSelectedHand] = useState<HandDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [gameType, setGameType] = useState<GameType>('cash');
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>('chips');
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>('');

  const switchTab = (type: GameType) => {
    if (type === gameType) return;
    setGameType(type);
    setSelectedTournamentId('');
    setHands([]);
    setTotal(0);
    setOffset(0);
  };

  const [exporting, setExporting] = useState(false);

  const selectTournament = (tournamentId: string) => {
    setSelectedTournamentId(tournamentId);
    setHands([]);
    setTotal(0);
    setOffset(0);
  };

  const exportTournamentHands = async () => {
    if (!selectedTournamentId) return;
    setExporting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/history/tournaments/${selectedTournamentId}/export`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data = await res.json();
      const text = (data.hands as HandDetail[]).map(h => toPokerStarsText(h)).join('\n\n\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const tournament = tournaments.find(t => t.id === selectedTournamentId);
      a.href = url;
      a.download = `${tournament?.name ?? 'tournament'}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export:', err);
    } finally {
      setExporting(false);
    }
  };

  // トーナメントタブ選択時にトーナメント一覧を取得
  useEffect(() => {
    if (!user || gameType !== 'tournament') return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/history/tournaments`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        setTournaments(data.tournaments);
      } catch (err) {
        console.error('Failed to fetch tournaments:', err);
      }
    })();
  }, [user, gameType]);

  const fetchHands = async (offsetVal: number, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offsetVal),
      gameType,
    });
    if (selectedTournamentId) params.set('tournamentId', selectedTournamentId);

    try {
      const res = await fetch(
        `${API_BASE}/api/history?${params}`,
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
  }, [user, gameType, selectedTournamentId]);

  if (!user) {
    return (
      <div className="h-full light-bg flex items-center justify-center">
        <div className="text-center">
          <p className="text-cream-700 mb-[4cqw] text-[3cqw]">ログインするとハンド履歴を確認できます</p>
          {onClose && (
            <button onClick={onClose} className="text-cream-700 hover:text-cream-900 transition-colors text-[3cqw]">
              閉じる
            </button>
          )}
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
            {onClose && (
              <button onClick={onClose} className="text-cream-700 hover:text-cream-900 mr-[2.5cqw] text-[3cqw] font-medium transition-colors">
                &larr; 戻る
              </button>
            )}
            <h1 className="text-cream-900 font-bold text-[4cqw] tracking-tight">ハンド履歴</h1>
            <div className="ml-auto flex items-center gap-[2cqw]">
              <button
                onClick={() => setDisplayUnit(u => u === 'chips' ? 'bb' : 'chips')}
                className={`px-[2cqw] py-[0.8cqw] rounded-[1.2cqw] text-[2.5cqw] font-bold transition-colors ${
                  displayUnit === 'bb'
                    ? 'bg-cream-900 text-cream-100'
                    : 'bg-cream-200 text-cream-700 active:bg-cream-300'
                }`}
              >
                BB表示
              </button>
              <span className="text-cream-700 text-[3cqw] font-medium">{total}件</span>
            </div>
          </div>
          <div className="flex border-b border-cream-300">
            {([['cash', 'リング'], ['tournament', 'トーナメント']] as const).map(([type, label]) => (
              <button
                key={type}
                onClick={() => switchTab(type)}
                className={`flex-1 py-[2.5cqw] text-[3cqw] font-semibold transition-colors ${
                  gameType === type
                    ? 'text-forest border-b-[0.5cqw] border-forest'
                    : 'text-cream-700 hover:text-cream-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {gameType === 'tournament' && tournaments.length > 0 && (
            <div className="px-[4cqw] py-[2cqw] border-b border-cream-300 flex items-center gap-[2cqw]">
              <select
                value={selectedTournamentId}
                onChange={e => selectTournament(e.target.value)}
                className="flex-1 min-w-0 bg-white border border-cream-300 rounded-[2cqw] px-[3cqw] py-[2cqw] text-[3cqw] text-cream-900 appearance-none"
                style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
              >
                <option value="">すべてのトーナメント</option>
                {tournaments.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {selectedTournamentId && (
                <button
                  onClick={exportTournamentHands}
                  disabled={exporting}
                  className="shrink-0 px-[3cqw] py-[2cqw] bg-forest text-white rounded-[2cqw] text-[2.8cqw] font-semibold transition-colors hover:bg-forest/90 active:bg-forest/80 disabled:opacity-50"
                >
                  {exporting ? '...' : 'Export'}
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-[20cqw]">
            <div className="w-[7cqw] h-[7cqw] border-[0.4cqw] border-cream-300 border-t-forest rounded-full animate-spin" />
          </div>
        ) : hands.length === 0 ? (
          <div className="text-center text-cream-700 py-[20cqw] text-[3cqw]">
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
                  bb={displayUnit === 'bb' ? parseBB(hand.blinds) : undefined}
                />
              ))}
            </div>

            {hands.length < total && (
              <div className="px-[4cqw] pb-[18cqw]">
                <button
                  onClick={() => fetchHands(offset + PAGE_SIZE, true)}
                  disabled={loadingMore}
                  className="w-full py-[3cqw] text-cream-700 hover:text-cream-900 bg-white hover:bg-cream-50 rounded-[2.5cqw] transition-all text-[3cqw] border border-cream-300 hover:border-cream-400"
                >
                  {loadingMore ? '読み込み中...' : 'もっと読む'}
                </button>
              </div>
            )}
            {hands.length >= total && (
              <div className="pb-[18cqw]" />
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
