import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { evaluatePLOHand } from '../logic/handEvaluator';
import type { Card } from '../logic/types';
import { maskName } from '../utils';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const PAGE_SIZE = 20;

const SUIT_SYMBOLS: Record<string, string> = {
  h: '\u2665', d: '\u2666', c: '\u2663', s: '\u2660',
};
const SUIT_BG_COLORS: Record<string, string> = {
  h: 'bg-red-600', d: 'bg-blue-600', c: 'bg-green-700', s: 'bg-gray-800',
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
  const bg = SUIT_BG_COLORS[suit] || 'bg-gray-500';

  return (
    <span className={`inline-flex items-center justify-center ${bg} text-white border border-white/30 rounded px-[1.6cqw] py-[0.8cqw] text-[3cqw] font-mono font-bold leading-none shadow-sm`}>
      {rank}{symbol}
    </span>
  );
}

function ProfitDisplay({ profit, size = 'normal' }: { profit: number; size?: 'normal' | 'large' }) {
  const textSize = size === 'large' ? 'text-base' : 'text-sm';
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

function PositionBadge({ position }: { position: string }) {
  if (!position) return null;
  return (
    <span className="bg-cream-200 text-cream-800 text-xs font-bold w-8 text-center py-0.5 rounded border border-cream-400 shrink-0 inline-block">
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
      className="w-full text-left bg-white border border-cream-300 rounded-xl p-3 shadow-[0_2px_8px_rgba(139,126,106,0.12)] transition-all duration-200 hover:bg-cream-50 hover:border-cream-400 active:scale-[0.98]"
    >
      {/* Row 1: meta left, profit right (hero element) */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-cream-600 text-sm font-semibold">#{hand.handNumber}</span>
          {(() => {
            const me = hand.players.find(p => p.isCurrentUser);
            const pos = me ? getPositionName(me.seatPosition, hand.dealerPosition, hand.players.map(p => p.seatPosition)) : '';
            return pos ? <PositionBadge position={pos} /> : null;
          })()}
          <span className="text-cream-900 text-base font-bold">{hand.blinds}</span>
          <span className="text-cream-500 text-xs font-medium">Pot {hand.potSize}</span>
        </div>
        <div className="flex items-center gap-2">
          <ProfitDisplay profit={hand.profit} size="large" />
          <span className="text-cream-400 text-xs">{formatDate(hand.createdAt)}</span>
        </div>
      </div>
      {/* Row 2: cards */}
      <div className="flex items-center gap-[0.6cqw]">
        {hand.holeCards.map((c, i) => (
          <MiniCard key={i} cardStr={c} />
        ))}
        {hand.communityCards.length > 0 && (
          <>
            <span className="text-cream-300 mx-[0.5cqw] text-lg font-light">|</span>
            {hand.communityCards.map((c, i) => (
              <MiniCard key={`cc-${i}`} cardStr={c} />
            ))}
          </>
        )}
      </div>
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-[95%] max-h-[70dvh] flex flex-col bg-white border border-cream-300 rounded-3xl overflow-hidden shadow-[0_8px_40px_rgba(139,126,106,0.2)]"
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="shrink-0 bg-cream-100 border-b border-cream-300 px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-cream-900 font-bold text-lg tracking-tight">
              Hand #{hand.handNumber}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-cream-600 text-xs">{hand.blinds}</span>
              <span className="text-cream-400 text-xs">{new Date(hand.createdAt).toLocaleString('ja-JP')}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-cream-400 hover:text-cream-900 text-2xl leading-none transition-colors">&times;</button>
        </div>

        <div className="p-3 space-y-3 overflow-y-auto min-h-0 flex-1 overscroll-contain light-scrollbar">
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
                  className={`rounded-xl px-3 py-2 border ${
                    p.isCurrentUser
                      ? 'bg-forest/5 border-forest/20'
                      : 'bg-cream-100 border-cream-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {pos && <PositionBadge position={pos} />}
                      {p.avatarUrl && (
                        <img src={p.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover border border-cream-300 shrink-0" />
                      )}
                      <span className={`font-semibold text-sm truncate ${p.isCurrentUser ? 'text-forest' : 'text-cream-800'}`}>
                        {p.isCurrentUser ? p.username : maskName(p.username)}
                      </span>
                    </div>
                    <div className="shrink-0 ml-2">
                      <ProfitDisplay profit={p.profit} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {p.holeCards.map((c, j) => (
                      <MiniCard key={j} cardStr={c} />
                    ))}
                    {p.finalHand && (
                      <span className="ml-2 text-cream-600 text-xs">{p.finalHand}</span>
                    )}
                  </div>
                </div>
              );
              })}
          </div>

          {/* アクション履歴（ストリートごと） */}
          <div className="bg-cream-100 rounded-xl px-3 py-3 border border-cream-300">
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
                // アクションに含まれるストリートを集計
                const streetsInActions = new Set(hand.actions.map(a => a.street || 'preflop'));
                let lastStreet = '';
                let isFirstHeader = true;
                const actionElements = hand.actions.map((a, i) => {
                  const street = a.street || 'preflop';
                  const showHeader = street !== lastStreet && streets.includes(street);
                  lastStreet = street;
                  const headerMargin = showHeader && !isFirstHeader;
                  if (showHeader) isFirstHeader = false;
                  return (
                    <div key={i}>
                      {showHeader && (
                        <div className={headerMargin ? 'mt-3 mb-1' : 'mb-1'}>
                          <div className="flex items-center gap-2 border-b border-cream-300 pb-1">
                            <span className="text-cream-700 text-sm font-bold">{streetLabels[street] || street}</span>
                            {streetCards[street]?.length > 0 && (
                              <div className="flex gap-1">
                                {streetCards[street].map((c, j) => (
                                  <MiniCard key={j} cardStr={c} />
                                ))}
                              </div>
                            )}
                            {streetStartPot[street] > 0 && (
                              <span className="text-cream-500 text-xs ml-auto">Pot {streetStartPot[street]}</span>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center py-0.5 rounded-lg hover:bg-cream-200/50 px-1">
                        <span className="w-10 shrink-0">
                          {(() => {
                            const allSeats = hand.players.map(pl => pl.seatPosition);
                            const aPos = getPositionName(a.seatIndex, hand.dealerPosition, allSeats);
                            return aPos ? <PositionBadge position={aPos} /> : null;
                          })()}
                        </span>
                        <span className="w-24 shrink-0 text-cream-600 text-sm truncate">{hand.players.find(p => p.seatPosition === a.seatIndex)?.isCurrentUser ? a.odName : maskName(a.odName)}</span>
                        <span className="w-16 shrink-0 text-cream-900 text-sm font-bold">{formatAction(a.action)}</span>
                        <span className="text-forest text-sm font-mono">{a.amount > 0 ? a.amount : ''}</span>
                      </div>
                    </div>
                  );
                });

                // オールインランアウト時: アクションのないストリートのカードを追加表示
                const runOutElements: JSX.Element[] = [];
                for (const s of ['flop', 'turn', 'river'] as const) {
                  if (!streetsInActions.has(s) && streetCards[s]?.length > 0) {
                    runOutElements.push(
                      <div key={`runout-${s}`} className="mt-3 mb-1">
                        <div className="flex items-center gap-2 border-b border-cream-300 pb-1">
                          <span className="text-cream-700 text-sm font-bold">{streetLabels[s]}</span>
                          <div className="flex gap-1">
                            {streetCards[s].map((c, j) => (
                              <MiniCard key={j} cardStr={c} />
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  }
                }

                return [...actionElements, ...runOutElements];
              })()}
            </div>
            {/* Result */}
            <div className="mt-3 mb-1">
              <div className="flex items-center gap-2 border-b border-cream-300 pb-1">
                <span className="text-cream-700 text-xs font-bold">Result</span>
                <span className="text-forest text-sm font-bold">Pot {hand.potSize}</span>
              </div>
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
                  <div key={`result-${i}`} className="flex items-center py-0.5 px-1">
                    <span className="w-10 shrink-0">
                      {pos && <PositionBadge position={pos} />}
                    </span>
                    <span className="w-24 shrink-0 text-cream-600 text-sm truncate">{p.isCurrentUser ? p.username : maskName(p.username)}</span>
                    <span className="w-20 shrink-0 text-cream-600 text-xs truncate">{p.finalHand || getHandName(p.holeCards, hand.communityCards)}</span>
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
  const [loadingDetail, setLoadingDetail] = useState(false);
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
  }, [user]);

  if (!user) {
    return (
      <div className="h-full light-bg flex items-center justify-center">
        <div className="text-center">
          <p className="text-cream-600 mb-4">ログインするとハンド履歴を確認できます</p>
          <button onClick={onClose} className="text-cream-500 hover:text-cream-700 transition-colors">
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full relative">
      <div className="h-full overflow-y-auto light-scrollbar">
        {/* ヘッダー */}
        <div className="sticky top-0 bg-white border-b border-cream-300 px-4 py-3 flex items-center z-10 shadow-sm">
          <button onClick={onClose} className="text-cream-700 hover:text-cream-900 mr-3 text-sm font-medium transition-colors">
            &larr; 戻る
          </button>
          <h1 className="text-cream-900 font-bold text-lg tracking-tight">ハンド履歴</h1>
          <span className="ml-auto text-cream-600 text-sm font-medium">{total}件</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
          </div>
        ) : hands.length === 0 ? (
          <div className="text-center text-cream-500 py-20">
            まだハンド履歴がありません
          </div>
        ) : (
          <>
            <div className="p-3 space-y-2">
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
                  className="w-full py-3 text-cream-600 hover:text-cream-900 bg-white hover:bg-cream-50 rounded-xl transition-all text-sm border border-cream-300 hover:border-cream-400"
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
          <div className="w-8 h-8 border-2 border-cream-300 border-t-forest rounded-full animate-spin relative z-10" />
        </div>
      )}
      {selectedHand && (
        <HandDetailDialog hand={selectedHand} onClose={() => setSelectedHand(null)} />
      )}
    </div>
  );
}
