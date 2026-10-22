import type { PokerStarsHandAction } from '@plo/shared';
import type { TournamentHandExport } from '../history/tournamentHandsForUser.js';

/**
 * AIレビューに渡すハンドをサーバー側で事前に絞り込む。
 *
 * トナメ1回で100〜200ハンドあるが、レビューで深掘りするのは数ハンドなので、
 * 全ハンドを LLM に渡すと入力トークンの大半が読み捨てになる。
 * ここでは学習価値の高い候補だけを選び、残りは集計値として要約する。
 */

/** LLM に PokerStars 形式で渡すハンド数の上限 */
export const MAX_KEY_HANDS = 15;

const VOLUNTARY_ACTIONS = new Set(['call', 'bet', 'raise', 'allin']);
const RAISE_ACTIONS = new Set(['raise', 'allin']);

export function normalizeActions(raw: unknown): PokerStarsHandAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
    .map(a => ({
      seatIndex: Number(a.seatIndex),
      odId: typeof a.odId === 'string' ? a.odId : undefined,
      odName: String(a.odName ?? ''),
      action: String(a.action ?? ''),
      amount: Number(a.amount ?? 0),
      street: typeof a.street === 'string' ? a.street : undefined,
    }));
}

export type HandFeatures = {
  /** 自発的にポットへ参加した（プリフロップの call/bet/raise/allin） */
  vpip: boolean;
  /** プリフロップでレイズした */
  pfr: boolean;
  /** フォールドせずにフロップを見た */
  sawFlop: boolean;
  /** 本人が関与したまま誰かがオールインした */
  allInInvolved: boolean;
  profitBb: number;
  potBb: number;
};

function bigBlindOf(blinds: string): number {
  const bb = Number(blinds.split('/')[1]);
  return Number.isFinite(bb) && bb > 0 ? bb : 1;
}

export function computeHandFeatures(hand: TournamentHandExport): HandFeatures | null {
  const me = hand.players.find(p => p.isCurrentUser);
  if (!me) return null;

  const bb = bigBlindOf(hand.blinds);
  const actions = normalizeActions(hand.actions);
  const mine = actions.filter(a => a.seatIndex === me.seatPosition);
  const minePreflop = mine.filter(a => (a.street ?? 'preflop') === 'preflop');
  const foldedPreflop = minePreflop.some(a => a.action === 'fold');
  const folded = mine.some(a => a.action === 'fold');

  return {
    vpip: minePreflop.some(a => VOLUNTARY_ACTIONS.has(a.action)),
    pfr: minePreflop.some(a => RAISE_ACTIONS.has(a.action)),
    sawFlop: !foldedPreflop && hand.communityCards.length >= 3,
    allInInvolved: !folded && actions.some(a => a.action === 'allin'),
    profitBb: me.profit / bb,
    potBb: hand.potSize / bb,
  };
}

/** 学習価値の目安。損益の振れ・ポットの大きさ・オールインを重視する */
function scoreHand(f: HandFeatures): number {
  return (
    Math.abs(f.profitBb) +
    f.potBb * 0.5 +
    (f.allInInvolved ? 30 : 0) +
    (f.sawFlop ? 5 : 0) +
    (f.vpip ? 2 : 0)
  );
}

/** ブラインドを払ってフォールドしただけのような、レビュー価値のないハンドを除く */
function isCandidate(f: HandFeatures): boolean {
  return f.vpip || f.sawFlop || f.allInInvolved || Math.abs(f.profitBb) >= 3;
}

export type HandsSummary = {
  totalHands: number;
  selectedHands: number;
  vpipHands: number;
  pfrHands: number;
  sawFlopHands: number;
  allInHands: number;
  /** LLM に渡さなかったハンドの合計損益（BB換算） */
  omittedProfitBb: number;
};

export type KeyHandSelection = {
  /** 時系列順 */
  selected: TournamentHandExport[];
  summary: HandsSummary;
};

export function selectKeyHands(
  hands: TournamentHandExport[],
  maxHands: number = MAX_KEY_HANDS
): KeyHandSelection {
  const featured = hands.map((hand, index) => ({ hand, index, f: computeHandFeatures(hand) }));

  // 上限なし（旧挙動との比較用）は候補判定もせず全ハンドを渡す
  const ranked = featured
    .filter(x => x.f !== null && (!Number.isFinite(maxHands) || isCandidate(x.f)))
    .sort((a, b) => scoreHand(b.f!) - scoreHand(a.f!));

  const picked = new Set(ranked.slice(0, maxHands).map(x => x.index));

  // 最後のハンド（敗退・優勝が決まったハンド）は結果に直結するので必ず含める
  const lastIndex = hands.length - 1;
  if (lastIndex >= 0 && !picked.has(lastIndex) && maxHands > 0) {
    const weakest = ranked.slice(0, maxHands).at(-1);
    if (picked.size >= maxHands && weakest) picked.delete(weakest.index);
    picked.add(lastIndex);
  }

  const summary: HandsSummary = {
    totalHands: hands.length,
    selectedHands: picked.size,
    vpipHands: 0,
    pfrHands: 0,
    sawFlopHands: 0,
    allInHands: 0,
    omittedProfitBb: 0,
  };
  for (const { index, f } of featured) {
    if (!f) continue;
    if (f.vpip) summary.vpipHands++;
    if (f.pfr) summary.pfrHands++;
    if (f.sawFlop) summary.sawFlopHands++;
    if (f.allInInvolved) summary.allInHands++;
    if (!picked.has(index)) summary.omittedProfitBb += f.profitBb;
  }

  return {
    selected: featured.filter(x => picked.has(x.index)).map(x => x.hand),
    summary,
  };
}

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '-';
}

export function formatHandsSummary(s: HandsSummary): string {
  return [
    `- 全ハンド数: ${s.totalHands}（うち下記に詳細を載せたのは ${s.selectedHands} ハンド）`,
    `- VPIP: ${pct(s.vpipHands, s.totalHands)}（${s.vpipHands}/${s.totalHands}）`,
    `- PFR: ${pct(s.pfrHands, s.totalHands)}（${s.pfrHands}/${s.totalHands}）`,
    `- フロップ参加: ${s.sawFlopHands} ハンド / オールイン関与: ${s.allInHands} ハンド`,
    `- 詳細を省いたハンドの合計損益: ${s.omittedProfitBb >= 0 ? '+' : ''}${s.omittedProfitBb.toFixed(1)} BB`,
  ].join('\n');
}
