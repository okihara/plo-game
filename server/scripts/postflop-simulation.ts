/**
 * getPostflopDecision のシミュレーション
 * ランダムなシチュエーションを生成し、どんな状況でどんなアクションが取られるか俯瞰する。
 *
 * 使い方: cd server && npx tsx scripts/postflop-simulation.ts [回数]
 */

import { GameState, Card, Rank, Suit, Street, Player, Action } from '../src/shared/logic/types.js';
import { getPostflopDecision } from '../src/shared/logic/ai/postflopStrategy.js';
import { evaluateHandExtended } from '../src/shared/logic/ai/handStrength.js';
import { analyzeBoard } from '../src/shared/logic/ai/boardAnalysis.js';
import { BOT_PERSONALITIES } from '../src/shared/logic/ai/personalities.js';
import { StreetHistory, BotPersonality, ExtendedHandEval, ExtendedBoardTexture } from '../src/shared/logic/ai/types.js';

const SUITS: Suit[] = ['h', 'd', 'c', 's'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const POSITIONS = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] as const;

const NUM_SIMULATIONS = parseInt(process.argv[2] || '5000', 10);

// --- ユーティリティ ---

function createFullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardStr(c: Card): string {
  return `${c.rank}${c.suit}`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// madeHandRank → 名前
const HAND_RANK_NAMES: Record<number, string> = {
  0: 'ハイカード',
  1: 'ハイカード',
  2: 'ワンペア',
  3: 'ツーペア',
  4: 'セット/トリップス',
  5: 'ストレート',
  6: 'フラッシュ',
  7: 'フルハウス',
  8: 'フォーカード',
  9: 'ストフラ',
};

// --- シチュエーション生成 ---

interface Scenario {
  street: 'flop' | 'turn' | 'river';
  holeCards: Card[];
  communityCards: Card[];
  pot: number;
  currentBet: number;   // テーブルの現在ベット
  playerBet: number;    // プレイヤーの現在ベット
  playerChips: number;
  isAggressor: boolean;
  numActivePlayers: number;
  personality: BotPersonality;
  position: typeof POSITIONS[number];
}

function generateScenario(): Scenario {
  const deck = shuffle(createFullDeck());
  const street = pick(['flop', 'turn', 'river'] as const);
  const numCommunity = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;

  // カードを配る（プレイヤー0に4枚 + コミュニティ）
  const holeCards = deck.slice(0, 4);
  const communityCards = deck.slice(4, 4 + numCommunity);

  const bigBlind = pick([2, 6, 10]);
  const position = pick([...POSITIONS]);
  const numActive = pick([2, 2, 2, 3, 3, 4]); // 2人が多め

  // ポットとベット状況をランダム生成
  const potMultiplier = randBetween(2, 30);
  const pot = Math.round(bigBlind * potMultiplier);

  // ベットに直面しているかどうか（50%の確率）
  const facingBet = Math.random() < 0.5;
  let currentBet = 0;
  let playerBet = 0;
  if (facingBet) {
    const betSize = Math.round(pot * randBetween(0.2, 1.2));
    currentBet = betSize;
    playerBet = 0; // まだ何も入れていない
  }

  const playerChips = Math.round(bigBlind * randBetween(20, 200));
  const isAggressor = Math.random() < 0.35;

  const personalityNames = Object.keys(BOT_PERSONALITIES);
  const personality = BOT_PERSONALITIES[pick(personalityNames)];

  return {
    street, holeCards, communityCards, pot, currentBet, playerBet,
    playerChips, isAggressor, numActivePlayers: numActive, personality, position,
  };
}

function buildGameState(s: Scenario): GameState {
  const players: Player[] = [];
  for (let i = 0; i < 6; i++) {
    const isFolded = i !== 0 && (i >= s.numActivePlayers);
    players.push({
      id: i,
      name: i === 0 ? 'Bot' : `Opp${i}`,
      position: POSITIONS[i],
      chips: i === 0 ? s.playerChips : Math.round(s.playerChips * randBetween(0.5, 2)),
      holeCards: i === 0 ? s.holeCards : [],
      currentBet: i === 0 ? s.playerBet : (isFolded ? 0 : s.currentBet),
      totalBetThisRound: 0,
      folded: isFolded,
      isAllIn: false,
      hasActed: i !== 0,
      isSittingOut: false,
    });
  }

  // player0のポジションを設定
  players[0].position = s.position;

  const bb = s.pot > 20 ? Math.round(s.pot / 10) : 2;

  return {
    players,
    deck: [],
    communityCards: s.communityCards,
    pot: s.pot,
    sidePots: [],
    currentStreet: s.street,
    dealerPosition: 0,
    currentPlayerIndex: 0,
    currentBet: s.currentBet,
    minRaise: s.currentBet > 0 ? s.currentBet * 2 : bb,
    smallBlind: Math.max(1, Math.round(bb / 2)),
    bigBlind: bb,
    lastRaiserIndex: s.isAggressor ? 0 : (s.currentBet > 0 ? 1 : -1),
    lastFullRaiseBet: s.currentBet,
    handHistory: [],
    isHandComplete: false,
    winners: [],
    rake: 0,
    variant: 'plo',
    ante: 0,
    bringIn: 0,
    betCount: 0,
    maxBetsPerRound: 0,
  };
}

function getPositionBonus(position: string): number {
  switch (position) {
    case 'BTN': return 0.1;
    case 'CO': return 0.08;
    case 'HJ': return 0.05;
    case 'UTG': return 0;
    case 'BB': return -0.05;
    case 'SB': return -0.05;
    default: return 0;
  }
}

// --- 集計 ---

interface Stats {
  count: number;
  actions: Record<string, number>;
}

function newStats(): Stats {
  return { count: 0, actions: {} };
}

function addAction(stats: Stats, action: string) {
  stats.count++;
  stats.actions[action] = (stats.actions[action] || 0) + 1;
}

function pct(n: number, total: number): string {
  if (total === 0) return '  0%';
  return `${Math.round(n / total * 100).toString().padStart(3)}%`;
}

function formatActions(stats: Stats): string {
  const order: Action[] = ['fold', 'check', 'call', 'bet', 'raise'];
  const parts: string[] = [];
  for (const a of order) {
    const n = stats.actions[a] || 0;
    if (n > 0) parts.push(`${a}:${pct(n, stats.count)}`);
  }
  return parts.join(' | ');
}

// --- メイン ---

function main() {
  console.log(`\n=== getPostflopDecision シミュレーション (${NUM_SIMULATIONS}回) ===\n`);

  // 集計カテゴリ
  const byStreet: Record<string, Stats> = {};
  const byHandRank: Record<string, Stats> = {};
  const byStreetAndHand: Record<string, Stats> = {};
  const byFacingBet: Record<string, Stats> = {};
  const byIsAggressor: Record<string, Stats> = {};
  const byBoardTexture: Record<string, Stats> = {};
  const byDrawType: Record<string, Stats> = {};
  const byNutRank: Record<string, Stats> = {};
  const bySPR: Record<string, Stats> = {};

  let totalResults: Stats = newStats();

  for (let i = 0; i < NUM_SIMULATIONS; i++) {
    const scenario = generateScenario();
    const state = buildGameState(scenario);
    const boardTexture = analyzeBoard(state.communityCards);
    const numOpponents = scenario.numActivePlayers - 1;
    const handEval = evaluateHandExtended(
      scenario.holeCards, state.communityCards, scenario.street, numOpponents, boardTexture
    );

    const streetHistory: StreetHistory = {
      preflopAggressor: scenario.isAggressor ? 0 : 1,
      flopAggressor: null,
      turnAggressor: null,
      wasRaisedPreflop: true,
      numBetsOnFlop: scenario.currentBet > 0 && scenario.street === 'flop' ? 1 : 0,
      numBetsOnTurn: scenario.currentBet > 0 && scenario.street === 'turn' ? 1 : 0,
    };

    const positionBonus = getPositionBonus(scenario.position);

    let result: { action: Action; amount: number };
    try {
      result = getPostflopDecision(
        state, 0, handEval, boardTexture, streetHistory,
        scenario.personality, positionBonus
      );
    } catch (e) {
      continue; // skip errors
    }

    const actionKey = result.action;

    // 全体
    addAction(totalResults, actionKey);

    // ストリート別
    const streetKey = scenario.street;
    if (!byStreet[streetKey]) byStreet[streetKey] = newStats();
    addAction(byStreet[streetKey], actionKey);

    // ハンドランク別
    const handRankKey = HAND_RANK_NAMES[handEval.madeHandRank] || `rank${handEval.madeHandRank}`;
    if (!byHandRank[handRankKey]) byHandRank[handRankKey] = newStats();
    addAction(byHandRank[handRankKey], actionKey);

    // ストリート×ハンドランク
    const shKey = `${streetKey}/${handRankKey}`;
    if (!byStreetAndHand[shKey]) byStreetAndHand[shKey] = newStats();
    addAction(byStreetAndHand[shKey], actionKey);

    // ベットに直面 vs チェック可能
    const facingKey = scenario.currentBet > 0 ? 'ベットに直面' : 'チェック可能';
    if (!byFacingBet[facingKey]) byFacingBet[facingKey] = newStats();
    addAction(byFacingBet[facingKey], actionKey);

    // アグレッサーかどうか
    const aggKey = scenario.isAggressor ? 'アグレッサー' : '非アグレッサー';
    if (!byIsAggressor[aggKey]) byIsAggressor[aggKey] = newStats();
    addAction(byIsAggressor[aggKey], actionKey);

    // ボードテクスチャ
    const textures: string[] = [];
    if (boardTexture.monotone) textures.push('モノトーン');
    else if (boardTexture.flushPossible) textures.push('フラッシュ可能');
    if (boardTexture.straightPossible) textures.push('ストレート可能');
    if (boardTexture.isPaired) textures.push('ペアボード');
    if (boardTexture.isWet) textures.push('ウェット');
    if (!boardTexture.isWet) textures.push('ドライ');
    for (const t of textures) {
      if (!byBoardTexture[t]) byBoardTexture[t] = newStats();
      addAction(byBoardTexture[t], actionKey);
    }

    // ドロータイプ
    if (handEval.hasWrapDraw) {
      if (!byDrawType['ラップドロー']) byDrawType['ラップドロー'] = newStats();
      addAction(byDrawType['ラップドロー'], actionKey);
    } else if (handEval.hasFlushDraw && handEval.hasStraightDraw) {
      if (!byDrawType['フラッシュ+ストレートドロー']) byDrawType['フラッシュ+ストレートドロー'] = newStats();
      addAction(byDrawType['フラッシュ+ストレートドロー'], actionKey);
    } else if (handEval.hasFlushDraw) {
      if (!byDrawType['フラッシュドロー']) byDrawType['フラッシュドロー'] = newStats();
      addAction(byDrawType['フラッシュドロー'], actionKey);
    } else if (handEval.hasStraightDraw) {
      if (!byDrawType['ストレートドロー']) byDrawType['ストレートドロー'] = newStats();
      addAction(byDrawType['ストレートドロー'], actionKey);
    } else {
      if (!byDrawType['ドローなし']) byDrawType['ドローなし'] = newStats();
      addAction(byDrawType['ドローなし'], actionKey);
    }

    // nutRank（リバーのみ）
    if (scenario.street === 'river' && handEval.nutRank !== undefined) {
      const nrKey = handEval.nutRank <= 3 ? `nutRank ${handEval.nutRank}` : 'nutRank 4+';
      if (!byNutRank[nrKey]) byNutRank[nrKey] = newStats();
      addAction(byNutRank[nrKey], actionKey);
    }

    // SPR
    const spr = scenario.playerChips / Math.max(1, scenario.pot);
    const sprKey = spr < 1 ? 'SPR < 1' : spr < 3 ? 'SPR 1-3' : spr < 8 ? 'SPR 3-8' : 'SPR 8+';
    if (!bySPR[sprKey]) bySPR[sprKey] = newStats();
    addAction(bySPR[sprKey], actionKey);
  }

  // --- 出力 ---

  const printSection = (title: string, data: Record<string, Stats>, sortByKey = false) => {
    console.log(`\n--- ${title} ---`);
    const entries = Object.entries(data);
    if (sortByKey) entries.sort((a, b) => a[0].localeCompare(b[0]));
    else entries.sort((a, b) => b[1].count - a[1].count);
    for (const [key, stats] of entries) {
      console.log(`  ${key.padEnd(30)} (n=${String(stats.count).padStart(5)})  ${formatActions(stats)}`);
    }
  };

  console.log(`\n=== 全体 (n=${totalResults.count}) ===`);
  console.log(`  ${formatActions(totalResults)}`);

  printSection('ストリート別', byStreet, true);
  printSection('ハンドランク別', byHandRank);
  printSection('ストリート × ハンドランク', byStreetAndHand, true);
  printSection('ベット状況別', byFacingBet);
  printSection('アグレッサー別', byIsAggressor);
  printSection('ボードテクスチャ別', byBoardTexture);
  printSection('ドロータイプ別', byDrawType);
  printSection('ナッツランク別（リバーのみ）', byNutRank, true);
  printSection('SPR別', bySPR, true);

  console.log('\n');
}

main();
