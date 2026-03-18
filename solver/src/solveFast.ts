/**
 * 高速版CFRソルバー
 *
 * エクイティ計算を既存のpreflopEquity.jsonデータ（vs ランダム）で近似。
 * 正確なペアワイズエクイティではないが、桁違いに高速。
 *
 * 近似方法: ハンドAのエクイティがeqA、ハンドBがeqBのとき、
 * AがBに勝つ確率 ≈ eqA / (eqA + eqB)
 * これは「両者のvsランダムエクイティの比」で近似するもの。
 * 完璧ではないが、ハンドの相対的な強さの序列はかなり保存される。
 */

import { canonicalKey, DECK_SIZE, handToString, cardToString } from './enumerate.js';
import * as fs from 'fs';

// --- 既存エクイティデータの読み込み ---

const equityDataPath = new URL('../../packages/shared/src/data/preflopEquity.json', import.meta.url).pathname;
const equityMap: Record<string, number> = JSON.parse(fs.readFileSync(equityDataPath, 'utf-8'));

function getHandEquity(hand: number[]): number {
  const key = canonicalKey(hand);
  return equityMap[key] ?? 50; // デフォルト50%
}

/**
 * 近似ペアワイズエクイティ: handA vs handB
 * eqA / (eqA + eqB) で近似
 */
function approxEquity(handA: number[], handB: number[]): number {
  const eqA = getHandEquity(handA);
  const eqB = getHandEquity(handB);
  return eqA / (eqA + eqB);
}

// --- HU ゲーム ---

const MAX_RAISES = 5;
type Action = 'f' | 'c' | 'r';

interface State {
  bets: [number, number];
  player: 0 | 1;
  raises: number;
  history: string;
}

function initState(): State {
  return { bets: [0.5, 1.0], player: 0, raises: 0, history: '' };
}

function getActions(s: State): Action[] {
  const maxBet = Math.max(s.bets[0], s.bets[1]);
  const actions: Action[] = [];
  if (maxBet > s.bets[s.player]) actions.push('f');
  actions.push('c');
  if (s.raises < MAX_RAISES) actions.push('r');
  return actions;
}

function applyAction(s: State, a: Action): State | 'fold_win' | 'showdown' {
  const bets: [number, number] = [s.bets[0], s.bets[1]];
  const opp: 0 | 1 = s.player === 0 ? 1 : 0;

  if (a === 'f') return 'fold_win';

  if (a === 'c') {
    bets[s.player] = Math.max(bets[0], bets[1]);
    if (s.history === '') {
      // SB limp → BB to act
      return { bets, player: 1, raises: s.raises, history: s.history + a };
    }
    return 'showdown';
  }

  // raise (pot)
  const maxBet = Math.max(bets[0], bets[1]);
  const callAmt = maxBet - bets[s.player];
  const potAfterCall = bets[0] + bets[1] + callAmt;
  bets[s.player] = callAmt + potAfterCall;

  return {
    bets,
    player: opp,
    raises: s.raises + 1,
    history: s.history + a,
  };
}

// --- CFR ---

interface InfoSet {
  regret: Float64Array;
  stratSum: Float64Array;
  actions: Action[];
}

const infoSets = new Map<string, InfoSet>();

function getInfoSet(key: string, actions: Action[]): InfoSet {
  let is = infoSets.get(key);
  if (!is) {
    is = {
      regret: new Float64Array(actions.length),
      stratSum: new Float64Array(actions.length),
      actions,
    };
    infoSets.set(key, is);
  }
  return is;
}

function getStrategy(is: InfoSet, weight: number): Float64Array {
  const strat = new Float64Array(is.actions.length);
  let sum = 0;
  for (let i = 0; i < is.actions.length; i++) {
    strat[i] = Math.max(0, is.regret[i]);
    sum += strat[i];
  }
  for (let i = 0; i < is.actions.length; i++) {
    strat[i] = sum > 0 ? strat[i] / sum : 1 / is.actions.length;
    is.stratSum[i] += weight * strat[i];
  }
  return strat;
}

function avgStrategy(is: InfoSet): Float64Array {
  const avg = new Float64Array(is.actions.length);
  let sum = 0;
  for (let i = 0; i < is.actions.length; i++) sum += is.stratSum[i];
  for (let i = 0; i < is.actions.length; i++) {
    avg[i] = sum > 0 ? is.stratSum[i] / sum : 1 / is.actions.length;
  }
  return avg;
}

function cfr(
  state: State,
  hands: [number[], number[]],
  reach: [number, number],
): [number, number] {
  const p = state.player;
  const opp: 0 | 1 = p === 0 ? 1 : 0;
  const actions = getActions(state);
  const handKey = canonicalKey(hands[p]);
  const isKey = `${handKey}:${state.history}`;
  const is = getInfoSet(isKey, actions);
  const strat = getStrategy(is, reach[p]);

  const actionUtils: [number, number][] = [];

  for (let i = 0; i < actions.length; i++) {
    const result = applyAction(state, actions[i]);

    if (result === 'fold_win') {
      // 相手がポット獲得
      const pot = state.bets[0] + state.bets[1];
      const payoff: [number, number] = [-state.bets[0], -state.bets[1]];
      payoff[opp] += pot;
      actionUtils.push(payoff);
    } else if (result === 'showdown') {
      const bets: [number, number] = [state.bets[0], state.bets[1]];
      bets[p] = Math.max(bets[0], bets[1]); // call
      const pot = bets[0] + bets[1];
      const eq = approxEquity(hands[0], hands[1]);
      actionUtils.push([
        -bets[0] + pot * eq,
        -bets[1] + pot * (1 - eq),
      ]);
    } else {
      // 次の状態へ
      const newReach: [number, number] = [reach[0], reach[1]];
      newReach[p] *= strat[i];
      actionUtils.push(cfr(result, hands, newReach));
    }
  }

  // ノード値
  const nodeVal: [number, number] = [0, 0];
  for (let i = 0; i < actions.length; i++) {
    nodeVal[0] += strat[i] * actionUtils[i][0];
    nodeVal[1] += strat[i] * actionUtils[i][1];
  }

  // Regret更新
  for (let i = 0; i < actions.length; i++) {
    is.regret[i] += reach[opp] * (actionUtils[i][p] - nodeVal[p]);
  }

  return nodeVal;
}

// --- ハンドサンプリング ---

function sampleHands(): [number[], number[]] {
  const deck: number[] = [];
  for (let i = 0; i < DECK_SIZE; i++) deck.push(i);
  for (let i = 0; i < 8; i++) {
    const j = i + Math.floor(Math.random() * (deck.length - i));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return [
    [deck[0], deck[1], deck[2], deck[3]],
    [deck[4], deck[5], deck[6], deck[7]],
  ];
}

// --- メイン ---

const ITERATIONS = 500_000;
const REPORT = 50_000;

console.log('=== PLO Preflop CFR Solver (Fast Approximate) ===');
console.log(`Iterations: ${ITERATIONS.toLocaleString()}`);
console.log(`Using pre-computed equity data (vs random approximation)\n`);

const t0 = performance.now();
let totalUtil = 0;

for (let iter = 1; iter <= ITERATIONS; iter++) {
  const hands = sampleHands();
  const s0 = initState();
  const [v0] = cfr(s0, hands, [1, 1]);
  totalUtil += v0;

  if (iter % REPORT === 0) {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`  iter=${iter.toLocaleString()}  avgUtil(SB)=${(totalUtil / iter).toFixed(4)}bb  infoSets=${infoSets.size.toLocaleString()}  time=${elapsed}s`);
  }
}

const totalTime = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`\nDone in ${totalTime}s`);
console.log(`Info sets: ${infoSets.size.toLocaleString()}`);
console.log(`Average SB utility: ${(totalUtil / ITERATIONS).toFixed(4)}bb\n`);

// --- 結果表示 ---

// canonicalKeyから人間が読める表記に変換
function keyToReadable(key: string): string {
  const parts = key.split('-');
  const rankNames = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suitNames = ['h', 'd', 'c', 's'];
  return parts.map(p => {
    const [r, s] = p.split('.');
    return rankNames[parseInt(r)] + suitNames[parseInt(s)];
  }).join('');
}

// SBのオープン戦略
console.log('=== SB Open Strategy ===\n');

const sbOpenData: { hand: string; readable: string; eq: number; f: number; c: number; r: number }[] = [];

for (const [key, is] of infoSets) {
  const [handKey, history] = key.split(':');
  if (history !== '') continue;

  const avg = avgStrategy(is);
  const strat: Record<string, number> = {};
  for (let i = 0; i < is.actions.length; i++) {
    strat[is.actions[i]] = avg[i];
  }

  sbOpenData.push({
    hand: handKey,
    readable: keyToReadable(handKey),
    eq: equityMap[handKey] ?? 0,
    f: strat.f ?? 0,
    c: strat.c ?? 0,
    r: strat.r ?? 0,
  });
}

// エクイティ順でソート
sbOpenData.sort((a, b) => b.eq - a.eq);

console.log(`Total unique hands at SB open: ${sbOpenData.length}\n`);
console.log(`${'Hand'.padEnd(20)} ${'Eq%'.padStart(6)} ${'Fold'.padStart(8)} ${'Limp'.padStart(8)} ${'Raise'.padStart(8)}`);
console.log('-'.repeat(55));

for (const s of sbOpenData.slice(0, 30)) {
  console.log(
    `${s.readable.padEnd(20)} ${s.eq.toFixed(1).padStart(6)} ${(s.f * 100).toFixed(1).padStart(7)}% ${(s.c * 100).toFixed(1).padStart(7)}% ${(s.r * 100).toFixed(1).padStart(7)}%`
  );
}

console.log('...');
console.log('\n--- Bottom 10 ---');
for (const s of sbOpenData.slice(-10)) {
  console.log(
    `${s.readable.padEnd(20)} ${s.eq.toFixed(1).padStart(6)} ${(s.f * 100).toFixed(1).padStart(7)}% ${(s.c * 100).toFixed(1).padStart(7)}% ${(s.r * 100).toFixed(1).padStart(7)}%`
  );
}

// BBの vs レイズ戦略
console.log('\n=== BB vs SB Raise ===\n');

const bbVsRaise: { hand: string; readable: string; eq: number; f: number; c: number; r: number }[] = [];

for (const [key, is] of infoSets) {
  const [handKey, history] = key.split(':');
  if (history !== 'r') continue;

  const avg = avgStrategy(is);
  const strat: Record<string, number> = {};
  for (let i = 0; i < is.actions.length; i++) {
    strat[is.actions[i]] = avg[i];
  }

  bbVsRaise.push({
    hand: handKey,
    readable: keyToReadable(handKey),
    eq: equityMap[handKey] ?? 0,
    f: strat.f ?? 0,
    c: strat.c ?? 0,
    r: strat.r ?? 0,
  });
}

bbVsRaise.sort((a, b) => b.eq - a.eq);

console.log(`Total unique hands at BB vs raise: ${bbVsRaise.length}\n`);
console.log(`${'Hand'.padEnd(20)} ${'Eq%'.padStart(6)} ${'Fold'.padStart(8)} ${'Call'.padStart(8)} ${'3Bet'.padStart(8)}`);
console.log('-'.repeat(55));

for (const s of bbVsRaise.slice(0, 30)) {
  console.log(
    `${s.readable.padEnd(20)} ${s.eq.toFixed(1).padStart(6)} ${(s.f * 100).toFixed(1).padStart(7)}% ${(s.c * 100).toFixed(1).padStart(7)}% ${(s.r * 100).toFixed(1).padStart(7)}%`
  );
}

// サマリ統計
const sbRaiseRate = sbOpenData.length > 0
  ? sbOpenData.reduce((s, d) => s + d.r, 0) / sbOpenData.length
  : 0;
const sbLimpRate = sbOpenData.length > 0
  ? sbOpenData.reduce((s, d) => s + d.c, 0) / sbOpenData.length
  : 0;
const sbFoldRate = sbOpenData.length > 0
  ? sbOpenData.reduce((s, d) => s + d.f, 0) / sbOpenData.length
  : 0;

console.log('\n=== Summary ===');
console.log(`SB Open: Raise ${(sbRaiseRate * 100).toFixed(1)}% | Limp ${(sbLimpRate * 100).toFixed(1)}% | Fold ${(sbFoldRate * 100).toFixed(1)}%`);

const bb3betRate = bbVsRaise.length > 0
  ? bbVsRaise.reduce((s, d) => s + d.r, 0) / bbVsRaise.length
  : 0;
const bbCallRate = bbVsRaise.length > 0
  ? bbVsRaise.reduce((s, d) => s + d.c, 0) / bbVsRaise.length
  : 0;
const bbFoldRate = bbVsRaise.length > 0
  ? bbVsRaise.reduce((s, d) => s + d.f, 0) / bbVsRaise.length
  : 0;

console.log(`BB vs Raise: 3Bet ${(bb3betRate * 100).toFixed(1)}% | Call ${(bbCallRate * 100).toFixed(1)}% | Fold ${(bbFoldRate * 100).toFixed(1)}%`);

// --- JSON保存 ---
const result = {
  meta: {
    iterations: ITERATIONS,
    infoSets: infoSets.size,
    avgSBUtility: totalUtil / ITERATIONS,
    timeSeconds: parseFloat(totalTime),
  },
  sbOpen: sbOpenData.map(d => ({
    hand: d.readable,
    key: d.hand,
    equity: d.eq,
    fold: Math.round(d.f * 1000) / 1000,
    limp: Math.round(d.c * 1000) / 1000,
    raise: Math.round(d.r * 1000) / 1000,
  })),
  bbVsRaise: bbVsRaise.map(d => ({
    hand: d.readable,
    key: d.hand,
    equity: d.eq,
    fold: Math.round(d.f * 1000) / 1000,
    call: Math.round(d.c * 1000) / 1000,
    threeBet: Math.round(d.r * 1000) / 1000,
  })),
};

const outPath = new URL('../data/solverResult.json', import.meta.url).pathname;
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nResults saved to ${outPath}`);
