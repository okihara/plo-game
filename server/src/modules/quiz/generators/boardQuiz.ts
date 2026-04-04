/**
 * ボード問題の自動生成。
 * 既存のポーカーロジックを活用して4パターンのクイズを生成する。
 */
import { Card, Suit, Rank } from '../../../shared/logic/types.js';
import { createDeck, shuffleDeck, cardToString, getRankValue } from '@plo/shared';
import { evaluatePLOHand, compareHands } from '../../../shared/logic/handEvaluator.js';
import { evaluateHandExtended } from '../../../shared/logic/ai/handStrength.js';
import { analyzeBoard } from '../../../shared/logic/ai/boardAnalysis.js';
import { countOuts } from '../../../shared/logic/ai/equityEstimator.js';
import type { Quiz, BoardQuizSubtype } from '../types.js';

const ALL_SUITS: Suit[] = ['h', 'd', 'c', 's'];
const ALL_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUIT_EMOJI: Record<Suit, string> = { h: '♥️', d: '♦️', c: '♣️', s: '♠️' };

function cardDisplay(card: Card): string {
  return `${card.rank}${SUIT_EMOJI[card.suit]}`;
}

function cardsDisplay(cards: Card[]): string {
  return cards.map(cardDisplay).join(' ');
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function dealScenario(): { holeCards: Card[][]; communityCards: Card[] } {
  const deck = shuffleDeck(createDeck());
  const hands: Card[][] = [];
  let idx = 0;
  for (let i = 0; i < 4; i++) {
    hands.push(deck.slice(idx, idx + 4));
    idx += 4;
  }
  const communityCards = deck.slice(idx, idx + 5);
  return { holeCards: hands, communityCards };
}

/** パターン1: どちらのハンドが勝つ？ */
function generateWinnerQuiz(): Quiz | null {
  for (let attempt = 0; attempt < 50; attempt++) {
    const { holeCards, communityCards } = dealScenario();
    const handA = holeCards[0];
    const handB = holeCards[1];

    const evalA = evaluatePLOHand(handA, communityCards);
    const evalB = evaluatePLOHand(handB, communityCards);
    const cmp = compareHands(evalA, evalB);

    // 引き分けは避ける。また両方ハイカードだと面白くないので片方は rank >= 3(ツーペア以上)
    if (cmp === 0) continue;
    if (evalA.rank < 3 && evalB.rank < 3) continue;

    const winner = cmp > 0 ? 'A' : 'B';
    const winnerEval = cmp > 0 ? evalA : evalB;
    const loserEval = cmp > 0 ? evalB : evalA;

    const choices = ['Hand A が勝ち', 'Hand B が勝ち', '引き分け（チョップ）', 'どちらも勝てない'];
    const correctIndex = winner === 'A' ? 0 : 1;

    return {
      type: 'board',
      question: [
        '🃏 PLOクイズ: どちらが勝つ？',
        '',
        `ボード: ${cardsDisplay(communityCards)}`,
        '',
        `Hand A: ${cardsDisplay(handA)}`,
        `Hand B: ${cardsDisplay(handB)}`,
      ].join('\n'),
      choices,
      correctIndex,
      explanation: `正解は ${winner} ！\n\nHand A: ${evalA.name}\nHand B: ${evalB.name}\n\n${winnerEval.name} が ${loserEval.name} に勝ちます。`,
    };
  }
  return null;
}

/** パターン2: このボードのナッツ（最強ハンド）はどれ？ */
function generateNutsQuiz(): Quiz | null {
  for (let attempt = 0; attempt < 50; attempt++) {
    const { holeCards, communityCards } = dealScenario();

    // 4つのハンドを評価し、最強を特定
    const evals = holeCards.map(h => evaluatePLOHand(h, communityCards));
    let bestIdx = 0;
    for (let i = 1; i < evals.length; i++) {
      if (compareHands(evals[i], evals[bestIdx]) > 0) {
        bestIdx = i;
      }
    }

    // 最強が明確に勝っているか（2番目との差がある）
    const sortedIndices = [0, 1, 2, 3].sort((a, b) => compareHands(evals[b], evals[a]));
    if (compareHands(evals[sortedIndices[0]], evals[sortedIndices[1]]) === 0) continue;
    // 最低でもツーペア以上の面白い問題
    if (evals[sortedIndices[0]].rank < 3) continue;

    const labels = ['A', 'B', 'C', 'D'];
    const choices = holeCards.map((h, i) =>
      `Hand ${labels[i]}: ${cardsDisplay(h)}`
    );
    const correctIndex = bestIdx;

    return {
      type: 'board',
      question: [
        '🃏 PLOクイズ: ナッツはどれ？',
        '',
        `ボード: ${cardsDisplay(communityCards)}`,
        '',
        '4つのハンドから最強を選んでください！',
      ].join('\n'),
      choices,
      correctIndex,
      explanation: `正解は Hand ${labels[bestIdx]}！\n\n${evals.map((e, i) => `Hand ${labels[i]}: ${e.name}`).join('\n')}\n\n${evals[bestIdx].name} がこのボードで最強です。`,
    };
  }
  return null;
}

const HAND_NAMES_BY_RANK: Record<number, string> = {
  1: 'ハイカード',
  2: 'ワンペア',
  3: 'ツーペア',
  4: 'スリーカード',
  5: 'ストレート',
  6: 'フラッシュ',
  7: 'フルハウス',
  8: 'フォーカード',
  9: 'ストレートフラッシュ',
};

/** パターン3: このハンドの役名は？ */
function generateHandNameQuiz(): Quiz | null {

  for (let attempt = 0; attempt < 50; attempt++) {
    const deck = shuffleDeck(createDeck());
    const holeCards = deck.slice(0, 4);
    const communityCards = deck.slice(4, 9);

    const eval_ = evaluatePLOHand(holeCards, communityCards);
    // ワンペア以下だとつまらない、ストフラは出にくいので rank 3-8 を狙う
    if (eval_.rank < 3 || eval_.rank > 8) continue;

    const correctName = HAND_NAMES_BY_RANK[eval_.rank];

    // 誤答用: 正解の前後 ±1〜2 の役名をランダムに選ぶ
    const allRanks = [3, 4, 5, 6, 7, 8];
    const wrongRanks = allRanks.filter(r => r !== eval_.rank);
    const shuffledWrong = shuffle(wrongRanks).slice(0, 3);
    const allChoices = [correctName, ...shuffledWrong.map(r => HAND_NAMES_BY_RANK[r])];
    const shuffledChoices = shuffle(allChoices);
    const correctIndex = shuffledChoices.indexOf(correctName);

    return {
      type: 'board',
      question: [
        '🃏 PLOクイズ: この手の役は？',
        '',
        `ボード: ${cardsDisplay(communityCards)}`,
        `ハンド: ${cardsDisplay(holeCards)}`,
        '',
        'PLOルール（ホールカード2枚 + ボード3枚）で作れる最強の役は？',
      ].join('\n'),
      choices: shuffledChoices,
      correctIndex,
      explanation: `正解は「${correctName}」！\n\nPLOでは必ずホールカードから2枚、ボードから3枚を使います。\nこのハンドでは ${eval_.name} が完成しています。`,
    };
  }
  return null;
}

interface OutCard {
  card: Card;
  handName: string;
}

/**
 * アウツとなる具体的なカードと、それで完成する役名を列挙する。
 * evaluatePLOHand はコミュニティ4-5枚に対応しているため、
 * フロップ(3枚)でもターン(4枚)でもテストカード1枚追加で直接評価できる。
 */
export function findOutCards(holeCards: Card[], communityCards: Card[], currentHandRank: number): OutCard[] {
  const usedKeys = new Set([
    ...holeCards.map(c => `${c.rank}${c.suit}`),
    ...communityCards.map(c => `${c.rank}${c.suit}`),
  ]);
  const outs: OutCard[] = [];

  for (const rank of ALL_RANKS) {
    for (const suit of ALL_SUITS) {
      const key = `${rank}${suit}`;
      if (usedKeys.has(key)) continue;

      const testCommunity = [...communityCards, { rank, suit } as Card];
      try {
        const newHand = evaluatePLOHand(holeCards, testCommunity);
        if (newHand.rank > currentHandRank) {
          outs.push({ card: { rank, suit }, handName: HAND_NAMES_BY_RANK[newHand.rank] ?? newHand.name });
        }
      } catch { /* skip */ }
    }
  }
  return outs;
}


/** アウツ問題の解説文を組み立てる */
function buildOutsExplanation(
  totalOuts: number,
  outsResult: { flushOuts: number; straightOuts: number },
  holeCards: Card[],
  communityCards: Card[],
  madeHandRank: number,
): string {
  const outCards = findOutCards(holeCards, communityCards, madeHandRank);

  // 役名ごとにグループ化
  const byHand = new Map<string, Card[]>();
  for (const { card, handName } of outCards) {
    const list = byHand.get(handName) ?? [];
    list.push(card);
    byHand.set(handName, list);
  }
  const outsDetail = [...byHand.entries()]
    .map(([name, cards]) => `${name}: ${cards.map(cardDisplay).join(' ')}（${cards.length}枚）`)
    .join('\n');

  const lines = [
    `正解は ${totalOuts}枚！`,
    '',
    outsDetail,
  ];
  return lines.join('\n');
}

/** ボード問題生成時のオプション */
export interface BoardQuizOptions {
  /** アウツ問題の最小アウツ数（デフォルト: 4） */
  minOuts?: number;
}

let boardQuizOptions: BoardQuizOptions = {};

/** ボード問題のオプションを設定する */
export function setBoardQuizOptions(opts: BoardQuizOptions): void {
  boardQuizOptions = opts;
}

/** パターン4: アウツは何枚？（フロップ/ターン） */
function generateOutsQuiz(): Quiz | null {
  for (let attempt = 0; attempt < 100; attempt++) {
    const deck = shuffleDeck(createDeck());
    const holeCards = deck.slice(0, 4);
    const street = pick(['flop', 'turn'] as const);
    const numCommunity = street === 'flop' ? 3 : 4;
    const communityCards = deck.slice(4, 4 + numCommunity);

    // evaluateHandExtended requires at least 3 community cards
    const boardTexture = analyzeBoard(communityCards);
    const handEval = evaluateHandExtended(holeCards, communityCards, street, 1, boardTexture);

    // ドローが無いとつまらない
    if (!handEval.hasFlushDraw && !handEval.hasStraightDraw && !handEval.hasWrapDraw) continue;

    // 5枚にパディングして countOuts に渡す
    const paddedCommunity = communityCards.length < 5
      ? [...communityCards, ...deck.slice(4 + numCommunity, 4 + numCommunity + (5 - numCommunity))]
      : communityCards;

    // countOuts は 3-4 枚のコミュニティカードで動く
    const outsResult = countOuts(holeCards, communityCards, handEval.madeHandRank);
    const totalOuts = outsResult.totalOuts;

    // 少なすぎ・多すぎはスキップ
    const minOuts = boardQuizOptions.minOuts ?? 4;
    if (totalOuts < minOuts || totalOuts > 20) continue;

    // 選択肢: 正解 ± ランダムオフセット
    const offsets = shuffle([-3, -1, 2, 4, -5, 3, 5, -2]).slice(0, 3);
    const wrongAnswers = offsets
      .map(o => totalOuts + o)
      .filter(v => v > 0 && v !== totalOuts);

    if (wrongAnswers.length < 3) continue;
    const choices3 = wrongAnswers.slice(0, 3);

    const allChoices = shuffle([`${totalOuts}枚`, ...choices3.map(v => `${v}枚`)]);
    const correctIndex = allChoices.indexOf(`${totalOuts}枚`);

    const drawTypes: string[] = [];
    if (handEval.hasFlushDraw) drawTypes.push('フラッシュドロー');
    if (handEval.hasWrapDraw) drawTypes.push('ラップドロー');
    else if (handEval.hasStraightDraw) drawTypes.push('ストレートドロー');

    const streetName = street === 'flop' ? 'フロップ' : 'ターン';

    return {
      type: 'board',
      question: [
        `🃏 PLOクイズ: アウツは何枚？`,
        '',
        `ボード（${streetName}）: ${cardsDisplay(communityCards)}`,
        `ハンド: ${cardsDisplay(holeCards)}`,
        '',
        `ドロー: ${drawTypes.join(' + ')}`,
        'ハンドが改善するアウツは何枚？',
      ].join('\n'),
      choices: allChoices,
      correctIndex,
      explanation: buildOutsExplanation(totalOuts, outsResult, holeCards, communityCards, handEval.madeHandRank),
    };
  }
  return null;
}

const BOARD_GENERATORS: Record<BoardQuizSubtype, () => Quiz | null> = {
  winner: generateWinnerQuiz,
  nuts: generateNutsQuiz,
  handname: generateHandNameQuiz,
  outs: generateOutsQuiz,
};

/** ボード問題をランダムに1つ生成。subtype でサブタイプを指定可能。 */
export function generateBoardQuiz(subtype?: BoardQuizSubtype): Quiz {
  if (subtype) {
    const quiz = BOARD_GENERATORS[subtype]();
    if (quiz) return quiz;
    throw new Error(`Failed to generate board quiz: ${subtype}`);
  }

  // ランダムな順序で試行
  const shuffled = shuffle(Object.values(BOARD_GENERATORS));
  for (const gen of shuffled) {
    const quiz = gen();
    if (quiz) return quiz;
  }

  // フォールバック（ほぼ起こらない）
  throw new Error('Failed to generate board quiz after all attempts');
}
