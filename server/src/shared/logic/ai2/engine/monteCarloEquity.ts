// 相手レンジに対するモンテカルロ・エクイティ推定。
// 旧エンジンの「メイドハンドランク → 固定エクイティ表」を置き換える
// （docs/bot-redesign.md 再設計原則 2: 相手レンジを明示的に持つ）。
//
// レンジは「重み付きサンプリング」で表現する:
//   - プリフロップの参加アクションが強いほど、強いハンドに重みを置く
//   - 現ストリートのアグレッサーは、ボードに絡んだハンドに重みを置く
//   - 一定割合はブラフ（無条件レンジ）として重み付けをスキップする

import { Card } from '../../types.js';
import { evaluatePLOHand, evaluateCurrentHand, compareHands } from '../../handEvaluator.js';
import { evaluatePreFlopStrength } from '../../preflopEquity.js';
import { Rng } from './rng.js';

/** 相手 1 人ぶんのレンジ条件 */
export interface OpponentRangeSpec {
  /** プリフロップ参加の強さ: 0=ブラインド/チェックのみ, 1=コール, 2=レイズ */
  preflopLevel: 0 | 1 | 2;
  /** 現ストリートでベット/レイズしているか（ボードヒットに重み） */
  isStreetAggressor: boolean;
}

export interface EquityOptions {
  samples?: number;
  /** アグレッサーのレンジに混ざっているブラフ割合 (重み付けをスキップする確率) */
  bluffRatio?: number;
}

/** ヘッズアップ時の既定サンプル数。BOT_V2_MC_SAMPLES で本番調整可能（決定コストと精度のトレードオフ）。
 *  既定 64 ≒ ローカル p50 10ms / p99 14ms（scripts/bot-v2-bench.ts 実測、本番はより遅い想定） */
function baseSamples(): number {
  const raw = Number(process.env.BOT_V2_MC_SAMPLES);
  return Number.isFinite(raw) && raw >= 20 ? raw : 64;
}

const ALL_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const ALL_SUITS = ['h', 'd', 'c', 's'] as const;

function remainingDeck(used: Card[]): Card[] {
  const usedSet = new Set(used.map(c => `${c.rank}${c.suit}`));
  const deck: Card[] = [];
  for (const rank of ALL_RANKS) {
    for (const suit of ALL_SUITS) {
      if (!usedSet.has(`${rank}${suit}`)) deck.push({ rank, suit });
    }
  }
  return deck;
}

/** 先頭 n 枚を部分 Fisher-Yates で選ぶ（deck は破壊される） */
function drawCards(deck: Card[], n: number, rand: Rng): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < n && deck.length > 0; i++) {
    const j = Math.floor(rand() * deck.length);
    const tmp = deck[deck.length - 1];
    deck[deck.length - 1] = deck[j];
    deck[j] = tmp;
    drawn.push(deck.pop()!);
  }
  return drawn;
}

/** プリフロップ参加レベル → ハンド強度への重み指数 */
function preflopWeightExponent(level: 0 | 1 | 2): number {
  return level === 2 ? 3.0 : level === 1 ? 1.5 : 0.5;
}

/** 現ストリートのアグレッサーがそのハンドを持っている尤度（ボードヒット重み） */
function aggressorBoardWeight(hand: Card[], board: Card[]): number {
  if (board.length < 3) return 1;
  const current = evaluateCurrentHand(hand, board);
  const rank = current?.rank ?? 0;
  if (rank >= 5) return 1.0;   // ストレート以上
  if (rank >= 3) return 0.9;   // ツーペア/セット
  if (rank === 2) return 0.45; // ワンペア
  return 0.2;                  // エア（≒ドロー/ブラフ）
}

/**
 * hero のエクイティ（全員に勝つ確率、タイは按分）を推定する。
 * board は現時点のコミュニティ（3〜5枚）。5枚未満ならランアウトをサンプルする。
 */
export function estimateEquity(
  hero: Card[],
  board: Card[],
  opponents: OpponentRangeSpec[],
  rand: Rng,
  options?: EquityOptions
): number {
  if (opponents.length === 0) return 1;
  const requested = options?.samples ?? baseSamples();
  // マルチウェイは 1 サンプルあたりの評価コストが人数分増えるため、サンプル数を落とす
  const samples = opponents.length <= 1 ? requested : Math.max(40, Math.round(requested * 0.625));
  const bluffRatio = options?.bluffRatio ?? 0.2;

  const base = remainingDeck([...hero, ...board]);
  let weightedWins = 0;
  let totalWeight = 0;

  for (let s = 0; s < samples; s++) {
    const deck = base.slice();
    const oppHands: Card[][] = [];
    let weight = 1;

    for (const opp of opponents) {
      const hand = drawCards(deck, 4, rand);
      if (hand.length < 4) return 0.5; // デッキ枯渇（異常ケース）
      oppHands.push(hand);

      // ブラフ枠: 一定割合は条件付けせず「何でも持ち得る」として扱う
      const isBluffSample = rand() < bluffRatio;
      if (!isBluffSample) {
        const strength = evaluatePreFlopStrength(hand); // 0..1
        weight *= Math.pow(Math.max(0.05, strength), preflopWeightExponent(opp.preflopLevel));
        if (opp.isStreetAggressor) {
          weight *= aggressorBoardWeight(hand, board);
        }
      } else {
        weight *= 0.3; // ブラフ枠の基準重み（条件付き平均重みに概ね揃える）
      }
    }

    // ランアウト
    const fullBoard = board.slice();
    while (fullBoard.length < 5) {
      fullBoard.push(...drawCards(deck, 1, rand));
    }

    const heroHand = evaluatePLOHand(hero, fullBoard);
    let beaten = false;
    let ties = 0;
    for (const oppHand of oppHands) {
      const cmp = compareHands(heroHand, evaluatePLOHand(oppHand, fullBoard));
      if (cmp < 0) { beaten = true; break; }
      if (cmp === 0) ties++;
    }

    if (!beaten) {
      weightedWins += weight * (ties > 0 ? 1 / (ties + 1) : 1);
    }
    totalWeight += weight;
  }

  if (totalWeight <= 0) return 0.5;
  return weightedWins / totalWeight;
}
