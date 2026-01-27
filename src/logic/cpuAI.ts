import { GameState, Action, Card, Rank, Street } from './types';
import { getValidActions } from './gameEngine';
import { getRankValue } from './deck';
import { evaluatePLOHand } from './handEvaluator';

// ハンド評価情報
interface HandEvaluation {
  strength: number;        // 0-1 総合強度
  madeHandRank: number;    // メイドハンドのランク (1-9)
  hasFlushDraw: boolean;   // フラッシュドロー
  hasStraightDraw: boolean; // ストレートドロー
  hasWrapDraw: boolean;    // ラップドロー（8アウツ以上）
  drawStrength: number;    // ドローの強さ 0-1
  isNuts: boolean;         // ナッツか
  isNearNuts: boolean;     // セミナッツか
}

// ボードテクスチャ
interface BoardTexture {
  isPaired: boolean;       // ペアボード
  isTrips: boolean;        // トリップスボード
  flushPossible: boolean;  // フラッシュ完成可能
  flushDraw: boolean;      // フラッシュドロー可能（同スート3枚）
  straightPossible: boolean; // ストレート完成可能
  isConnected: boolean;    // コネクトボード
  isWet: boolean;          // ウェットボード
  highCard: number;        // 最高カード
}

// CPU AI - より賢い判断
export function getCPUAction(state: GameState, playerIndex: number): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const validActions = getValidActions(state, playerIndex);

  if (validActions.length === 0) {
    return { action: 'fold', amount: 0 };
  }

  const toCall = state.currentBet - player.currentBet;
  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
  const positionBonus = getPositionBonus(player.position);

  // プリフロップとポストフロップで異なるロジック
  if (state.currentStreet === 'preflop') {
    return getPreflopAction(state, playerIndex, validActions, positionBonus);
  }

  // ポストフロップ: 実際のハンド強度とドローを評価
  const handEval = evaluatePostFlopHand(player.holeCards, state.communityCards);
  const boardTexture = analyzeBoardTexture(state.communityCards);

  // 相手のアグレッション分析
  const aggression = analyzeOpponentAggression(state, playerIndex);

  return getPostFlopAction(state, playerIndex, validActions, handEval, boardTexture, aggression, potOdds, positionBonus);
}

// プリフロップアクション
function getPreflopAction(
  state: GameState,
  playerIndex: number,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  positionBonus: number
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const handStrength = evaluatePreFlopStrength(player.holeCards);
  const effectiveStrength = Math.min(1, handStrength + positionBonus);

  const toCall = state.currentBet - player.currentBet;
  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
  const random = Math.random();

  // 相手からのレイズがあるかチェック
  const facingRaise = state.currentBet > state.bigBlind;
  const facingBigRaise = toCall > state.pot * 0.5;

  // === プレミアムハンド (0.75+): 積極的にプレイ ===
  if (effectiveStrength > 0.75) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      // 3betまたは4bet
      const raiseSize = facingRaise ? 3 : 2.5; // 3bet時は大きめ
      const raiseAmount = Math.min(
        raiseAction.maxAmount,
        Math.max(raiseAction.minAmount, Math.floor(state.pot * raiseSize))
      );
      if (random > 0.15) { // 85%でレイズ
        return { action: raiseAction.action, amount: raiseAmount };
      }
    }
    // コール
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
  }

  // === 良いハンド (0.55-0.75): ポジションと状況による ===
  if (effectiveStrength > 0.55) {
    // 大きなレイズには慎重
    if (facingBigRaise) {
      if (effectiveStrength > 0.65) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }

    // レイズするか?
    if (!facingRaise && random > 0.4) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction) {
        const raiseAmount = Math.min(
          raiseAction.maxAmount,
          Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.75))
        );
        return { action: raiseAction.action, amount: raiseAmount };
      }
    }

    // コール
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction && potOdds < effectiveStrength * 0.8) {
      return { action: 'call', amount: callAction.minAmount };
    }
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // ポットオッズが悪ければフォールド
    if (toCall > 0) return { action: 'fold', amount: 0 };
  }

  // === 普通のハンド (0.35-0.55): マルチウェイではプレイ可能 ===
  if (effectiveStrength > 0.35) {
    // レイズには降りる
    if (facingRaise && toCall > state.bigBlind * 3) {
      return { action: 'fold', amount: 0 };
    }

    // チェック優先
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // 安くコールできるならコール
    if (potOdds < 0.2 && toCall <= state.bigBlind * 2) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
  }

  // === 弱いハンド: 基本フォールド ===
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  // たまにスチール
  if (!facingRaise && positionBonus >= 0.08 && random > 0.92) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      return { action: raiseAction.action, amount: raiseAction.minAmount };
    }
  }

  return { action: 'fold', amount: 0 };
}

// ポストフロップアクション
function getPostFlopAction(
  state: GameState,
  playerIndex: number,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: HandEvaluation,
  boardTexture: BoardTexture,
  aggression: number,
  potOdds: number,
  positionBonus: number
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const toCall = state.currentBet - player.currentBet;
  const street = state.currentStreet;

  // SPR (Stack to Pot Ratio)
  const spr = player.chips / Math.max(1, state.pot);

  // === モンスターハンド: ナッツまたはセミナッツ ===
  if (handEval.isNuts || (handEval.isNearNuts && handEval.madeHandRank >= 5)) {
    return playStrongHand(state, validActions, handEval, boardTexture, spr);
  }

  // === 強いメイドハンド (ツーペア+) ===
  if (handEval.madeHandRank >= 3) {
    // ペアボードでフルハウス以下は慎重に
    if (boardTexture.isPaired && handEval.madeHandRank < 7) {
      // 相手がアグレッシブなら降りることも
      if (aggression > 0.7 && toCall > state.pot * 0.5) {
        const checkAction = validActions.find(a => a.action === 'check');
        if (checkAction) return { action: 'check', amount: 0 };
        // コールはするがレイズはしない
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction && potOdds < 0.35) {
          return { action: 'call', amount: callAction.minAmount };
        }
        return { action: 'fold', amount: 0 };
      }
    }

    // フラッシュボードでフラッシュ未完成は慎重
    if (boardTexture.flushPossible && handEval.madeHandRank < 6) {
      if (aggression > 0.6) {
        const checkAction = validActions.find(a => a.action === 'check');
        if (checkAction) return { action: 'check', amount: 0 };
        if (potOdds > 0.3) return { action: 'fold', amount: 0 };
      }
    }

    return playMediumStrengthHand(state, validActions, handEval, aggression, potOdds);
  }

  // === ドローハンド ===
  if (handEval.hasFlushDraw || handEval.hasStraightDraw || handEval.hasWrapDraw) {
    return playDrawHand(state, validActions, handEval, boardTexture, potOdds, street);
  }

  // === ワンペア ===
  if (handEval.madeHandRank === 2) {
    // トップペア以上なら継続
    if (handEval.strength > 0.4) {
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
      if (potOdds < 0.25) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
    }
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // === 弱いハンド ===
  // ブラフ機会の検討
  if (shouldBluff(state, playerIndex, boardTexture, aggression, positionBonus)) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      const bluffSize = Math.min(
        raiseAction.maxAmount,
        Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.6))
      );
      return { action: raiseAction.action, amount: bluffSize };
    }
  }

  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  // 非常に安いならコール
  if (potOdds < 0.1 && toCall < player.chips * 0.03) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  return { action: 'fold', amount: 0 };
}

// 強いハンドのプレイ
function playStrongHand(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  _handEval: HandEvaluation,
  boardTexture: BoardTexture,
  _spr: number
): { action: Action; amount: number } {
  const random = Math.random();

  // ウェットボードでは速めにプレイ
  if (boardTexture.isWet) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      // ポットの75-100%
      const raiseAmount = Math.min(
        raiseAction.maxAmount,
        Math.max(raiseAction.minAmount, Math.floor(state.pot * (0.75 + random * 0.25)))
      );
      return { action: raiseAction.action, amount: raiseAmount };
    }
  }

  // ドライボードではスロープレイも混ぜる
  if (!boardTexture.isWet && random > 0.65) {
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  // 通常はバリューベット
  const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
  if (raiseAction) {
    const raiseAmount = Math.min(
      raiseAction.maxAmount,
      Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.7))
    );
    return { action: raiseAction.action, amount: raiseAmount };
  }

  const callAction = validActions.find(a => a.action === 'call');
  if (callAction) return { action: 'call', amount: callAction.minAmount };
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  return { action: 'fold', amount: 0 };
}

// 中程度の強さのハンド
function playMediumStrengthHand(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: HandEvaluation,
  aggression: number,
  potOdds: number
): { action: Action; amount: number } {
  const random = Math.random();
  const toCall = state.currentBet - state.players[state.currentPlayerIndex].currentBet;

  // 相手がパッシブならベット
  if (aggression < 0.3) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction && random > 0.3) {
      const raiseAmount = Math.min(
        raiseAction.maxAmount,
        Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.5))
      );
      return { action: raiseAction.action, amount: raiseAmount };
    }
  }

  // ポットコントロール
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  // ベットに直面したらポットオッズで判断
  if (potOdds < handEval.strength * 0.6) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  // 高すぎるなら降りる
  if (toCall > state.pot * 0.5 && aggression > 0.5) {
    return { action: 'fold', amount: 0 };
  }

  const callAction = validActions.find(a => a.action === 'call');
  if (callAction) return { action: 'call', amount: callAction.minAmount };

  return { action: 'fold', amount: 0 };
}

// ドローハンドのプレイ
function playDrawHand(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: HandEvaluation,
  _boardTexture: BoardTexture,
  potOdds: number,
  street: Street
): { action: Action; amount: number } {
  const random = Math.random();

  // ドローの強さによるエクイティ概算
  let drawEquity = handEval.drawStrength;

  // ターンでドローが減る
  if (street === 'turn') {
    drawEquity *= 0.5;
  }
  // リバーではドローの価値なし
  if (street === 'river') {
    drawEquity = 0;
  }

  // ナッツドローはセミブラフ
  if (handEval.hasWrapDraw || (handEval.hasFlushDraw && handEval.drawStrength > 0.4)) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction && random > 0.4) {
      const raiseAmount = Math.min(
        raiseAction.maxAmount,
        Math.max(raiseAction.minAmount, Math.floor(state.pot * 0.6))
      );
      return { action: raiseAction.action, amount: raiseAmount };
    }
  }

  // ポットオッズが合えばコール
  if (potOdds < drawEquity) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  // インプライドオッズを考慮（ナッツドロー）
  if (handEval.drawStrength > 0.35 && potOdds < drawEquity * 1.5) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  return { action: 'fold', amount: 0 };
}

// ブラフすべきか判断
function shouldBluff(
  state: GameState,
  playerIndex: number,
  boardTexture: BoardTexture,
  aggression: number,
  positionBonus: number
): boolean {
  const random = Math.random();
  const player = state.players[playerIndex];

  // すでにベットがあるならブラフしにくい
  if (state.currentBet > 0) return false;

  // ポジションが良い
  const hasPosition = positionBonus >= 0.08;

  // 相手がパッシブ
  const passiveOpponents = aggression < 0.3;

  // 怖いボード（ペアやフラッシュ完成）
  const scaryBoard = boardTexture.isPaired || boardTexture.flushPossible;

  // ブラフ頻度
  let bluffFrequency = 0.05; // 基本5%

  if (hasPosition) bluffFrequency += 0.08;
  if (passiveOpponents) bluffFrequency += 0.05;
  if (scaryBoard) bluffFrequency += 0.05;

  // スタックが少ない時はブラフしにくい
  if (player.chips < state.pot) bluffFrequency *= 0.3;

  return random < bluffFrequency;
}

// ポストフロップのハンド評価
function evaluatePostFlopHand(holeCards: Card[], communityCards: Card[]): HandEvaluation {
  if (communityCards.length < 3) {
    return {
      strength: evaluatePreFlopStrength(holeCards),
      madeHandRank: 0,
      hasFlushDraw: false,
      hasStraightDraw: false,
      hasWrapDraw: false,
      drawStrength: 0,
      isNuts: false,
      isNearNuts: false,
    };
  }

  // メイドハンドを評価
  const madeHand = evaluatePLOHand(holeCards, communityCards.length >= 5
    ? communityCards
    : [...communityCards, ...getDummyCards(5 - communityCards.length, [...holeCards, ...communityCards])]
  );

  // ドロー評価
  const drawInfo = evaluateDraws(holeCards, communityCards);

  // ナッツ判定（簡易版）
  const isNuts = checkIfNuts(holeCards, communityCards, madeHand.rank);
  const isNearNuts = !isNuts && madeHand.rank >= 5 && madeHand.highCards[0] >= 12;

  // 総合強度計算
  let strength = madeHand.rank / 9;

  // ハイカードボーナス
  if (madeHand.highCards.length > 0) {
    strength += (madeHand.highCards[0] - 8) / 60;
  }

  // ドローボーナス（リバー以外）
  if (communityCards.length < 5) {
    strength += drawInfo.drawStrength * 0.3;
  }

  return {
    strength: Math.min(1, strength),
    madeHandRank: madeHand.rank,
    hasFlushDraw: drawInfo.hasFlushDraw,
    hasStraightDraw: drawInfo.hasStraightDraw,
    hasWrapDraw: drawInfo.hasWrapDraw,
    drawStrength: drawInfo.drawStrength,
    isNuts,
    isNearNuts,
  };
}

// ドロー評価
function evaluateDraws(holeCards: Card[], communityCards: Card[]): {
  hasFlushDraw: boolean;
  hasStraightDraw: boolean;
  hasWrapDraw: boolean;
  drawStrength: number;
} {
  const allCards = [...holeCards, ...communityCards];
  let drawStrength = 0;

  // フラッシュドロー判定（PLO: ホールから2枚使用必須）
  const suitCounts: Record<string, { hole: number; comm: number }> = {};
  for (const card of holeCards) {
    suitCounts[card.suit] = suitCounts[card.suit] || { hole: 0, comm: 0 };
    suitCounts[card.suit].hole++;
  }
  for (const card of communityCards) {
    suitCounts[card.suit] = suitCounts[card.suit] || { hole: 0, comm: 0 };
    suitCounts[card.suit].comm++;
  }

  let hasFlushDraw = false;
  for (const [suit, counts] of Object.entries(suitCounts)) {
    if (counts.hole >= 2 && counts.hole + counts.comm >= 4) {
      hasFlushDraw = true;
      // ナッツフラッシュドローならボーナス
      const holeOfSuit = holeCards.filter(c => c.suit === suit);
      const hasAce = holeOfSuit.some(c => c.rank === 'A');
      drawStrength += hasAce ? 0.4 : 0.25;
      break;
    }
  }

  // ストレートドロー判定
  const values = [...new Set(allCards.map(c => getRankValue(c.rank)))].sort((a, b) => b - a);
  const holeValues = new Set(holeCards.map(c => getRankValue(c.rank)));

  let hasStraightDraw = false;
  let hasWrapDraw = false;
  let maxOuts = 0;

  // 連続性チェック（5枚のウィンドウ）
  for (let high = 14; high >= 5; high--) {
    let count = 0;
    let holeUsed = 0;
    const missing: number[] = [];

    for (let v = high; v > high - 5; v--) {
      const checkVal = v === 0 ? 14 : v;
      if (values.includes(checkVal)) {
        count++;
        if (holeValues.has(checkVal)) holeUsed++;
      } else {
        missing.push(checkVal);
      }
    }

    // PLOでは2枚使用必須
    if (count >= 4 && missing.length === 1 && holeUsed >= 2) {
      hasStraightDraw = true;
      // アウツ数でラップ判定
      const outs = countStraightOuts(values, holeValues);
      if (outs >= 8) {
        hasWrapDraw = true;
        maxOuts = Math.max(maxOuts, outs);
      }
    }
  }

  if (hasStraightDraw) {
    drawStrength += hasWrapDraw ? 0.35 : 0.2;
  }

  return {
    hasFlushDraw,
    hasStraightDraw,
    hasWrapDraw,
    drawStrength: Math.min(1, drawStrength),
  };
}

// ストレートアウツを数える
function countStraightOuts(allValues: number[], holeValues: Set<number>): number {
  let outs = 0;
  const valuesSet = new Set(allValues);

  for (let card = 2; card <= 14; card++) {
    if (valuesSet.has(card)) continue;

    const testValues = [...allValues, card].sort((a, b) => b - a);
    // 5連続があるかチェック
    for (let i = 0; i <= testValues.length - 5; i++) {
      let isConsecutive = true;
      let holeUsed = 0;
      for (let j = 0; j < 5; j++) {
        if (j > 0 && testValues[i + j - 1] - testValues[i + j] !== 1) {
          isConsecutive = false;
          break;
        }
        if (holeValues.has(testValues[i + j])) holeUsed++;
      }
      if (isConsecutive && holeUsed >= 2) {
        outs++;
        break;
      }
    }
  }

  return outs;
}

// ナッツ判定（簡易版）
function checkIfNuts(holeCards: Card[], communityCards: Card[], handRank: number): boolean {
  // ストレートフラッシュはほぼナッツ
  if (handRank === 9) return true;

  // フォーカードはほぼナッツ
  if (handRank === 8) return true;

  // フルハウスでトップセットなら強い
  if (handRank === 7) {
    const boardValues = communityCards.map(c => getRankValue(c.rank));
    const holeValues = holeCards.map(c => getRankValue(c.rank));
    const maxBoard = Math.max(...boardValues);
    if (holeValues.filter(v => v === maxBoard).length >= 2) return true;
  }

  // ナッツフラッシュ判定
  if (handRank === 6) {
    for (const suit of ['h', 'd', 'c', 's']) {
      const holeOfSuit = holeCards.filter(c => c.suit === suit);
      const boardOfSuit = communityCards.filter(c => c.suit === suit);
      if (holeOfSuit.length >= 2 && boardOfSuit.length >= 3) {
        // Aスーテッドがあればナッツ
        if (holeOfSuit.some(c => c.rank === 'A')) return true;
      }
    }
  }

  return false;
}

// ダミーカードを生成（評価用）
function getDummyCards(count: number, usedCards: Card[]): Card[] {
  const used = new Set(usedCards.map(c => `${c.rank}${c.suit}`));
  const result: Card[] = [];
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suits = ['h', 'd', 'c', 's'] as const;

  for (const rank of ranks) {
    for (const suit of suits) {
      if (!used.has(`${rank}${suit}`) && result.length < count) {
        result.push({ rank, suit });
      }
    }
  }
  return result;
}

// ボードテクスチャ分析
function analyzeBoardTexture(communityCards: Card[]): BoardTexture {
  const values = communityCards.map(c => getRankValue(c.rank));
  const suits = communityCards.map(c => c.suit);

  // ペアボード
  const valueCounts = new Map<number, number>();
  for (const v of values) {
    valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
  }
  const maxCount = Math.max(...valueCounts.values(), 0);
  const isPaired = maxCount >= 2;
  const isTrips = maxCount >= 3;

  // フラッシュ可能性
  const suitCounts = new Map<string, number>();
  for (const s of suits) {
    suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
  }
  const maxSuitCount = Math.max(...suitCounts.values(), 0);
  const flushPossible = maxSuitCount >= 3;
  const flushDraw = maxSuitCount === 2;

  // ストレート可能性
  const uniqueValues = [...new Set(values)].sort((a, b) => a - b);
  let isConnected = false;
  let straightPossible = false;

  if (uniqueValues.length >= 3) {
    // 連続性チェック
    let maxConsecutive = 1;
    let currentConsecutive = 1;
    for (let i = 1; i < uniqueValues.length; i++) {
      if (uniqueValues[i] - uniqueValues[i - 1] <= 2) {
        currentConsecutive++;
        maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
      } else {
        currentConsecutive = 1;
      }
    }
    isConnected = maxConsecutive >= 3;
    straightPossible = isConnected;
  }

  // ウェットボード判定
  const isWet = (flushDraw || flushPossible) || isConnected;

  return {
    isPaired,
    isTrips,
    flushPossible,
    flushDraw,
    straightPossible,
    isConnected,
    isWet,
    highCard: Math.max(...values, 0),
  };
}

// 相手のアグレッション分析
function analyzeOpponentAggression(state: GameState, playerIndex: number): number {
  const history = state.handHistory;
  let raises = 0;
  let actions = 0;

  for (const action of history) {
    if (action.playerId !== playerIndex) {
      actions++;
      if (action.action === 'raise' || action.action === 'bet' || action.action === 'allin') {
        raises++;
      }
    }
  }

  if (actions === 0) return 0.3; // デフォルト
  return raises / actions;
}

// プリフロップ評価の詳細情報
export interface PreFlopEvaluation {
  score: number;           // 総合スコア (0-1)
  hasPair: boolean;        // ペアがあるか
  pairRank: string | null; // ペアのランク (例: "AA", "KK")
  hasAceSuited: boolean;   // Aスーテッドがあるか
  isDoubleSuited: boolean; // ダブルスーテッドか
  isSingleSuited: boolean; // シングルスーテッドか
  isRundown: boolean;      // ランダウン（連続4枚）か
  hasWrap: boolean;        // ラップ可能性（密なハンド）
  hasDangler: boolean;     // ダングラー（孤立カード）があるか
}

export function evaluatePreFlopStrength(holeCards: Card[]): number {
  return getPreFlopEvaluation(holeCards).score;
}

export function getPreFlopEvaluation(holeCards: Card[]): PreFlopEvaluation {
  // PLOハンド評価 - 記事に基づく3つの主要要素:
  // 1. Nuttiness（ナッツ性）: ナッツを作れる可能性
  // 2. Connectedness（連結性）: カードの繋がり具合
  // 3. Suitedness（スート性）: フラッシュドローの価値

  const values = holeCards.map(c => getRankValue(c.rank));
  const suits = holeCards.map(c => c.suit);
  const ranks = holeCards.map(c => c.rank);

  // ランクとスーツのカウント
  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<string, number>();
  const suitToCards = new Map<string, Card[]>();
  for (let i = 0; i < 4; i++) {
    rankCounts.set(ranks[i], (rankCounts.get(ranks[i]) || 0) + 1);
    suitCounts.set(suits[i], (suitCounts.get(suits[i]) || 0) + 1);
    if (!suitToCards.has(suits[i])) suitToCards.set(suits[i], []);
    suitToCards.get(suits[i])!.push(holeCards[i]);
  }

  const sortedValues = [...values].sort((a, b) => a - b);
  const uniqueValues = [...new Set(sortedValues)];
  const span = uniqueValues.length > 1 ? uniqueValues[uniqueValues.length - 1] - uniqueValues[0] : 0;
  const suitCountValues = Array.from(suitCounts.values());

  // スーテッドネスの判定
  const isDoubleSuited = suitCountValues.filter(c => c === 2).length === 2;
  const isSingleSuited = !isDoubleSuited && suitCountValues.some(c => c === 2);
  const tripleOrMoreSuited = suitCountValues.some(c => c >= 3);
  const isRainbow = suitCountValues.every(c => c === 1);

  // ペア情報
  const pairRanks = Array.from(rankCounts.entries()).filter(([_, count]) => count >= 2);
  let pairRank: string | null = null;
  for (const [rank] of pairRanks) {
    const pairValue = getRankValue(rank);
    if (!pairRank || pairValue > getRankValue(pairRank[0] as Rank)) {
      pairRank = rank + rank;
    }
  }

  // Aスーテッドの判定（重要: ナッツフラッシュ+ブラフ価値）
  const hasAce = ranks.includes('A');
  let hasAceSuited = false;
  let aceHighFlushDrawCount = 0;
  if (hasAce) {
    for (const [, cards] of suitToCards.entries()) {
      if (cards.some(c => c.rank === 'A') && cards.length >= 2) {
        hasAceSuited = true;
        aceHighFlushDrawCount++;
      }
    }
  }

  // === 1. ナッティネス (0-0.45) ===
  // PLOでは平均的なショーダウンハンドがホールデムより強い
  // ナッツを作れるハンドを高く評価
  let nuttiness = 0;

  // ハイペア評価（AA > KK > QQ > JJ）
  const hasAA = rankCounts.get('A') === 2;
  const hasKK = rankCounts.get('K') === 2;
  const hasQQ = rankCounts.get('Q') === 2;
  const hasJJ = rankCounts.get('J') === 2;

  if (hasAA) {
    nuttiness += 0.25; // AAはPLOで最もナッティなペア
  } else if (hasKK) {
    nuttiness += 0.18;
  } else if (hasQQ) {
    nuttiness += 0.14;
  } else if (hasJJ) {
    nuttiness += 0.10;
  } else if (pairRanks.length > 0) {
    // その他のペア
    const highestPairValue = Math.max(...pairRanks.map(([r]) => getRankValue(r)));
    nuttiness += (highestPairValue / 14) * 0.08;
  }

  // Aスーテッド: ナッツフラッシュドロー + ブラフ時にAを持つ価値
  // 記事: "having an Ace in a certain suit has additional merit"
  if (aceHighFlushDrawCount >= 2) {
    nuttiness += 0.12; // 2つのナッツフラッシュドロー
  } else if (aceHighFlushDrawCount === 1) {
    nuttiness += 0.08;
  }

  // ハイカード平均値（ナッツストレートの可能性）
  const avgValue = values.reduce((a, b) => a + b, 0) / 4;
  nuttiness += Math.max(0, (avgValue - 8) / 14 * 0.08);

  // === 2. コネクティビティ (0-0.35) ===
  // 記事: "KQJT, JT98 or even JT87 realize their postflop equity exceptionally efficiently"
  let connectivity = 0;

  // ランダウン判定（連続4枚: KQJT, JT98など）
  const isRundown = uniqueValues.length === 4 && span === 3;
  if (isRundown) {
    // ハイランダウン（AKQJ, KQJT）は特に強い
    const minValue = uniqueValues[0];
    if (minValue >= 10) {
      connectivity += 0.30; // ブロードウェイランダウン
    } else if (minValue >= 7) {
      connectivity += 0.25; // ミドルランダウン
    } else {
      connectivity += 0.18; // ローランダウン
    }
  } else {
    // ラップ可能性（4枚中3枚以上が連続または近い）
    let gapScore = 0;
    for (let i = 0; i < uniqueValues.length - 1; i++) {
      const gap = uniqueValues[i + 1] - uniqueValues[i];
      if (gap === 1) gapScore += 3;      // 連続
      else if (gap === 2) gapScore += 2; // 1ギャップ
      else if (gap === 3) gapScore += 1; // 2ギャップ
    }
    connectivity += (gapScore / 9) * 0.20;
  }

  // ラップドロー可能性（密なハンド）
  const hasWrap = span <= 4 && uniqueValues.length >= 3;
  if (hasWrap && !isRundown) {
    connectivity += 0.08;
  }

  // ダングラー（孤立したカード）のペナルティ
  // 記事: "Dangler is a card that does not connect (like 5 in KQJ5)"
  let hasDangler = false;
  if (uniqueValues.length === 4) {
    const gaps = [];
    for (let i = 0; i < 3; i++) {
      gaps.push(uniqueValues[i + 1] - uniqueValues[i]);
    }
    const maxGap = Math.max(...gaps);
    const maxGapIndex = gaps.indexOf(maxGap);

    // 端のカードが大きく離れている場合のみダングラー
    if (maxGap >= 5 && (maxGapIndex === 0 || maxGapIndex === 2)) {
      hasDangler = true;
      connectivity -= 0.12; // ダングラーペナルティ強化
    } else if (maxGap >= 4) {
      hasDangler = true;
      connectivity -= 0.06;
    }
  }

  // === 3. スーテッドネス (0-0.25) ===
  // 記事: "What's even better than connected Omaha hands? Double suited hands"
  let suitedness = 0;

  if (isDoubleSuited) {
    suitedness += 0.20;
    // ダブルスーテッドでAスーテッドなら追加ボーナス
    if (hasAceSuited) {
      suitedness += 0.05;
    }
  } else if (isSingleSuited) {
    suitedness += 0.10;
    // シングルスーテッドでAスーテッドなら追加ボーナス
    if (hasAceSuited) {
      suitedness += 0.03;
    }
  }

  // 記事: "having more cards in the same suit cuts the number of your outs"
  if (tripleOrMoreSuited) {
    suitedness -= 0.08; // ペナルティ強化
  }

  // レインボーは弱い（フルリングでは厳しい）
  if (isRainbow) {
    suitedness -= 0.05;
  }

  // === 特別なプレミアムハンドパターン ===
  // 記事に基づくトップハンド評価
  let bonus = 0;

  // AAKKds - 最強ハンド（67% vs all hands）
  if (hasAA && hasKK && isDoubleSuited) {
    bonus += 0.15;
  }
  // AAJTds - 2番目に強い（AAKKdsに対して48%）
  else if (hasAA && ranks.includes('J') && ranks.includes('T') && isDoubleSuited) {
    bonus += 0.12;
  }
  // KKQQds - 強いダブルペア
  else if (hasKK && hasQQ && isDoubleSuited) {
    bonus += 0.10;
  }
  // AAxx ダブルスーテッド
  else if (hasAA && isDoubleSuited) {
    bonus += 0.08;
  }

  // ダブルペア（例: KKQQ, JJTT）
  if (pairRanks.length === 2) {
    const pairValues = pairRanks.map(([r]) => getRankValue(r));
    const avgPairValue = (pairValues[0] + pairValues[1]) / 2;
    bonus += 0.03 + (avgPairValue / 14) * 0.04;
  }

  // ランダウン + ダブルスーテッド
  if (isRundown && isDoubleSuited) {
    bonus += 0.08;
  }

  // 合計スコア（最大1.0）
  const totalScore = nuttiness + connectivity + suitedness + bonus;
  const score = Math.min(1, Math.max(0, totalScore));

  return {
    score,
    hasPair: pairRanks.length > 0,
    pairRank,
    hasAceSuited,
    isDoubleSuited,
    isSingleSuited,
    isRundown,
    hasWrap,
    hasDangler,
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
