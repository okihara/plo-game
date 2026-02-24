// PLO マルチプレイヤーエクイティ計算エンジン
// オールインランアウト時に各プレイヤーの期待値を算出する

import { Card, Suit, Rank } from './types.js';
import { evaluatePLOHand, compareHands } from './handEvaluator.js';

const SUITS: Suit[] = ['h', 'd', 'c', 's'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/** カードキーを生成 (例: "Ah", "Tc") */
function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/** 52枚のフルデッキから指定カードを除外した残りを返す */
function getRemainingDeck(usedCards: Card[]): Card[] {
  const usedSet = new Set(usedCards.map(cardKey));
  const remaining: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (!usedSet.has(`${rank}${suit}`)) {
        remaining.push({ rank, suit });
      }
    }
  }
  return remaining;
}

/** C(n,r) の組み合わせを生成 */
function combinations<T>(arr: T[], r: number): T[][] {
  const result: T[][] = [];
  function helper(start: number, combo: T[]) {
    if (combo.length === r) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

interface PlayerHand {
  playerId: number;
  holeCards: Card[];
}

/**
 * 特定のボード（5枚）に対する各プレイヤーの勝敗を判定
 * @returns 各プレイヤーが獲得する "share" (1.0 = 全勝, 0.5 = 2人でスプリット, etc.)
 */
function evaluateBoard(
  board: Card[],
  players: PlayerHand[],
): Map<number, number> {
  const shares = new Map<number, number>();
  for (const p of players) shares.set(p.playerId, 0);

  // 各プレイヤーのハンドを評価
  const hands = players.map(p => ({
    playerId: p.playerId,
    hand: evaluatePLOHand(p.holeCards, board),
  }));

  // 最強ハンドを特定
  hands.sort((a, b) => compareHands(b.hand, a.hand));
  const winners = [hands[0]];
  for (let i = 1; i < hands.length; i++) {
    if (compareHands(hands[i].hand, hands[0].hand) === 0) {
      winners.push(hands[i]);
    } else {
      break;
    }
  }

  const share = 1.0 / winners.length;
  for (const w of winners) {
    shares.set(w.playerId, share);
  }

  return shares;
}

/**
 * コミュニティカード（0〜4枚）から残りを列挙/サンプリングして
 * 各プレイヤーのエクイティ（勝率）を計算する
 *
 * @param communityCards ランアウト前のコミュニティカード（0〜4枚）
 * @param players 対象プレイヤー（playerId + holeCards）
 * @param deadCards デッドカード（フォールド済みプレイヤーのカード等）
 * @returns Map<playerId, equity> (0.0〜1.0)
 */
export function calculateEquities(
  communityCards: Card[],
  players: PlayerHand[],
  deadCards: Card[] = [],
): Map<number, number> {
  if (players.length <= 1) {
    const result = new Map<number, number>();
    if (players.length === 1) result.set(players[0].playerId, 1.0);
    return result;
  }

  // 使用済みカード = コミュニティ + 全プレイヤーのホールカード + デッドカード
  const usedCards = [
    ...communityCards,
    ...players.flatMap(p => p.holeCards),
    ...deadCards,
  ];
  const remaining = getRemainingDeck(usedCards);
  const cardsNeeded = 5 - communityCards.length;

  if (cardsNeeded === 0) {
    // ボード完成済み → 単一評価
    const shares = evaluateBoard(communityCards, players);
    return shares;
  }

  // エクイティ累積
  const totalShares = new Map<number, number>();
  for (const p of players) totalShares.set(p.playerId, 0);
  let totalTrials = 0;

  if (cardsNeeded <= 2) {
    // 完全列挙（1枚: ~28通り, 2枚: ~378通り）
    const combos = combinations(remaining, cardsNeeded);
    for (const combo of combos) {
      const board = [...communityCards, ...combo];
      const shares = evaluateBoard(board, players);
      for (const [id, share] of shares) {
        totalShares.set(id, totalShares.get(id)! + share);
      }
      totalTrials++;
    }
  } else {
    // Monte Carlo（3枚以上: プリフロップ等）
    const MONTE_CARLO_TRIALS = 2000;
    for (let t = 0; t < MONTE_CARLO_TRIALS; t++) {
      // Fisher-Yates シャッフルで cardsNeeded 枚を選択
      const deck = [...remaining];
      for (let i = deck.length - 1; i > deck.length - 1 - cardsNeeded; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const board = [...communityCards, ...deck.slice(deck.length - cardsNeeded)];
      const shares = evaluateBoard(board, players);
      for (const [id, share] of shares) {
        totalShares.set(id, totalShares.get(id)! + share);
      }
      totalTrials++;
    }
  }

  // 正規化
  const equities = new Map<number, number>();
  for (const [id, total] of totalShares) {
    equities.set(id, total / totalTrials);
  }

  return equities;
}

export interface SidePot {
  amount: number;
  eligiblePlayers: number[];
}

/**
 * サイドポット構造とエクイティから各プレイヤーのEV利益を計算する
 *
 * @param communityCards ランアウト前のコミュニティカード
 * @param allPlayers 全プレイヤー情報（フォールド済みプレイヤー含む、デッドカード抽出用）
 * @param sidePots サイドポット配列
 * @param totalBets 各プレイヤーのこのハンドでの総ベット額 Map<playerId, totalBet>
 * @returns Map<playerId, evProfit> 各プレイヤーのEV利益（整数に丸め）
 */
export function calculateAllInEVProfits(
  communityCards: Card[],
  allPlayers: { playerId: number; holeCards: Card[]; folded: boolean }[],
  sidePots: SidePot[],
  totalBets: Map<number, number>,
): Map<number, number> {
  const activePlayers = allPlayers.filter(p => !p.folded && p.holeCards.length === 4);

  // デッドカード = フォールド済みプレイヤーのカード
  const deadCards = allPlayers
    .filter(p => p.folded)
    .flatMap(p => p.holeCards);

  // 各プレイヤーの EV winnings を蓄積
  const evWinnings = new Map<number, number>();
  for (const p of activePlayers) evWinnings.set(p.playerId, 0);

  for (const pot of sidePots) {
    const eligibleActive = activePlayers.filter(p =>
      pot.eligiblePlayers.includes(p.playerId)
    );

    if (eligibleActive.length === 0) continue;

    if (eligibleActive.length === 1) {
      // uncontested pot → equity = 1.0
      const id = eligibleActive[0].playerId;
      evWinnings.set(id, evWinnings.get(id)! + pot.amount);
    } else {
      // エクイティ計算
      const equities = calculateEquities(
        communityCards,
        eligibleActive.map(p => ({ playerId: p.playerId, holeCards: p.holeCards })),
        deadCards,
      );

      for (const p of eligibleActive) {
        const equity = equities.get(p.playerId) ?? 0;
        const evShare = equity * pot.amount;
        evWinnings.set(p.playerId, evWinnings.get(p.playerId)! + evShare);
      }
    }
  }

  // EV profit = EV winnings - totalBet
  const evProfits = new Map<number, number>();
  for (const p of activePlayers) {
    const winnings = evWinnings.get(p.playerId) ?? 0;
    const bet = totalBets.get(p.playerId) ?? 0;
    evProfits.set(p.playerId, Math.round(winnings - bet));
  }

  return evProfits;
}
