import { evaluatePLOHand } from '../logic/handEvaluator';
import type { Card } from '../logic/types';
import { maskName } from '../utils';
import { MiniCard, ProfitDisplay, PositionBadge, getPositionName } from './HandHistoryPanel';

export interface HandDetailPlayer {
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

export interface HandDetail {
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

export function HandDetailDialog({
  hand,
  onClose,
}: {
  hand: HandDetail;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col h-full light-bg">
        {/* ヘッダー */}
        <div className="shrink-0 sticky top-0 bg-white border-b border-cream-300 px-4 py-3 flex items-center z-10 shadow-sm">
          <button onClick={onClose} className="text-cream-700 hover:text-cream-900 mr-3 text-sm font-medium transition-colors">
            &larr; 戻る
          </button>
          <h1 className="text-cream-900 font-bold text-lg tracking-tight">
            Hand #{hand.id.slice(-6)}
          </h1>
          <div className="flex items-center gap-2 ml-3">
            <span className="text-cream-700 text-xs font-medium">{hand.blinds}</span>
            <span className="text-cream-500 text-xs">{new Date(hand.createdAt).toLocaleString('ja-JP')}</span>
          </div>
        </div>

        <div className="p-3 space-y-3 overflow-y-auto min-h-0 flex-1 overscroll-contain light-scrollbar">
          {/* プレイヤー（1行表示） */}
          <div className="space-y-1">
            {hand.players
              .sort((a, b) => (a.isCurrentUser ? -1 : b.isCurrentUser ? 1 : 0))
              .map((p, i) => {
                const allSeats = hand.players.map(pl => pl.seatPosition);
                const pos = getPositionName(p.seatPosition, hand.dealerPosition, allSeats);
                return (
                <div
                  key={i}
                  className={`rounded-lg px-2 py-1.5 border flex items-center gap-1.5 ${
                    p.isCurrentUser
                      ? 'bg-forest/5 border-forest/20'
                      : 'bg-cream-100 border-cream-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 w-[30cqw] shrink-0">
                    {pos ? <PositionBadge position={pos} /> : <span className="w-8 shrink-0" />}
                    {p.avatarUrl && (
                      <img src={p.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover border border-cream-300 shrink-0" />
                    )}
                    <span className={`font-semibold text-sm truncate ${p.isCurrentUser ? 'text-forest' : 'text-cream-900'}`}>
                      {p.isCurrentUser ? p.username : maskName(p.username)}
                    </span>
                  </div>
                  <div className="flex items-center gap-[0.4cqw] shrink-0">
                    {p.holeCards.map((c, j) => (
                      <MiniCard key={j} cardStr={c} />
                    ))}
                  </div>
                  <span className="ml-auto shrink-0">
                    <ProfitDisplay profit={p.profit} />
                  </span>
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
                          <div className="flex items-center gap-2 border-b border-cream-400 pb-1">
                            <span className="text-cream-800 text-sm font-bold">{streetLabels[street] || street}</span>
                            {streetCards[street]?.length > 0 && (
                              <div className="flex gap-[0.4cqw]">
                                {streetCards[street].map((c, j) => (
                                  <MiniCard key={j} cardStr={c} />
                                ))}
                              </div>
                            )}
                            {streetStartPot[street] > 0 && (
                              <span className="text-cream-600 text-xs font-medium ml-auto">Pot {streetStartPot[street]}</span>
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
                        <span className="w-24 shrink-0 text-cream-700 text-sm truncate">{hand.players.find(p => p.seatPosition === a.seatIndex)?.isCurrentUser ? a.odName : maskName(a.odName)}</span>
                        <span className="w-16 shrink-0 text-cream-900 text-sm font-bold">{formatAction(a.action)}</span>
                        <span className="text-forest text-sm font-bold font-mono">{a.amount > 0 ? a.amount : ''}</span>
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
                        <div className="flex items-center gap-2 border-b border-cream-400 pb-1">
                          <span className="text-cream-800 text-sm font-bold">{streetLabels[s]}</span>
                          <div className="flex gap-[0.4cqw]">
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
              <div className="flex items-center gap-2 border-b border-cream-400 pb-1">
                <span className="text-cream-800 text-sm font-bold">Result</span>
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
                    <span className="w-24 shrink-0 text-cream-700 text-sm truncate">{p.isCurrentUser ? p.username : maskName(p.username)}</span>
                    <span className="w-20 shrink-0 text-cream-700 text-xs truncate">{p.finalHand || getHandName(p.holeCards, hand.communityCards)}</span>
                    <ProfitDisplay profit={p.profit} />
                  </div>
                );
              })}
          </div>

        </div>
    </div>
  );
}
