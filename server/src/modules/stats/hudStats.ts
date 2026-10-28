// プライベート卓 HUD のスタッツ計算（DB依存なし）。ポストフロップはフロップのみを見る。
//
// 「アグレッシブ」= bet / raise、またはベット額を上げるオールイン。
// オールインがレイズかどうかはブラインド込みのストリート拠出額を再現して判定する。

import { HUD_STAT_KEYS, getPositionLabelsBySeat, type HudStatKey, type PlayerHudStats } from '@plo/shared';

export interface HudAction {
  seatIndex: number;
  odId: string;
  action: string;
  amount: number;
  street?: string;
}

export interface HudHandInput {
  actions: HudAction[];
  dealerPosition: number;
  /** ハンドに配られた全員（アクションのない BB ウォークも含めるため席と odId を別に持つ） */
  players: { seatIndex: number; odId: string }[];
  smallBlind: number;
  bigBlind: number;
}

interface Annotated extends HudAction {
  aggressive: boolean;
}

export function emptyHud(): PlayerHudStats {
  const hud = { hands: 0 } as PlayerHudStats;
  for (const key of HUD_STAT_KEYS) hud[key] = { n: 0, d: 0 };
  return hud;
}

export function addHud(a: PlayerHudStats, b: PlayerHudStats): PlayerHudStats {
  const sum = { hands: a.hands + b.hands } as PlayerHudStats;
  for (const key of HUD_STAT_KEYS) sum[key] = { n: a[key].n + b[key].n, d: a[key].d + b[key].d };
  return sum;
}

function annotate(input: HudHandInput, positions: Map<number, string>): Annotated[] {
  const sbSeat = [...positions].find(([, p]) => p === 'SB')?.[0];
  const bbSeat = [...positions].find(([, p]) => p === 'BB')?.[0];
  let street: string | undefined;
  let contrib = new Map<number, number>();
  let level = 0;
  return input.actions.map(a => {
    if (a.street !== street) {
      street = a.street;
      contrib = new Map();
      level = 0;
      if (street === 'preflop') {
        if (sbSeat !== undefined) contrib.set(sbSeat, input.smallBlind);
        if (bbSeat !== undefined) contrib.set(bbSeat, input.bigBlind);
        level = input.bigBlind;
      }
    }
    const total = (contrib.get(a.seatIndex) ?? 0) + (a.action === 'fold' || a.action === 'check' ? 0 : a.amount);
    contrib.set(a.seatIndex, total);
    const aggressive = a.action === 'bet' || a.action === 'raise' || (a.action === 'allin' && total > level);
    if (total > level) level = total;
    return { ...a, aggressive };
  });
}

/** list[from..] で odId の最初の行動の位置。見つからなければ -1 */
function nextActionOf(list: Annotated[], odId: string, from: number): number {
  for (let i = from; i < list.length; i++) if (list[i].odId === odId) return i;
  return -1;
}

/** 位置 at のアクションに直面した odId が、間に別のアグレッシブなしで行動した位置。なければ -1 */
function responseTo(list: Annotated[], odId: string, at: number): number {
  for (let i = at + 1; i < list.length; i++) {
    if (list[i].odId === odId) return i;
    if (list[i].aggressive) return -1;
  }
  return -1;
}

/** ハンドに配られた全員分の HUD 増分（各 0/1）を返す */
export function computeHandHud(input: HudHandInput): Map<string, PlayerHudStats> {
  const result = new Map<string, PlayerHudStats>();
  const positions = getPositionLabelsBySeat(input.dealerPosition, input.players.map(p => p.seatIndex));
  const all = annotate(input, positions);
  const pre = all.filter(a => a.street === 'preflop');
  const flop = all.filter(a => a.street === 'flop');
  const raises = pre.filter(a => a.aggressive);
  const pfa = raises.at(-1)?.odId ?? null;
  const preFolders = new Set(pre.filter(a => a.action === 'fold').map(a => a.odId));

  const sawFlop = flop.length > 0 ? input.players.filter(p => !preFolders.has(p.odId)).length : 0;
  const headsUpFlop = sawFlop === 2;
  const firstFlopAggr = flop.findIndex(a => a.aggressive);

  for (const { seatIndex: seat, odId } of input.players) {
    const hud = emptyHud();
    const mark = (key: HudStatKey, hit: boolean) => { hud[key].d = 1; if (hit) hud[key].n = 1; };
    hud.hands = 1;

    // VPIP / PFR / 3Bet
    const myPre = pre.filter(a => a.odId === odId);
    const isBB = positions.get(seat) === 'BB';
    mark('vpip', myPre.some(a => a.action === 'call' || a.action === 'allin' || a.aggressive));
    mark('pfr', myPre.some(a => a.aggressive));
    const firstPre = nextActionOf(pre, odId, 0);
    if (raises[0] && raises[0].odId !== odId) {
      const r = responseTo(pre, odId, pre.indexOf(raises[0]));
      if (r !== -1) mark('threeBet', pre[r].aggressive);
    }

    // Fold to 3B / 4Bet: 自分のオープンに 3bet を受けたとき
    if (raises[0]?.odId === odId && raises[1]) {
      const r = responseTo(pre, odId, pre.indexOf(raises[1]));
      if (r !== -1) {
        mark('foldTo3Bet', pre[r].action === 'fold');
        mark('fourBet', pre[r].aggressive);
      }
    }
    // Fold to 4B: 自分の 3bet に 4bet を受けたとき
    if (raises[1]?.odId === odId && raises[2]) {
      const r = responseTo(pre, odId, pre.indexOf(raises[2]));
      if (r !== -1) mark('foldTo4Bet', pre[r].action === 'fold');
    }

    if (firstPre !== -1) {
      const before = pre.slice(0, firstPre);
      // Steal: CO / BTN / SB で前が全員フォールド（4人卓は BTN の前の席が UTG 表示なのでそれを CO とみなす）
      const stealPositions = positions.size === 4 ? ['UTG', 'BTN', 'SB'] : ['CO', 'BTN', 'SB'];
      if (stealPositions.includes(positions.get(seat) ?? '') && before.every(a => a.action === 'fold')) {
        mark('steal', pre[firstPre].aggressive);
      }
      // BB vs オープン: 1人のオープン、ほか全員フォールド
      if (isBB && before.filter(a => a.aggressive).length === 1 && before.every(a => a.aggressive || a.action === 'fold')) {
        mark('bbFoldVsOpen', pre[firstPre].action === 'fold');
        mark('bb3BetVsOpen', pre[firstPre].aggressive);
      }
    }

    // ---- フロップ ----
    const myFlop = nextActionOf(flop, odId, 0);
    if (myFlop !== -1) {
      const noBetBefore = firstFlopAggr === -1 || firstFlopAggr >= myFlop;
      const pfaFlop = pfa ? nextActionOf(flop, pfa, 0) : -1;

      if (pfa && pfa !== odId && noBetBefore) {
        // Donk: レイザーより先に行動
        if (pfaFlop > myFlop) mark('donk', flop[myFlop].aggressive);
        // BMCB: レイザーがチェックした後
        if (pfaFlop !== -1 && pfaFlop < myFlop && flop[pfaFlop].action === 'check') mark('bmcb', flop[myFlop].aggressive);
      }

      // XR: チェック後に他者のベットを受けたとき（間に別の人のレイズが入っても数える）
      if (flop[myFlop].action === 'check' && firstFlopAggr > myFlop && flop[firstFlopAggr].odId !== odId) {
        const r = nextActionOf(flop, odId, firstFlopAggr + 1);
        if (r !== -1) mark('checkRaise', flop[r].aggressive);
      }

      if (headsUpFlop && noBetBefore) {
        // CB: シングルレイズドポットのレイザー
        if (raises.length === 1 && pfa === odId) mark('cbet', flop[myFlop].aggressive);
        // 3Bet CB: 自分が 3bet したポット
        if (raises.length === 2 && raises[1].odId === odId) mark('threeBetCbet', flop[myFlop].aggressive);
      }
      // Fold to CB: シングルレイズドポットで、ヘッズアップでレイザーのベットを受けたとき
      if (headsUpFlop && raises.length === 1 && pfa !== odId && firstFlopAggr !== -1
          && flop[firstFlopAggr].odId === pfa && nextActionOf(flop, pfa, 0) === firstFlopAggr) {
        const r = responseTo(flop, odId, firstFlopAggr);
        if (r !== -1) mark('foldToCbet', flop[r].action === 'fold');
      }
    }

    result.set(odId, hud);
  }
  return result;
}
