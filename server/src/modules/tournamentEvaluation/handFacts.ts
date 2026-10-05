import {
  createDeck,
  findBestPLOHand,
  getPositionLabel,
  getRankValue,
  type Card,
  type HandRank,
  type PokerStarsHandAction,
} from '@plo/shared';
import type { TournamentHandExport } from '../history/tournamentHandsForUser.js';
import { normalizeActions } from './keyHandSelection.js';

/**
 * AIレビュー用に、ハンドの「事実」をサーバー側で計算してテキスト化する。
 *
 * 実測では LLM が役（ホール2枚＋ボード3枚の制約）、スタックのBB数、
 * アクション順をハンド履歴から読み違えることが多かった。
 * 計算で確定できるものはここで求めて渡し、LLM には解釈だけをさせる。
 */

const RANK_LABEL: Record<number, string> = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
  9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
};

/** これ以上の役になる次のカードを「アウツ」として数える（ストレート） */
const OUTS_MIN_RANK = 5;

const STREETS = [
  { key: 'preflop', label: 'プリフロップ', boardSize: 0 },
  { key: 'flop', label: 'フロップ', boardSize: 3 },
  { key: 'turn', label: 'ターン', boardSize: 4 },
  { key: 'river', label: 'リバー', boardSize: 5 },
] as const;

export function parseCard(s: string): Card | null {
  const m = /^([2-9TJQKA])([hdcs])$/.exec(s);
  return m ? { rank: m[1] as Card['rank'], suit: m[2] as Card['suit'] } : null;
}

function parseCards(list: string[]): Card[] | null {
  const cards = list.map(parseCard);
  return cards.every((c): c is Card => c !== null) ? cards : null;
}

const cardKey = (c: Card) => `${c.rank}${c.suit}`;
const fmtCards = (cards: Card[]) => cards.map(cardKey).join(' ');
const r = (v: number) => RANK_LABEL[v] ?? String(v);

function fmtBb(chips: number, bb: number): string {
  const v = chips / bb;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}BB`;
}

/** 役名を「何の」まで含めて書く。スリーカードはセット（ポケットペア使用）かトリップスかを区別する */
export function describeHandRank(hand: HandRank, holeUsed: Card[] = []): string {
  const [a, b] = hand.highCards;
  switch (hand.rank) {
    case 9: return `${r(a)}ハイのストレートフラッシュ`;
    case 8: return `${r(a)}のフォーカード`;
    case 7: return `${r(a)}のフルハウス（${r(a)}が3枚・${r(b)}が2枚）`;
    case 6: return `${r(a)}ハイのフラッシュ`;
    case 5: return `${r(a)}ハイのストレート`;
    case 4: {
      // 使用カードが分からない（ナッツの説明など）ときはセット/トリップスを区別しない
      if (holeUsed.length < 2) return `${r(a)}のスリーカード`;
      const isSet = holeUsed.length === 2 && holeUsed.every(c => getRankValue(c.rank) === a);
      return `${r(a)}のスリーカード（${isSet ? 'セット: ホールのポケットペア使用' : 'トリップス: ボードのペア使用'}）`;
    }
    case 3: return `${r(a)}と${r(b)}のツーペア`;
    case 2: return `${r(a)}のワンペア`;
    default: return `${r(a)}ハイ（役なし）`;
  }
}

function compareRank(x: HandRank, y: HandRank): number {
  if (x.rank !== y.rank) return x.rank - y.rank;
  for (let i = 0; i < Math.max(x.highCards.length, y.highCards.length); i++) {
    const d = (x.highCards[i] ?? 0) - (y.highCards[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function unseenCards(dead: Card[]): Card[] {
  const deadKeys = new Set(dead.map(cardKey));
  return createDeck().filter(c => !deadKeys.has(cardKey(c)));
}

/** ヒーローのカードを除いた残りから、相手が作れる最強の役（＝その時点のナッツ） */
function nutHand(board: Card[], heroHole: Card[]): HandRank {
  const unseen = unseenCards([...board, ...heroHole]);
  let best: HandRank | null = null;
  for (let i = 0; i < unseen.length; i++) {
    for (let j = i + 1; j < unseen.length; j++) {
      const h = findBestPLOHand([unseen[i], unseen[j]], board)!.hand;
      if (!best || compareRank(h, best) > 0) best = h;
    }
  }
  return best!;
}

/** 次の1枚でストレート以上に改善するカードを役ごとに数える */
function countOuts(hole: Card[], board: Card[], current: HandRank): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of unseenCards([...board, ...hole])) {
    const next = findBestPLOHand(hole, [...board, c])!.hand;
    if (next.rank >= OUTS_MIN_RANK && next.rank > current.rank) {
      const name = next.rank >= 7 ? 'フルハウス以上' : next.name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

function describeAction(a: PokerStarsHandAction, who: string, bb: number): string {
  switch (a.action) {
    case 'fold': return `${who} fold`;
    case 'check': return `${who} check`;
    case 'call': return `${who} call ${fmtBb(a.amount, bb)}`;
    case 'bet': return `${who} bet ${fmtBb(a.amount, bb)}`;
    case 'raise': return `${who} raise to ${fmtBb(a.amount, bb)}`;
    case 'allin': return `${who} all-in（to ${fmtBb(a.amount, bb)}）`;
    default: return `${who} ${a.action}${a.amount > 0 ? ` ${fmtBb(a.amount, bb)}` : ''}`;
  }
}

/**
 * 1ハンド分の事実をテキストにする。カードが読めない・ダブルボード等で
 * 正確に計算できないときは null（LLM には元のハンド履歴だけを渡す）。
 */
export function buildHandFacts(hand: TournamentHandExport): string | null {
  if (hand.communityCards2.length > 0) return null;
  const me = hand.players.find(p => p.isCurrentUser);
  if (!me) return null;
  const heroHole = parseCards(me.holeCards);
  const board = parseCards(hand.communityCards);
  if (!heroHole || heroHole.length < 4 || !board) return null;

  const bb = Number(hand.blinds.split('/')[1]) || 1;
  const seats = hand.players.map(p => p.seatPosition);
  const posOf = (seat: number) => getPositionLabel(seat, hand.dealerPosition, seats);
  const whoOf = (seat: number) =>
    seat === me.seatPosition ? `${posOf(seat)}(ヒーロー)` : posOf(seat);

  const lines: string[] = [];
  const others = hand.players.filter(p => !p.isCurrentUser);
  const maxOther = Math.max(0, ...others.map(p => p.startChips));
  lines.push(
    `- ヒーロー: ${posOf(me.seatPosition)} / 開始スタック ${fmtBb(me.startChips, bb)} / ホール [${fmtCards(heroHole)}]`
  );
  lines.push(
    `- 他プレイヤーの開始スタック: ${others.map(p => `${posOf(p.seatPosition)} ${p.username} ${fmtBb(p.startChips, bb)}`).join(', ')}`
  );
  lines.push(`- ヒーローの最大有効スタック: ${fmtBb(Math.min(me.startChips, maxOther), bb)}`);

  const actions = normalizeActions(hand.actions);
  lines.push('- アクション順（ポジション表記・BB換算）:');
  for (const st of STREETS) {
    const acts = actions.filter(a => (a.street ?? 'preflop') === st.key);
    if (acts.length === 0) continue;
    const boardLabel = st.boardSize > 0 ? ` [${fmtCards(board.slice(0, st.boardSize))}]` : '';
    lines.push(`  - ${st.label}${boardLabel}: ${acts.map(a => describeAction(a, whoOf(a.seatIndex), bb)).join(' → ')}`);
  }

  // ヒーローがフォールドしたストリート以降は役を書かない
  const heroFoldStreet = actions.find(a => a.seatIndex === me.seatPosition && a.action === 'fold')?.street ?? null;
  const heroFoldIdx = heroFoldStreet ? STREETS.findIndex(s => s.key === heroFoldStreet) : Infinity;

  const handLines: string[] = [];
  for (const [idx, st] of STREETS.entries()) {
    if (st.boardSize === 0 || board.length < st.boardSize || idx > heroFoldIdx) continue;
    const b = board.slice(0, st.boardSize);
    const best = findBestPLOHand(heroHole, b)!;
    const nuts = nutHand(b, heroHole);
    const nutText =
      compareRank(best.hand, nuts) >= 0
        ? 'ナッツ'
        : `ナッツではない（この時点のナッツ: ${describeHandRank(nuts)}）`;
    let text =
      `  - ${st.label} [${fmtCards(b)}]: ${describeHandRank(best.hand, best.holeUsed)}` +
      `（ホール ${fmtCards(best.holeUsed)} + ボード ${fmtCards(best.boardUsed)}）／${nutText}`;
    if (st.boardSize < 5) {
      const outs = countOuts(heroHole, b, best.hand);
      const total = [...outs.values()].reduce((s, n) => s + n, 0);
      text += total > 0
        ? `／次の1枚でストレート以上に改善: ${total}枚（${[...outs].map(([k, n]) => `${k} ${n}`).join(', ')}）`
        : '／次の1枚でストレート以上に改善するカードなし';
    }
    handLines.push(text);
  }
  if (handLines.length > 0) {
    lines.push('- ヒーローの役（ホール2枚＋ボード3枚で計算済み）:');
    lines.push(...handLines);
  }

  if (board.length === 5) {
    const shown = others
      .map(p => ({ p, hole: parseCards(p.holeCards) }))
      .filter((x): x is { p: typeof x.p; hole: Card[] } => x.hole !== null && x.hole.length >= 2);
    for (const { p, hole } of shown) {
      const best = findBestPLOHand(hole, board)!;
      lines.push(
        `- ショーダウン: ${posOf(p.seatPosition)} ${p.username} [${fmtCards(hole)}] → ${describeHandRank(best.hand, best.holeUsed)}（ホール ${fmtCards(best.holeUsed)} + ボード ${fmtCards(best.boardUsed)}）`
      );
    }
  }

  lines.push(`- 結果: ヒーロー ${me.profit >= 0 ? '+' : ''}${fmtBb(me.profit, bb)}`);
  return lines.join('\n');
}
