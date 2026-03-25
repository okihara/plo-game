/**
 * ステップ4: CFR (Counterfactual Regret Minimization) ソルバー
 *
 * まずヘッズアップ（SB vs BB）で実装し、動作確認後に6maxへ拡張。
 * エクイティは既存の事前計算データ（vs ランダム）を簡易的に使用し、
 * 後でペアワイズエクイティに置き換え可能。
 */

import { canonicalKey, enumerateHandClusters, HandCluster, DECK_SIZE, cardRank, cardSuit, handToString } from './enumerate.js';
import { monteCarloEquity, evaluatePLO } from './equity.js';

// --- ヘッズアップ ゲームツリー (SB vs BB) ---
// SB = player 0 (posts 0.5bb, acts first)
// BB = player 1 (posts 1.0bb, acts second)
// Pot Limit

const MAX_RAISES_HU = 5; // open, 3bet, 4bet, 5bet, cap

type HUAction = 'f' | 'c' | 'r'; // fold, call, raise(pot)

interface HUState {
  bets: [number, number];
  currentPlayer: 0 | 1;
  numRaises: number;
  history: string;
  isTerminal: boolean;
  winner?: 0 | 1;       // フォールド時の勝者
  isShowdown?: boolean;  // ショーダウンに到達
}

function huInitialState(): HUState {
  return {
    bets: [0.5, 1.0],
    currentPlayer: 0, // SB acts first preflop
    numRaises: 0,
    history: '',
    isTerminal: false,
  };
}

function huPotLimitRaise(state: HUState): number {
  const maxBet = Math.max(state.bets[0], state.bets[1]);
  const currentBet = state.bets[state.currentPlayer];
  const callAmount = maxBet - currentBet;
  const potAfterCall = state.bets[0] + state.bets[1] + callAmount;
  return callAmount + potAfterCall;
}

function huGetActions(state: HUState): HUAction[] {
  const maxBet = Math.max(state.bets[0], state.bets[1]);
  const currentBet = state.bets[state.currentPlayer];
  const actions: HUAction[] = [];

  // フォールド（ベットに直面しているとき）
  if (maxBet > currentBet) {
    actions.push('f');
  }

  // コール/チェック
  actions.push('c');

  // レイズ（キャップ未満）
  if (state.numRaises < MAX_RAISES_HU) {
    actions.push('r');
  }

  return actions;
}

function huApplyAction(state: HUState, action: HUAction): HUState {
  const bets: [number, number] = [state.bets[0], state.bets[1]];
  const p = state.currentPlayer;
  const opp: 0 | 1 = p === 0 ? 1 : 0;
  let numRaises = state.numRaises;
  const history = state.history + action;

  if (action === 'f') {
    return {
      bets,
      currentPlayer: opp,
      numRaises,
      history,
      isTerminal: true,
      winner: opp,
    };
  }

  if (action === 'c') {
    bets[p] = Math.max(bets[0], bets[1]);

    // SBがfirst actionでコール（limp）→ BBにアクション
    // BBがコール → ショーダウン（SBのオープンコール後にBBがチェック、またはレイズ後のコール）
    const bothActed = history.length >= 2; // 少なくとも2アクション後
    const isFirstAction = state.history === '';

    if (isFirstAction) {
      // SBがlimp → BBにアクション
      return {
        bets,
        currentPlayer: 1,
        numRaises,
        history,
        isTerminal: false,
      };
    }

    // コール = ラウンド終了 → ショーダウン
    return {
      bets,
      currentPlayer: opp,
      numRaises,
      history,
      isTerminal: true,
      isShowdown: true,
    };
  }

  // raise
  const raiseTo = huPotLimitRaise(state);
  bets[p] = raiseTo;
  numRaises++;

  return {
    bets,
    currentPlayer: opp,
    numRaises,
    history,
    isTerminal: false,
  };
}

// --- 情報セットのregret/strategy テーブル ---

interface InfoSetData {
  regretSum: Float64Array;    // 累積regret
  strategySum: Float64Array;  // 累積strategy（平均strategy計算用）
  actions: HUAction[];
}

const infoSetMap = new Map<string, InfoSetData>();

function getInfoSet(key: string, actions: HUAction[]): InfoSetData {
  let data = infoSetMap.get(key);
  if (!data) {
    data = {
      regretSum: new Float64Array(actions.length),
      strategySum: new Float64Array(actions.length),
      actions,
    };
    infoSetMap.set(key, data);
  }
  return data;
}

/**
 * Regret-matching: 正のregretに比例した確率で戦略を決定
 */
function getStrategy(infoSet: InfoSetData, realizationWeight: number): Float64Array {
  const strategy = new Float64Array(infoSet.actions.length);
  let normalizingSum = 0;

  for (let i = 0; i < infoSet.actions.length; i++) {
    strategy[i] = Math.max(0, infoSet.regretSum[i]);
    normalizingSum += strategy[i];
  }

  for (let i = 0; i < infoSet.actions.length; i++) {
    if (normalizingSum > 0) {
      strategy[i] /= normalizingSum;
    } else {
      strategy[i] = 1.0 / infoSet.actions.length; // 均等
    }
    infoSet.strategySum[i] += realizationWeight * strategy[i];
  }

  return strategy;
}

/**
 * 平均戦略を取得（収束後の最終戦略）
 */
function getAverageStrategy(infoSet: InfoSetData): Float64Array {
  const avg = new Float64Array(infoSet.actions.length);
  let normalizingSum = 0;

  for (let i = 0; i < infoSet.actions.length; i++) {
    normalizingSum += infoSet.strategySum[i];
  }

  for (let i = 0; i < infoSet.actions.length; i++) {
    if (normalizingSum > 0) {
      avg[i] = infoSet.strategySum[i] / normalizingSum;
    } else {
      avg[i] = 1.0 / infoSet.actions.length;
    }
  }

  return avg;
}

// --- エクイティキャッシュ ---

// canonicalKey ペア → エクイティ のキャッシュ
const equityCache = new Map<string, number>();
const EQUITY_ITERATIONS = 500; // プロトタイプ用。精度を上げるには増やす。

function getCachedEquity(handA: number[], handB: number[]): number {
  // カード重複チェック
  const cardSet = new Set([...handA, ...handB]);
  if (cardSet.size !== 8) return NaN;

  const keyA = canonicalKey(handA);
  const keyB = canonicalKey(handB);
  const cacheKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;

  let eq = equityCache.get(cacheKey);
  if (eq !== undefined) {
    return keyA <= keyB ? eq : 1 - eq;
  }

  eq = monteCarloEquity(handA, handB, EQUITY_ITERATIONS);
  equityCache.set(cacheKey, eq);
  return keyA <= keyB ? eq : 1 - eq;
}

// --- CFR メインループ ---

/**
 * CFR の再帰関数
 * @param state 現在のゲーム状態
 * @param hands [player0のハンド, player1のハンド]
 * @param reachProbs [player0の到達確率, player1の到達確率]
 * @returns 各プレイヤーの期待値（counterfactual value）
 */
function cfr(
  state: HUState,
  hands: [number[], number[]],
  reachProbs: [number, number],
): [number, number] {
  // ターミナルノード
  if (state.isTerminal) {
    const pot = state.bets[0] + state.bets[1];

    if (state.winner !== undefined) {
      // フォールド勝ち
      const payoff: [number, number] = [-state.bets[0], -state.bets[1]];
      payoff[state.winner] += pot;
      return payoff;
    }

    // ショーダウン — エクイティで分配
    const eq = getCachedEquity(hands[0], hands[1]);
    if (isNaN(eq)) {
      // カード重複 — ありえないハンドペア
      return [0, 0];
    }
    return [
      -state.bets[0] + pot * eq,
      -state.bets[1] + pot * (1 - eq),
    ];
  }

  const p = state.currentPlayer;
  const opp: 0 | 1 = p === 0 ? 1 : 0;
  const actions = huGetActions(state);
  const handKey = canonicalKey(hands[p]);
  const infoKey = `${handKey}:${state.history}`;

  const infoSet = getInfoSet(infoKey, actions);
  const strategy = getStrategy(infoSet, reachProbs[p]);

  const actionValues: [number, number][] = [];

  for (let i = 0; i < actions.length; i++) {
    const nextState = huApplyAction(state, actions[i]);
    const newReach: [number, number] = [reachProbs[0], reachProbs[1]];
    newReach[p] *= strategy[i];
    actionValues.push(cfr(nextState, hands, newReach));
  }

  // 各プレイヤーの期待値
  const nodeValue: [number, number] = [0, 0];
  for (let i = 0; i < actions.length; i++) {
    nodeValue[0] += strategy[i] * actionValues[i][0];
    nodeValue[1] += strategy[i] * actionValues[i][1];
  }

  // Regret 更新（現在のプレイヤーのみ）
  for (let i = 0; i < actions.length; i++) {
    const regret = actionValues[i][p] - nodeValue[p];
    infoSet.regretSum[i] += reachProbs[opp] * regret;
  }

  return nodeValue;
}

// --- ハンドサンプリング ---

/**
 * ランダムなハンドペア（カード重複なし）をサンプリング
 */
function sampleHandPair(): [number[], number[]] | null {
  // デッキからランダムに8枚
  const deck: number[] = [];
  for (let i = 0; i < DECK_SIZE; i++) deck.push(i);

  // Fisher-Yates で8枚シャッフル
  for (let i = 0; i < 8; i++) {
    const j = i + Math.floor(Math.random() * (deck.length - i));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return [
    [deck[0], deck[1], deck[2], deck[3]],
    [deck[4], deck[5], deck[6], deck[7]],
  ];
}

// --- メイン実行 ---

async function main() {
  console.log('=== PLO Preflop CFR Solver (Heads-Up SB vs BB) ===\n');

  const ITERATIONS = 50_000;
  const REPORT_INTERVAL = 5_000;

  console.log(`Iterations: ${ITERATIONS.toLocaleString()}`);
  console.log(`Equity MC iterations per matchup: ${EQUITY_ITERATIONS}`);
  console.log('');

  const startTime = performance.now();
  let totalUtil = 0;

  for (let iter = 1; iter <= ITERATIONS; iter++) {
    const hands = sampleHandPair();
    if (!hands) continue;

    const state = huInitialState();
    const [v0, v1] = cfr(state, hands, [1, 1]);
    totalUtil += v0;

    if (iter % REPORT_INTERVAL === 0) {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      const avgUtil = (totalUtil / iter).toFixed(4);
      console.log(`  iter=${iter.toLocaleString()}  avgUtil(SB)=${avgUtil}bb  infoSets=${infoSetMap.size.toLocaleString()}  equityCache=${equityCache.size.toLocaleString()}  time=${elapsed}s`);
    }
  }

  const totalElapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${totalElapsed}s`);
  console.log(`Info sets: ${infoSetMap.size.toLocaleString()}`);
  console.log(`Equity cache entries: ${equityCache.size.toLocaleString()}`);
  console.log(`Average SB utility: ${(totalUtil / ITERATIONS).toFixed(4)}bb`);

  // --- 結果表示 ---
  printResults();
}

function printResults() {
  console.log('\n=== Results: Average Strategy ===\n');

  // ルートノードの戦略を表示（SBの最初のアクション）
  // 情報セットをグループ化して表示
  const rootSets: { key: string; data: InfoSetData }[] = [];
  const threeBetSets: { key: string; data: InfoSetData }[] = [];

  for (const [key, data] of infoSetMap) {
    const [handKey, history] = key.split(':');
    if (history === '') {
      rootSets.push({ key, data });
    } else if (history === 'rc') {
      // BBが SBのレイズに対して
    } else if (history === 'r') {
      threeBetSets.push({ key, data });
    }
  }

  // SBのオープン戦略（上位20ハンド）
  console.log('--- SB Open Strategy (top 20 hands by raise%) ---');
  const sbOpen = rootSets
    .map(({ key, data }) => {
      const avg = getAverageStrategy(data);
      const handKey = key.split(':')[0];
      const actions = data.actions;
      const strat: Record<string, number> = {};
      for (let i = 0; i < actions.length; i++) {
        strat[actions[i]] = avg[i];
      }
      return { hand: handKey, ...strat };
    })
    .sort((a, b) => (b.r || 0) - (a.r || 0));

  console.log(`${'Hand'.padEnd(25)} ${'Fold'.padStart(8)} ${'Call'.padStart(8)} ${'Raise'.padStart(8)}`);
  for (const s of sbOpen.slice(0, 20)) {
    console.log(
      `${s.hand.padEnd(25)} ${((s.f || 0) * 100).toFixed(1).padStart(7)}% ${((s.c || 0) * 100).toFixed(1).padStart(7)}% ${((s.r || 0) * 100).toFixed(1).padStart(7)}%`
    );
  }

  // BBの vs オープンレイズ戦略
  console.log('\n--- BB vs SB Raise (top 20 hands by call+raise%) ---');
  const bbVsRaise: { key: string; data: InfoSetData }[] = [];
  for (const [key, data] of infoSetMap) {
    const [, history] = key.split(':');
    if (history === 'r') {
      bbVsRaise.push({ key, data });
    }
  }

  const bbStrats = bbVsRaise
    .map(({ key, data }) => {
      const avg = getAverageStrategy(data);
      const handKey = key.split(':')[0];
      const actions = data.actions;
      const strat: Record<string, number> = {};
      for (let i = 0; i < actions.length; i++) {
        strat[actions[i]] = avg[i];
      }
      return { hand: handKey, ...strat };
    })
    .sort((a, b) => ((b.c || 0) + (b.r || 0)) - ((a.c || 0) + (a.r || 0)));

  console.log(`${'Hand'.padEnd(25)} ${'Fold'.padStart(8)} ${'Call'.padStart(8)} ${'3Bet'.padStart(8)}`);
  for (const s of bbStrats.slice(0, 20)) {
    console.log(
      `${s.hand.padEnd(25)} ${((s.f || 0) * 100).toFixed(1).padStart(7)}% ${((s.c || 0) * 100).toFixed(1).padStart(7)}% ${((s.r || 0) * 100).toFixed(1).padStart(7)}%`
    );
  }

  // 統計サマリ
  const allSBOpen = rootSets.map(({ data }) => {
    const avg = getAverageStrategy(data);
    const ri = data.actions.indexOf('r');
    const ci = data.actions.indexOf('c');
    return { raise: ri >= 0 ? avg[ri] : 0, call: ci >= 0 ? avg[ci] : 0 };
  });

  if (allSBOpen.length > 0) {
    const avgRaise = allSBOpen.reduce((s, a) => s + a.raise, 0) / allSBOpen.length;
    const avgCall = allSBOpen.reduce((s, a) => s + a.call, 0) / allSBOpen.length;
    console.log(`\n--- SB Summary ---`);
    console.log(`Unique hands seen: ${allSBOpen.length}`);
    console.log(`Average raise%: ${(avgRaise * 100).toFixed(1)}%`);
    console.log(`Average call%: ${(avgCall * 100).toFixed(1)}%`);
    console.log(`Average fold%: ${((1 - avgRaise - avgCall) * 100).toFixed(1)}%`);
  }
}

main().catch(console.error);
