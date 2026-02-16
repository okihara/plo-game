import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { evaluatePLOHand } from '../logic/handEvaluator';
import type { Card } from '../logic/types';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const PAGE_SIZE = 20;

const SUIT_SYMBOLS: Record<string, string> = {
  h: '\u2665', d: '\u2666', c: '\u2663', s: '\u2660',
};
const SUIT_COLORS: Record<string, string> = {
  h: 'text-red-500', d: 'text-blue-400', c: 'text-green-700', s: 'text-gray-800',
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

interface HandDetailPlayer {
  username: string;
  avatarUrl: string | null;
  seatPosition: number;
  holeCards: string[];
  finalHand: string | null;
  profit: number;
  isCurrentUser: boolean;
}

interface HandDetailAction {
  seatIndex: number;
  odId: string;
  odName: string;
  action: string;
  amount: number;
  street?: string;
}

interface HandDetail {
  id: string;
  handNumber: number;
  blinds: string;
  communityCards: string[];
  potSize: number;
  winners: string[];
  actions: HandDetailAction[];
  dealerPosition: number;
  createdAt: string;
  players: HandDetailPlayer[];
}

interface HandHistoryPanelProps {
  onClose: () => void;
}

function MiniCard({ cardStr }: { cardStr: string }) {
  const rank = cardStr.slice(0, -1);
  const suit = cardStr.slice(-1);
  const symbol = SUIT_SYMBOLS[suit] || suit;
  const color = SUIT_COLORS[suit] || 'text-white';

  return (
    <span className={`inline-flex items-center justify-center w-9 h-12 bg-white/90 rounded text-sm font-bold shadow-sm ${color}`}>
      {rank}{symbol}
    </span>
  );
}

function ProfitDisplay({ profit }: { profit: number }) {
  if (profit > 0) {
    return <span className="text-green-400 font-bold">+{profit}</span>;
  }
  if (profit < 0) {
    return <span className="text-red-400 font-bold">-{Math.abs(profit)}</span>;
  }
  return <span className="text-white/40">0</span>;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
}

function getPositionName(seatPosition: number, dealerPosition: number, allSeatPositions: number[]): string {
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

function parseCard(s: string): Card {
  return { rank: s.slice(0, -1) as Card['rank'], suit: s.slice(-1) as Card['suit'] };
}

function getHandName(holeCards: string[], communityCards: string[]): string {
  if (holeCards.length !== 4 || communityCards.length !== 5) return '';
  try {
    return evaluatePLOHand(holeCards.map(parseCard), communityCards.map(parseCard)).name;
  } catch {
    return '';
  }
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    fold: 'Fold', check: 'Check', call: 'Call',
    bet: 'Bet', raise: 'Raise', allin: 'All-in',
  };
  return map[action] || action;
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
      className="w-full text-left bg-white/5 hover:bg-white/10 rounded-xl p-3 border border-white/10 hover:border-white/20 transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-xs">#{hand.handNumber}</span>
          {(() => {
            const me = hand.players.find(p => p.isCurrentUser);
            const pos = me ? getPositionName(me.seatPosition, hand.dealerPosition, hand.players.map(p => p.seatPosition)) : '';
            return pos ? <span className="bg-white/10 text-white/60 text-xs font-bold px-1.5 py-0.5 rounded">{pos}</span> : null;
          })()}
          <span className="text-white/70 text-sm">{hand.blinds}</span>
          <span className="text-white/40 text-xs">Pot {hand.potSize}</span>
        </div>
        <div className="flex items-center gap-2">
          <ProfitDisplay profit={hand.profit} />
          <span className="text-white/30 text-xs">{formatDate(hand.createdAt)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {hand.holeCards.map((c, i) => (
          <MiniCard key={i} cardStr={c} />
        ))}
        {hand.communityCards.length > 0 && (
          <>
            <span className="text-white/20 mx-1">|</span>
            {hand.communityCards.map((c, i) => (
              <MiniCard key={`cc-${i}`} cardStr={c} />
            ))}
          </>
        )}
      </div>
      {hand.finalHand && (
        <div className="mt-1">
          <span className="text-yellow-400/80 text-xs">{hand.finalHand}</span>
        </div>
      )}
    </button>
  );
}

function HandDetailDialog({
  hand,
  onClose,
}: {
  hand: HandDetail;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-[95%] max-h-[85%] bg-gray-900 rounded-2xl border border-white/20 overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center justify-between z-10 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <h1 className="text-white font-bold text-lg">
              Hand #{hand.handNumber}
            </h1>
            <span className="text-white/50">{hand.blinds}</span>
            <span className="text-white/30 text-sm">{new Date(hand.createdAt).toLocaleString('ja-JP')}</span>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        <div className="p-3 space-y-3">
          {/* プレイヤー */}
          <div className="space-y-1.5">
            {hand.players
              .sort((a, b) => (a.isCurrentUser ? -1 : b.isCurrentUser ? 1 : 0))
              .map((p, i) => {
                const allSeats = hand.players.map(pl => pl.seatPosition);
                const pos = getPositionName(p.seatPosition, hand.dealerPosition, allSeats);
                return (
                <div
                  key={i}
                  className={`bg-white/5 rounded-lg px-3 py-2 border ${
                    p.isCurrentUser ? 'border-cyan-500/30' : 'border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      {pos && <span className="bg-white/10 text-white/60 text-sm font-bold px-1.5 py-0.5 rounded">{pos}</span>}
                      {p.avatarUrl && (
                        <img src={p.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
                      )}
                      <span className={`font-medium ${p.isCurrentUser ? 'text-cyan-400' : 'text-white/80'}`}>
                        {p.username}
                      </span>
                    </div>
                    <ProfitDisplay profit={p.profit} />
                  </div>
                  <div className="flex items-center gap-1">
                    {p.holeCards.map((c, j) => (
                      <MiniCard key={j} cardStr={c} />
                    ))}
                    {p.finalHand && (
                      <span className="ml-2 text-yellow-400/80 text-sm">{p.finalHand}</span>
                    )}
                  </div>
                </div>
              );
              })}
          </div>

          {/* アクション履歴（ストリートごと） */}
          <div className="bg-white/5 rounded-xl px-3 py-3 border border-white/10">
            <div className="space-y-0.5">
              {(() => {
                const streets = ['preflop', 'flop', 'turn', 'river'];
                const streetLabels: Record<string, string> = {
                  preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River',
                };
                const cc = hand.communityCards;
                const streetCards: Record<string, string[]> = {
                  flop: cc.slice(0, 3),
                  turn: cc.slice(3, 4),
                  river: cc.slice(4, 5),
                };
                // ストリート開始時のポット額を計算
                const streetStartPot: Record<string, number> = {};
                let cumPot = 0;
                let prevStreet = '';
                for (const a of hand.actions) {
                  const s = a.street || 'preflop';
                  if (s !== prevStreet) {
                    streetStartPot[s] = cumPot;
                    prevStreet = s;
                  }
                  cumPot += a.amount;
                }
                let lastStreet = '';
                let isFirstHeader = true;
                return hand.actions.map((a, i) => {
                  const street = a.street || 'preflop';
                  const showHeader = street !== lastStreet && streets.includes(street);
                  lastStreet = street;
                  const headerMargin = showHeader && !isFirstHeader;
                  if (showHeader) isFirstHeader = false;
                  return (
                    <div key={i}>
                      {showHeader && (
                        <div className={headerMargin ? 'mt-4 mb-1' : 'mb-1'}>
                          <div className="flex items-center gap-2">
                            <span className="text-white/50 text-sm font-bold">{streetLabels[street] || street}</span>
                            {streetStartPot[street] > 0 && (
                              <span className="text-white/30 text-sm">Pot {streetStartPot[street]}</span>
                            )}
                          </div>
                          {streetCards[street]?.length > 0 && (
                            <div className="flex gap-0.5 mt-0.5">
                              {streetCards[street].map((c, j) => (
                                <MiniCard key={j} cardStr={c} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center py-0.5">
                        <span className="w-10 shrink-0">
                          {(() => {
                            const allSeats = hand.players.map(pl => pl.seatPosition);
                            const aPos = getPositionName(a.seatIndex, hand.dealerPosition, allSeats);
                            return aPos ? <span className="bg-white/10 text-white/60 text-xs font-bold px-1 py-0.5 rounded">{aPos}</span> : null;
                          })()}
                        </span>
                        <span className="w-24 shrink-0 text-white/60 truncate">{a.odName}</span>
                        <span className="w-20 shrink-0 text-white/90">{formatAction(a.action)}</span>
                        <span className="text-white/50">{a.amount > 0 ? a.amount : ''}</span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            {/* Result */}
            <div className="mt-4 mb-1">
              <span className="text-white/50 text-sm font-bold">Result</span>
              <span className="text-white/30 text-sm ml-2">Pot {hand.potSize}</span>
            </div>
            {(() => {
              const foldedSeats = new Set(
                hand.actions.filter(a => a.action === 'fold').map(a => a.seatIndex)
              );
              return hand.players
                .filter(p => !foldedSeats.has(p.seatPosition))
                .sort((a, b) => b.profit - a.profit);
            })()
              .map((p, i) => {
                const allSeats = hand.players.map(pl => pl.seatPosition);
                const pos = getPositionName(p.seatPosition, hand.dealerPosition, allSeats);
                return (
                  <div key={`result-${i}`} className="flex items-center py-0.5">
                    <span className="w-10 shrink-0">
                      {pos && <span className="bg-white/10 text-white/60 text-xs font-bold px-1 py-0.5 rounded">{pos}</span>}
                    </span>
                    <span className="w-24 shrink-0 text-white/60 truncate">{p.username}</span>
                    <span className="w-20 shrink-0 text-yellow-400/80 text-xs truncate">{p.finalHand || getHandName(p.holeCards, hand.communityCards)}</span>
                    <ProfitDisplay profit={p.profit} />
                  </div>
                );
              })}
          </div>

        </div>
      </div>
    </div>
  );
}

export function HandHistoryPanel({ onClose }: HandHistoryPanelProps) {
  const { user } = useAuth();
  const [hands, setHands] = useState<HandSummary[]>([]);
  const [selectedHand, setSelectedHand] = useState<HandDetail | null>(null);
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
    try {
      const res = await fetch(`${API_BASE}/api/history/${handId}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setSelectedHand(data);
    } catch (err) {
      console.error('Failed to fetch hand detail:', err);
    }
  };

  useEffect(() => {
    if (user) fetchHands(0);
    else setLoading(false);
  }, [user]);

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/60 mb-4">ログインするとハンド履歴を確認できます</p>
          <button onClick={onClose} className="text-cyan-400 hover:text-cyan-300">
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      <div className="h-full overflow-y-auto">
        {/* ヘッダー */}
        <div className="sticky top-0 bg-gray-900/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center z-10">
          <button onClick={onClose} className="text-white/70 hover:text-white mr-3 text-sm">
            &larr; 戻る
          </button>
          <h1 className="text-white font-bold text-lg">ハンド履歴</h1>
          <span className="ml-auto text-white/50 text-sm">{total}件</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        ) : hands.length === 0 ? (
          <div className="text-center text-white/40 py-20">
            まだハンド履歴がありません
          </div>
        ) : (
          <>
            <div className="p-4 space-y-2">
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
                  className="w-full py-3 text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all text-sm border border-white/10"
                >
                  {loadingMore ? '読み込み中...' : 'もっと読む'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {selectedHand && (
        <HandDetailDialog hand={selectedHand} onClose={() => setSelectedHand(null)} />
      )}
    </div>
  );
}
