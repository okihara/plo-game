import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, Link, Check, Image, FileText, Eye, EyeOff, UserRound } from 'lucide-react';
import { evaluatePLOHand, evaluateCurrentHand } from '../logic/handEvaluator';
import type { Card } from '../logic/types';
import { buildHandShareText, openXShare } from '../utils/share';
import { toPokerStarsText } from '../utils/pokerStarsFormat';
import { ProfilePopup } from './ProfilePopup';
import { usePlayerLabels } from '../hooks/usePlayerLabels';

import { MiniCard, ProfitDisplay, PositionBadge, getPositionName } from './HandHistoryUtils';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

export interface HandDetailPlayer {
  userId?: string | null;
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
  shareToken?: string;
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

const MASKED_PLAYER_NAME = '********';

function getStreetCards(communityCards: string[]): Record<string, string[]> {
  return {
    flop: communityCards.slice(0, 3),
    turn: communityCards.slice(3, 4),
    river: communityCards.slice(4, 5),
  };
}

function computeStreetStartPots(actions: HandDetailAction[], blinds: string): Record<string, number> {
  // ブラインド額をパース（例: "1/2" → SB=1, BB=2）
  const parts = blinds.split('/').map(Number);
  const blindTotal = parts.reduce((sum, v) => sum + (isNaN(v) ? 0 : v), 0);

  const pots: Record<string, number> = {};
  let cumPot = blindTotal;
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

function playerLabel(p: HandDetailPlayer, hideOpponentNames: boolean): string {
  if (!hideOpponentNames || p.isCurrentUser) return p.username;
  return MASKED_PLAYER_NAME;
}

function AnonymousAvatar({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-cream-300 border border-cream-500/30 text-cream-700 ${className}`}
      aria-hidden
    >
      <UserRound className="w-[55%] h-[55%]" strokeWidth={2.25} />
    </span>
  );
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
    <div className={isFirst ? 'mb-[1cqw]' : 'mt-[3cqw] mb-[1cqw]'}>
      <div className="flex items-center gap-[2cqw] border-b border-cream-400 pb-[1cqw]">
        <span className="text-cream-800 text-[3cqw] font-bold w-[10cqw] shrink-0">{STREET_LABELS[street] || street}</span>
        {cards && cards.length > 0 && (
          <div className="flex gap-[0.4cqw]">
            {cards.map((c, j) => <MiniCard key={j} cardStr={c} />)}
          </div>
        )}
        {pot != null && pot > 0 && (
          <span className="text-cream-800 text-[3cqw] font-bold">{pot}</span>
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
    <div className="flex items-center py-[0.5cqw] rounded-[1.5cqw] hover:bg-cream-200/50 px-[1cqw]">
      <span className="w-[9cqw] shrink-0">
        {pos ? <PositionBadge position={pos} /> : null}
      </span>
      <span
        className={`w-[22cqw] shrink-0 text-cream-700 text-[3cqw] truncate ${
          playerName === MASKED_PLAYER_NAME ? 'font-mono tracking-tight' : ''
        }`}
      >
        {playerName}
      </span>
      <span className="w-[14cqw] shrink-0 text-cream-900 text-[3cqw] font-bold">{ACTION_LABELS[action.action] || action.action}</span>
      <span className="text-forest text-[3cqw] font-bold font-mono">{action.amount > 0 ? action.amount : ''}</span>
    </div>
  );
}

function PlayerRow({ player, position, communityCards, displayName, anonymousAvatar, onTap }: {
  player: HandDetailPlayer;
  position: string | null;
  communityCards: string[];
  displayName: string;
  anonymousAvatar: boolean;
  onTap?: () => void;
}) {
  const handName = player.finalHand
    || (player.holeCards.length === 4 && communityCards.length >= 3
      ? evaluateCurrentHand(
          player.holeCards.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
          communityCards.map(s => ({ rank: s.slice(0, -1), suit: s.slice(-1) }) as Card),
        )?.name
      : null);

  return (
    <div
      className={`rounded-[1.5cqw] px-[2cqw] py-[1.5cqw] border flex items-center gap-[1.5cqw] ${
        player.isCurrentUser
          ? 'bg-forest/5 border-forest/20'
          : 'bg-cream-100 border-cream-300'
      } ${onTap ? 'cursor-pointer active:bg-cream-200/60' : ''}`}
      onClick={onTap}
    >
      <div className="flex items-center gap-[1.5cqw] w-[30cqw] shrink-0">
        {position ? <PositionBadge position={position} /> : <span className="w-[7cqw] shrink-0" />}
        {anonymousAvatar ? (
          <AnonymousAvatar className="w-[4.5cqw] h-[4.5cqw] shrink-0" />
        ) : player.avatarUrl ? (
          <img src={player.avatarUrl} alt="" className="w-[4.5cqw] h-[4.5cqw] rounded-full object-cover border border-cream-300 shrink-0" />
        ) : null}
        <span
          className={`font-semibold text-[3cqw] truncate ${player.isCurrentUser ? 'text-forest' : 'text-cream-900'} ${
            anonymousAvatar ? 'font-mono tracking-tight' : ''
          }`}
        >
          {displayName}
        </span>
      </div>
      <div className="flex items-center gap-[0.4cqw] shrink-0">
        {player.holeCards.map((c, j) => <MiniCard key={j} cardStr={c} />)}
      </div>
      {handName && <span className="text-cream-700 text-[2.5cqw] truncate">{handName}</span>}
      <span className="ml-auto shrink-0">
        <ProfitDisplay profit={player.profit} />
      </span>
    </div>
  );
}

function ActionHistory({
  hand,
  allSeats,
  hideOpponentNames,
}: {
  hand: HandDetail;
  allSeats: number[];
  hideOpponentNames: boolean;
}) {
  const streetCards = getStreetCards(hand.communityCards);
  const streetStartPot = computeStreetStartPots(hand.actions, hand.blinds);
  const streetsInActions = new Set(hand.actions.map(a => a.street || 'preflop'));

  const nameForSeat = (seatIndex: number, fallbackOdName: string) => {
    const p = hand.players.find(x => x.seatPosition === seatIndex);
    if (p) {
      return playerLabel(p, hideOpponentNames);
    }
    return hideOpponentNames ? MASKED_PLAYER_NAME : fallbackOdName;
  };

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

        const name = nameForSeat(a.seatIndex, a.odName);

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

function ResultSection({
  hand,
  allSeats,
  hideOpponentNames,
}: {
  hand: HandDetail;
  allSeats: number[];
  hideOpponentNames: boolean;
}) {
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
      <div className="mt-[3cqw] mb-[1cqw]">
        <div className="flex items-center gap-[2cqw] border-b border-cream-400 pb-[1cqw]">
          <span className="text-cream-800 text-[3cqw] font-bold">Result</span>
          {hand.rakeAmount != null && hand.rakeAmount > 0 && (
            <span className="text-cream-700 text-[2.5cqw] font-medium">Rake {hand.rakeAmount}</span>
          )}
          <span className="text-forest text-[3cqw] font-bold">{hand.potSize}</span>
        </div>
      </div>
      {activePlayers.map((p, i) => {
        const pos = getPositionName(p.seatPosition, hand.dealerPosition, allSeats);
        return (
          <div key={`result-${i}`} className="flex items-center py-[0.5cqw] px-[1cqw]">
            <span className="w-[9cqw] shrink-0">
              {pos && <PositionBadge position={pos} />}
            </span>
            <span className="w-[22cqw] shrink-0 text-cream-700 text-[3cqw] truncate font-mono tracking-tight">
              {playerLabel(p, hideOpponentNames)}
            </span>
            <span className="w-[18cqw] shrink-0 text-cream-700 text-[2.5cqw] truncate">{p.finalHand || getHandName(p.holeCards, hand.communityCards)}</span>
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
  initialHideOpponentNames,
  isPublicPage,
}: {
  hand: HandDetail;
  onClose: () => void;
  initialHideOpponentNames?: boolean;
  isPublicPage?: boolean;
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

  const [hideOpponentNames, setHideOpponentNames] = useState(initialHideOpponentNames ?? false);
  const [profilePlayer, setProfilePlayer] = useState<HandDetailPlayer | null>(null);
  const { getLabel, setLabel, removeLabel } = usePlayerLabels();
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imageCopied, setImageCopied] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);

  const tokenSuffix = !hideOpponentNames && hand.shareToken ? `?t=${encodeURIComponent(hand.shareToken)}` : '';
  const shareUrl = `${window.location.origin}/hand/${hand.id}${tokenSuffix}`;
  const me = hand.players.find(p => p.isCurrentUser);
  const myProfit = me?.profit ?? 0;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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

  const handleCopyImage = async () => {
    if (imageLoading) return;
    setImageLoading(true);
    try {
      // OGP画像をfetch → img要素でデコード → canvasでPNG Blobに変換
      const res = await fetch(`${API_BASE}/api/ogp/hand/${hand.id}${tokenSuffix}`);
      if (!res.ok) throw new Error('Failed to fetch image');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image decode failed')); };
        img.src = url;
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      setImageLoading(false);
      setImageCopied(true);
      setTimeout(() => { setImageCopied(false); setShowShareMenu(false); }, 1000);
    } catch (e) {
      console.error('[handleCopyImage] error:', e);
      setImageLoading(false);
      setShowShareMenu(false);
    }
  };

  const handleShareX = () => {
    openXShare(buildHandShareText(hand.id, myProfit), shareUrl);
    setShowShareMenu(false);
  };

  const [psCopied, setPsCopied] = useState(false);

  const handleCopyPokerStars = async () => {
    const maskedHand = hideOpponentNames
      ? { ...hand, players: hand.players.map(p => ({ ...p, username: playerLabel(p, true) })) }
      : hand;
    const text = toPokerStarsText(maskedHand);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setPsCopied(true);
    setTimeout(() => { setPsCopied(false); setShowShareMenu(false); }, 1500);
  };

  const shell = (
    <div className="absolute inset-0 z-[280] flex flex-col light-bg min-h-0 h-full">
        {/* ヘッダー: 自分のポジション・ホールカード + プライバシー + シェア */}
        <div className="shrink-0 sticky top-0 bg-white border-b border-cream-300 px-[4cqw] py-[3cqw] flex items-center z-10 shadow-sm">
          {(() => {
            const mePlayer = hand.players.find(p => p.isCurrentUser);
            const pos = mePlayer ? getPositionName(mePlayer.seatPosition, hand.dealerPosition, allSeats) : '';
            return (
              <div className="flex items-center gap-[1.5cqw] min-w-0 flex-1">
                {pos && <PositionBadge position={pos} />}
                {mePlayer && (
                  <span className="text-cream-900 text-[3cqw] font-semibold truncate">{mePlayer.username}</span>
                )}
                {mePlayer && mePlayer.holeCards.length > 0 && (
                  <div className="flex items-center gap-[0.4cqw]">
                    {mePlayer.holeCards.map((c, j) => <MiniCard key={j} cardStr={c} />)}
                  </div>
                )}
              </div>
            );
          })()}

          {!isPublicPage && <div className="ml-auto flex items-center gap-[1.5cqw] shrink-0">
            <button
              type="button"
              onClick={() => setHideOpponentNames(v => !v)}
              aria-pressed={hideOpponentNames}
              aria-label={hideOpponentNames ? '相手の名前を表示' : '自分以外の名前を隠す'}
              title={hideOpponentNames ? '相手の名前を表示' : '自分以外の名前を隠す'}
              className={`flex items-center gap-[1cqw] rounded-full px-[2.2cqw] py-[1.2cqw] text-[2.6cqw] font-medium transition-colors ${
                hideOpponentNames
                  ? 'bg-forest/15 text-forest'
                  : 'bg-cream-100 text-cream-700 active:bg-cream-300'
              }`}
            >
              {hideOpponentNames ? (
                <EyeOff className="w-[3.5cqw] h-[3.5cqw] shrink-0" />
              ) : (
                <Eye className="w-[3.5cqw] h-[3.5cqw] shrink-0" />
              )}
              <span className="max-[400px]:hidden whitespace-nowrap">名前を隠す</span>
            </button>
            <div className="relative">
            <button
              onClick={() => setShowShareMenu(v => !v)}
              className="w-[8cqw] h-[8cqw] flex items-center justify-center rounded-full bg-cream-100 active:bg-cream-300"
            >
              <Share2 className="w-[4cqw] h-[4cqw] text-cream-700" />
            </button>
            {showShareMenu && (
              <>
              <div className="fixed inset-0 z-[299]" onClick={() => !imageLoading && setShowShareMenu(false)} />
              <div className="absolute right-0 top-full mt-[1cqw] z-[300] bg-white border border-cream-300 rounded-[2cqw] shadow-lg min-w-[36cqw] overflow-hidden">
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-[2cqw] w-full px-[3cqw] py-[2.5cqw] text-[3cqw] text-cream-800 hover:bg-cream-100 active:bg-cream-200 transition-colors"
                >
                  {copied
                    ? <Check className="w-[4cqw] h-[4cqw] text-forest" />
                    : <Link className="w-[4cqw] h-[4cqw] text-cream-700" />}
                  {copied ? 'コピーしました' : 'リンクをコピー'}
                </button>
                <button
                  onClick={handleCopyImage}
                  disabled={imageLoading}
                  className="flex items-center gap-[2cqw] w-full px-[3cqw] py-[2.5cqw] text-[3cqw] text-cream-800 hover:bg-cream-100 active:bg-cream-200 transition-colors border-t border-cream-200 disabled:opacity-50"
                >
                  {imageCopied
                    ? <Check className="w-[4cqw] h-[4cqw] text-forest" />
                    : <Image className="w-[4cqw] h-[4cqw] text-cream-700" />}
                  {imageLoading ? '生成中...' : imageCopied ? 'コピーしました' : '画像をコピー'}
                </button>
                <button
                  onClick={handleShareX}
                  className="flex items-center gap-[2cqw] w-full px-[3cqw] py-[2.5cqw] text-[3cqw] text-cream-800 hover:bg-cream-100 active:bg-cream-200 transition-colors border-t border-cream-200"
                >
                  <svg className="w-[4cqw] h-[4cqw] text-cream-700" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  X でシェア
                </button>
                <button
                  onClick={handleCopyPokerStars}
                  className="flex items-center gap-[2cqw] w-full px-[3cqw] py-[2.5cqw] text-[3cqw] text-cream-800 hover:bg-cream-100 active:bg-cream-200 transition-colors border-t border-cream-200"
                >
                  {psCopied
                    ? <Check className="w-[4cqw] h-[4cqw] text-forest" />
                    : <FileText className="w-[4cqw] h-[4cqw] text-cream-700" />}
                  {psCopied ? 'コピーしました' : 'PokerStars形式でコピー'}
                </button>
              </div>
              </>
            )}
            </div>
          </div>}
        </div>

        <div className="p-[3cqw] pb-[4cqw] space-y-[3cqw] overflow-y-auto min-h-0 flex-1 overscroll-contain light-scrollbar">
          {/* ハンド情報 */}
          <div className="flex items-center gap-[1.5cqw]">
            <span className="text-cream-700 text-[3cqw]">{new Date(hand.createdAt).toLocaleString('ja-JP')}</span>
            <span className="text-cream-800 text-[3cqw] font-semibold">#{hand.id.slice(-6)}</span>
            <span className="text-cream-900 text-[3.2cqw] font-bold">{hand.blinds}</span>
          </div>

          {/* プレイヤー（1行表示） */}
          <div className="space-y-[1cqw]">
            {sortedPlayers.map((p, i) => (
              <PlayerRow
                key={i}
                player={p}
                position={getPositionName(p.seatPosition, hand.dealerPosition, allSeats)}
                communityCards={hand.communityCards}
                displayName={playerLabel(p, hideOpponentNames)}
                anonymousAvatar={hideOpponentNames && !p.isCurrentUser}
                onTap={!isPublicPage && p.userId ? () => setProfilePlayer(p) : undefined}
              />
            ))}
          </div>

          {/* アクション履歴 + Result */}
          <div className="bg-cream-100 rounded-[2.5cqw] px-[3cqw] py-[3cqw] border border-cream-300">
            <div className="space-y-[0.5cqw]">
              <ActionHistory hand={normalizedHand} allSeats={allSeats} hideOpponentNames={hideOpponentNames} />
            </div>
            <ResultSection hand={normalizedHand} allSeats={allSeats} hideOpponentNames={hideOpponentNames} />
          </div>
        </div>

        <div className="shrink-0 border-t border-cream-300 bg-white px-[4cqw] pt-[1.8cqw] pb-[max(1.8cqw,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(139,126,106,0.08)]">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-[2cqw] rounded-[2cqw] bg-forest text-white text-[3.2cqw] font-bold shadow-sm active:scale-[0.99] transition-transform"
          >
            閉じる
          </button>
        </div>

        {profilePlayer && profilePlayer.userId && (
          <ProfilePopup
            name={profilePlayer.username}
            avatarUrl={profilePlayer.avatarUrl}
            userId={profilePlayer.userId}
            isSelf={profilePlayer.isCurrentUser}
            onClose={() => setProfilePlayer(null)}
            label={getLabel(profilePlayer.userId)}
            onLabelChange={setLabel}
            onLabelRemove={removeLabel}
          />
        )}
    </div>
  );

  const viewport =
    typeof document !== 'undefined' ? document.getElementById('plo-viewport') : null;
  return viewport ? createPortal(shell, viewport) : shell;
}
