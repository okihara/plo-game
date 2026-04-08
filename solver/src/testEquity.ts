/**
 * エクイティ計算エンジンの動作確認テスト
 */

import { evaluate5, evaluatePLO, monteCarloEquity } from './equity.js';
import { makeCard, cardToString, handToString } from './enumerate.js';

// ヘルパー: "Ah" → カード整数
function parseCard(s: string): number {
  const rankMap: Record<string, number> = {
    '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7,
    'T': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12,
  };
  const suitMap: Record<string, number> = { 'h': 0, 'd': 1, 'c': 2, 's': 3 };
  return makeCard(rankMap[s[0]], suitMap[s[1]]);
}

function parseHand(s: string): number[] {
  return s.match(/.{2}/g)!.map(parseCard);
}

console.log('=== Equity Engine Tests ===\n');

// --- evaluate5 テスト ---
console.log('--- 5-card evaluation ---');

// ロイヤルフラッシュ
const royal = parseHand('AhKhQhJhTh');
console.log(`Royal flush: ${evaluate5(royal)} (should be 9_000_000 + 12 = 9000012)`);

// ストレートフラッシュ 5h4h3h2hAh (ホイール)
const wheelSF = parseHand('5h4h3h2hAh');
console.log(`Wheel SF: ${evaluate5(wheelSF)} (should be 9_000_000 + 3 = 9000003)`);

// フォーカード AAAA2
const quads = parseHand('AhAdAcAs2h');
console.log(`Quad Aces: ${evaluate5(quads)} (should be 8_000_000+)`);

// フルハウス KKK22
const fullHouse = parseHand('KhKdKc2h2d');
console.log(`Full house K22: ${evaluate5(fullHouse)} (should be 7_000_000+)`);

// フラッシュ AhKhQh9h7h
const flush = parseHand('AhKhQh9h7h');
console.log(`Flush AKQ97: ${evaluate5(flush)} (should be 6_000_000+)`);

// ストレート 5432A (ホイール)
const wheel = parseHand('5h4d3c2sAh');
console.log(`Wheel: ${evaluate5(wheel)} (should be 5_000_000 + 3 = 5000003)`);

// ストレート AKQJT
const broadway = parseHand('AhKdQcJsTs');
console.log(`Broadway: ${evaluate5(broadway)} (should be 5_000_000 + 12 = 5000012)`);

// ツーペア
const twoPair = parseHand('AhAdKhKd2c');
console.log(`Two pair AAKKx: ${evaluate5(twoPair)} (should be 3_000_000+)`);

// ハイカード
const highCard = parseHand('AhKd9c7s2h');
console.log(`High card: ${evaluate5(highCard)} (should be 1_000_000+)`);

// --- PLO評価テスト ---
console.log('\n--- PLO hand evaluation ---');

// AAKKds vs ボード: AhKhQhJhTh → ロイヤルフラッシュ可能
const ploHole = parseHand('AhKhQdJd');
const ploBoard = parseHand('ThKd2c3s4s');
console.log(`PLO hole=${handToString(ploHole)} board=${handToString(ploBoard)}`);
console.log(`PLO eval: ${evaluatePLO(ploHole, ploBoard)}`);

// --- モンテカルロ エクイティ テスト ---
console.log('\n--- Monte Carlo equity ---');

// AAxx vs KKxx (ダブルスーテッド)
const aaxx = parseHand('AhAdKhTd');  // AAKTs
const kkxx = parseHand('KcKsQcJs');  // KKQJs

console.log(`${handToString(aaxx)} vs ${handToString(kkxx)}`);

// 少数反復で動作確認
const eq1k = monteCarloEquity(aaxx, kkxx, 1000);
const eq10k = monteCarloEquity(aaxx, kkxx, 10000);
const eq50k = monteCarloEquity(aaxx, kkxx, 50000);
console.log(`  1K iters: ${(eq1k * 100).toFixed(2)}%`);
console.log(`  10K iters: ${(eq10k * 100).toFixed(2)}%`);
console.log(`  50K iters: ${(eq50k * 100).toFixed(2)}%`);

// 明らかなケース: AAAA vs 2222 → AAが圧勝するはず
const aaaa = parseHand('AhAdAcAs');
const tttt = parseHand('2h2d2c2s');
const eqDominated = monteCarloEquity(aaaa, tttt, 10000);
console.log(`\nAAAA vs 2222: ${(eqDominated * 100).toFixed(2)}% (should be ~70-75%)`);

// カード重複テスト
const overlap = monteCarloEquity(parseHand('AhAdKhTd'), parseHand('AhKs5c3d'), 1000);
console.log(`\nOverlap test: ${overlap} (should be NaN)`);

// --- 速度テスト ---
console.log('\n--- Speed test ---');
const start = performance.now();
const iterations = 100_000;
monteCarloEquity(aaxx, kkxx, iterations);
const elapsed = performance.now() - start;
console.log(`${iterations.toLocaleString()} iterations: ${elapsed.toFixed(0)}ms (${(iterations / elapsed * 1000).toFixed(0)} iter/s)`);

console.log('\n=== All tests done ===');
