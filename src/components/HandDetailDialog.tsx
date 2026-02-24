import { useMemo } from 'react';
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
  rakeAmount?: number;
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

const ACTION_LABELS: Record<string, string> = {
  fold: 'Fold', check: 'Check', call: 'Call',
  bet: 'Bet', raise: 'Raise', allin: 'All-in',
};

const STREET_LABELS: Record<string, string> = {
  preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River',
};

const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;

function getStreetCards(communityCards: string[]): Record<string, string[]> {
  return {
    flop: communityCards.slice(0, 3),
    turn: communityCards.slice(3, 4),
    river: communityCards.slice(4, 5),
  };
}

function computeStreetStartPots(actions: HandDetailAction[]): Record<string, number> {
  const pots: Record<string, number> = {};
  let cumPot = 0;
  let prevStreet = '';
  for (const a of actions) {
    const s = a.street || 'preflop';
    if (s !== prevStreet) {
      pots[s] = cumPot;
      prevStreet = s;
    }
    cumPot += a.amount;
  }
  return pots;
}

function displayName(player: { isCurrentUser: boolean; username: string }): string {
  return player.isCurrentUser ? player.username : maskName(player.username);
}

/** プリフロでアクション記録がないプレイヤーに fold を補完（ポジション順の正しい位置に挿入） */
function complementMissingFolds(
  actions: HandDetailAction[],
  players: HandDetailPlayer[],
  dealerPosition: number,
): HandDetailAction[] {
  // プリフロ / それ以降に分割
  const preflopActions: HandDetailAction[] = [];
  const postPreflopActions: HandDetailAction[] = [];
  let preflopDone = false;
  for (const a of actions) {
    if (preflopDone || (a.street && a.street !== 'preflop')) {
      postPreflopActions.push(a);
      preflopDone = true;
    } else {
      preflopActions.push(a);
    }
  }

  const seatsInPreflop = new Set(preflopActions.map(a => a.seatIndex));
  const missingSeats = new Set(
    players.filter(p => !seatsInPreflop.has(p.seatPosition)).map(p => p.seatPosition),
  );
  if (missingSeats.size === 0) return actions;

  // プリフロのアクション順を算出: UTG→...→BTN→SB→BB
  const sortedSeats = [...new Set(players.map(p => p.seatPosition))].sort(
    (a, b) => ((a - dealerPosition + 6) % 6) - ((b - dealerPosition + 6) % 6),
  );
  const n = sortedSeats.length;
  const preflopOrder = n <= 2
    ? sortedSeats
    : [...sortedSeats.slice(3), ...sortedSeats.slice(0, 3)];

  // 全員フォールドでBBが勝った場合、BBにfoldを補完しない
  const existingFolds = preflopActions.filter(a => a.action === 'fold').length;
  if (existingFolds + missingSeats.size >= players.length) {
    for (let i = preflopOrder.length - 1; i >= 0; i--) {
      if (missingSeats.has(preflopOrder[i])) {
        missingSeats.delete(preflopOrder[i]);
        break;
      }
    }
    if (missingSeats.size === 0) return actions;
  }

  const seatOrderMap = new Map(preflopOrder.map((seat, idx) => [seat, idx]));
  const playerBySeat = new Map(players.map(p => [p.seatPosition, p]));

  const makeFold = (seat: number): HandDetailAction => {
    const p = playerBySeat.get(seat)!;
    return { seatIndex: seat, odId: '', odName: p.username, action: 'fold', amount: 0, street: 'preflop' };
  };

  // プリフロアクションを走査し、初出シートの手前にスキップされた席の fold を挿入
  const result: HandDetailAction[] = [];
  const seenSeats = new Set<number>();
  const inserted = new Set<number>();

  for (const a of preflopActions) {
    if (!seenSeats.has(a.seatIndex)) {
      const curOrder = seatOrderMap.get(a.seatIndex) ?? 0;
      for (const seat of preflopOrder) {
        if (missingSeats.has(seat) && !inserted.has(seat) && (seatOrderMap.get(seat) ?? 0) < curOrder) {
          result.push(makeFold(seat));
          inserted.add(seat);
        }
      }
      seenSeats.add(a.seatIndex);
    }
    result.push(a);
  }

  // 残りの欠落席はプリフロ末尾に追加
  for (const seat of preflopOrder) {
    if (missingSeats.has(seat) && !inserted.has(seat)) {
      result.push(makeFold(seat));
    }
  }

  return [...result, ...postPreflopActions];
}

/* ── サブコンポーネント ── */

function StreetHeader({ street, cards, pot, isFirst }: {
  street: string;
  cards?: string[];
  pot?: number;
  isFirst: boolean;
}) {
  return (
    <div className={isFirst ? 'mb-1' : 'mt-3 mb-1'}>
      <div className="flex items-center gap-2 border-b border-cream-400 pb-1">
        <span className="text-cream-800 text-sm font-bold">{STREET_LABELS[street] || street}</span>
        {pot != null && pot > 0 && (
          <span className="text-cream-600 text-xs font-medium">Pot {pot}</span>
        )}
        {cards && cards.length > 0 && (
          <div className="flex gap-[0.4cqw]">
            {cards.map((c, j) => <MiniCard key={j} cardStr={c} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionRow({ action, playerName, allSeats, dealerPosition }: {
  action: HandDetailAction;
  playerName: string;
  allSeats: number[];
  dealerPosition: number;
}) {
  const pos = getPositionName(action.seatIndex, dealerPosition, allSeats);
  return (
    <div className="flex items-center py-0.5 rounded-lg hover:bg-cream-200/50 px-1">
      <span className="w-10 shrink-0">
        {pos ? <PositionBadge position={pos} /> : null}
      </span>
      <span className="w-24 shrink-0 text-cream-700 text-sm truncate">{playerName}</span>
      <span className="w-16 shrink-0 text-cream-900 text-sm font-bold">{ACTION_LABELS[action.action] || action.action}</span>
      <span className="text-forest text-sm font-bold font-mono">{action.amount > 0 ? action.amount : ''}</span>
    </div>
  );
}

function PlayerRow({ player, position }: {
  player: HandDetailPlayer;
  position: string | null;
}) {
  return (
    <div
      className={`rounded-lg px-2 py-1.5 border flex items-center gap-1.5 ${
        player.isCurrentUser
          ? 'bg-forest/5 border-forest/20'
          : 'bg-cream-100 border-cream-300'
      }`}
    >
      <div className="flex items-center gap-1.5 w-[30cqw] shrink-0">
        {position ? <PositionBadge position={position} /> : <span className="w-8 shrink-0" />}
        {player.avatarUrl && (
          <img src={player.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover border border-cream-300 shrink-0" />
        )}
        <span className={`font-semibold text-sm truncate ${player.isCurrentUser ? 'text-forest' : 'text-cream-900'}`}>
          {displayName(player)}
        </span>
      </div>
      <div className="flex items-center gap-[0.4cqw] shrink-0">
        {player.holeCards.map((c, j) => <MiniCard key={j} cardStr={c} />)}
      </div>
      <span className="ml-auto shrink-0">
        <ProfitDisplay profit={player.profit} />
      </span>
    </div>
  );
}

function ActionHistory({ hand, allSeats }: { hand: HandDetail; allSeats: number[] }) {
  const streetCards = getStreetCards(hand.communityCards);
  const streetStartPot = computeStreetStartPots(hand.actions);
  const streetsInActions = new Set(hand.actions.map(a => a.street || 'preflop'));

  const seatToPlayer = useMemo(() => {
    const map = new Map<number, HandDetailPlayer>();
    for (const p of hand.players) map.set(p.seatPosition, p);
    return map;
  }, [hand.players]);

  let lastStreet = '';
  let isFirstHeader = true;

  return (
    <>
      {hand.actions.map((a, i) => {
        const street = a.street || 'preflop';
        const showHeader = street !== lastStreet && (STREETS as readonly string[]).includes(street);
        lastStreet = street;
        const isFirst = isFirstHeader;
        if (showHeader) isFirstHeader = false;

        const player = seatToPlayer.get(a.seatIndex);
        const name = player?.isCurrentUser ? a.odName : maskName(a.odName);

        return (
          <div key={i}>
            {showHeader && (
              <StreetHeader
                street={street}
                cards={streetCards[street]}
                pot={streetStartPot[street]}
                isFirst={isFirst}
              />
            )}
            <ActionRow
              action={a}
              playerName={name}
              allSeats={allSeats}
              dealerPosition={hand.dealerPosition}
            />
          </div>
        );
      })}

      {/* オールインランアウト時: アクションのないストリートのカードを追加表示 */}
      {(['flop', 'turn', 'river'] as const).map(s =>
        !streetsInActions.has(s) && streetCards[s]?.length > 0 ? (
          <StreetHeader key={`runout-${s}`} street={s} cards={streetCards[s]} isFirst={false} />
        ) : null
      )}
    </>
  );
}

function ResultSection({ hand, allSeats }: { hand: HandDetail; allSeats: number[] }) {
  const activePlayers = useMemo(() => {
    const foldedSeats = new Set(
      hand.actions.filter(a => a.action === 'fold').map(a => a.seatIndex)
    );
    return hand.players
      .filter(p => !foldedSeats.has(p.seatPosition))
      .sort((a, b) => b.profit - a.profit);
  }, [hand.actions, hand.players]);

  return (
    <>
      <div className="mt-3 mb-1">
        <div className="flex items-center gap-2 border-b border-cream-400 pb-1">
          <span className="text-cream-800 text-sm font-bold">Result</span>
          <span className="text-forest text-sm font-bold">Pot {hand.potSize}</span>
          {hand.rakeAmount != null && hand.rakeAmount > 0 && (
            <span className="text-cream-500 text-xs font-medium">Rake {hand.rakeAmount}</span>
          )}
        </div>
      </div>
      {activePlayers.map((p, i) => {
        const pos = getPositionName(p.seatPosition, hand.dealerPosition, allSeats);
        return (
          <div key={`result-${i}`} className="flex items-center py-0.5 px-1">
            <span className="w-10 shrink-0">
              {pos && <PositionBadge position={pos} />}
            </span>
            <span className="w-24 shrink-0 text-cream-700 text-sm truncate">{displayName(p)}</span>
            <span className="w-20 shrink-0 text-cream-700 text-xs truncate">{p.finalHand || getHandName(p.holeCards, hand.communityCards)}</span>
            <ProfitDisplay profit={p.profit} />
          </div>
        );
      })}
    </>
  );
}

/* ── メインコンポーネント ── */

export function HandDetailDialog({
  hand,
  onClose,
}: {
  hand: HandDetail;
  onClose: () => void;
}) {
  const allSeats = useMemo(() => hand.players.map(p => p.seatPosition), [hand.players]);
  const normalizedHand = useMemo(() => ({
    ...hand,
    actions: complementMissingFolds(hand.actions, hand.players, hand.dealerPosition),
  }), [hand]);
  const sortedPlayers = useMemo(() => {
    const dealer = hand.dealerPosition;
    return [...hand.players].sort((a, b) => {
      // SB→BB→UTG→HJ→CO→BTN（ディーラーの次=SBが先頭）
      const offsetA = (a.seatPosition - dealer - 1 + 6) % 6;
      const offsetB = (b.seatPosition - dealer - 1 + 6) % 6;
      return offsetA - offsetB;
    });
  }, [hand.players, hand.dealerPosition]);

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
            {sortedPlayers.map((p, i) => (
              <PlayerRow
                key={i}
                player={p}
                position={getPositionName(p.seatPosition, hand.dealerPosition, allSeats)}
              />
            ))}
          </div>

          {/* アクション履歴 + Result */}
          <div className="bg-cream-100 rounded-xl px-3 py-3 border border-cream-300">
            <div className="space-y-0.5">
              <ActionHistory hand={normalizedHand} allSeats={allSeats} />
            </div>
            <ResultSection hand={normalizedHand} allSeats={allSeats} />
          </div>
        </div>
    </div>
  );
}
