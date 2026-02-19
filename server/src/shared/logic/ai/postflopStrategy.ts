import { GameState, Action, Street } from '../types.js';
import { getValidActions } from '../gameEngine.js';
import {
  ExtendedHandEval,
  ExtendedBoardTexture,
  BotPersonality,
  StreetHistory,
  OpponentModel,
} from './types.js';
import { decideBetSize, calculateBetAmount } from './betSizing.js';
import { evaluateBluff, shouldBarrel } from './bluffStrategy.js';
import { boardScaryness } from './boardAnalysis.js';

/**
 * ポストフロップの意思決定。
 * Cベット、バリューベット、ブラフ、ドロープレイ、ポットコントロールを統合。
 */
export function getPostflopDecision(
  state: GameState,
  playerIndex: number,
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  streetHistory: StreetHistory,
  personality: BotPersonality,
  positionBonus: number,
  opponentModel?: OpponentModel
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const validActions = getValidActions(state, playerIndex);
  const toCall = state.currentBet - player.currentBet;
  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
  const street = state.currentStreet;
  const spr = player.chips / Math.max(1, state.pot);
  const activePlayers = state.players.filter(p => !p.isSittingOut && !p.folded).length;
  const numOpponents = activePlayers - 1;
  const isAggressor = streetHistory.preflopAggressor === playerIndex;

  // === 1. モンスターハンド: ナッツまたはセミナッツ ===
  if (handEval.isNuts || (handEval.isNearNuts && handEval.madeHandRank >= 5)) {
    return playMonster(state, validActions, handEval, boardTexture, spr, personality, streetHistory, playerIndex);
  }

  // === 2. 強いメイドハンド (ツーペア+) ===
  if (handEval.madeHandRank >= 3) {
    return playStrongMade(
      state, validActions, handEval, boardTexture, potOdds,
      spr, personality, streetHistory, playerIndex, numOpponents
    );
  }

  // === 3. Cベット判断 ===
  if (toCall === 0 && isAggressor && (street === 'flop' || street === 'turn')) {
    const cbetDecision = evaluateCbet(
      state, validActions, handEval, boardTexture, personality, numOpponents,
      streetHistory, playerIndex, street
    );
    if (cbetDecision) return cbetDecision;
  }

  // === 4. ドローハンド ===
  if (handEval.hasFlushDraw || handEval.hasStraightDraw || handEval.hasWrapDraw) {
    return playDraw(state, validActions, handEval, boardTexture, potOdds, street, personality, positionBonus, streetHistory, playerIndex);
  }

  // === 5. ワンペア ===
  if (handEval.madeHandRank === 2) {
    return playOnePair(state, validActions, handEval, potOdds, personality);
  }

  // === 6. 弱いハンド: ブラフ検討 ===
  const bluffDecision = evaluateBluff(
    state, playerIndex, handEval, boardTexture, streetHistory,
    personality, positionBonus, opponentModel
  );
  if (bluffDecision.shouldBluff) {
    return makeBluffBet(state, validActions, handEval, boardTexture, spr, personality, numOpponents, playerIndex);
  }

  // === 7. チェックかフォールド ===
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  // 非常に安いならコール
  if (potOdds < 0.1 && toCall < player.chips * 0.03) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  return { action: 'fold', amount: 0 };
}

/**
 * モンスターハンドのプレイ。
 * ウェットボードでは速く、ドライボードではスロープレイも混ぜる。
 */
function playMonster(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  spr: number,
  personality: BotPersonality,
  streetHistory: StreetHistory,
  playerIndex: number
): { action: Action; amount: number } {
  const random = Math.random();

  // スロープレイ判断
  if (!boardTexture.isWet && random < personality.slowplayFreq) {
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  // バリューベット/レイズ
  const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
  if (raiseAction) {
    const sizePct = decideBetSize({
      pot: state.pot,
      street: state.currentStreet,
      spr,
      boardTexture,
      handEval,
      isAggressor: streetHistory.preflopAggressor === playerIndex,
      numOpponents: state.players.filter(p => !p.isSittingOut && !p.folded).length - 1,
      personality,
    });
    const amount = calculateBetAmount(sizePct, state.pot, raiseAction.minAmount, raiseAction.maxAmount);
    return { action: raiseAction.action, amount };
  }

  // コール（レイズできない場合）
  const callAction = validActions.find(a => a.action === 'call');
  if (callAction) return { action: 'call', amount: callAction.minAmount };

  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

/**
 * 強いメイドハンド (ツーペア+) のプレイ。
 */
function playStrongMade(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  potOdds: number,
  spr: number,
  personality: BotPersonality,
  streetHistory: StreetHistory,
  playerIndex: number,
  numOpponents: number
): { action: Action; amount: number } {
  const toCall = state.currentBet - state.players[playerIndex].currentBet;

  // ペアボードでフルハウス以下 + アグレッシブな相手 → 慎重に
  if (boardTexture.isPaired && handEval.madeHandRank < 7) {
    // 大きなベットに直面している
    if (toCall > state.pot * 0.5) {
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
      // エクイティがポットオッズを上回ればコール
      if (handEval.estimatedEquity > potOdds) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }
  }

  // フラッシュボードでフラッシュ未完成 → 慎重
  if (boardTexture.flushPossible && handEval.madeHandRank < 6) {
    if (toCall > state.pot * 0.4) {
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
      if (handEval.estimatedEquity > potOdds * 1.2) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }
  }

  // ベット/レイズ
  const random = Math.random();
  if (random > (1 - personality.aggression * 0.6)) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      const sizePct = decideBetSize({
        pot: state.pot,
        street: state.currentStreet,
        spr,
        boardTexture,
        handEval,
        isAggressor: streetHistory.preflopAggressor === playerIndex,
        numOpponents,
        personality,
      });
      const amount = calculateBetAmount(sizePct, state.pot, raiseAction.minAmount, raiseAction.maxAmount);
      return { action: raiseAction.action, amount };
    }
  }

  // ポットコントロール
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  // コール
  if (handEval.estimatedEquity > potOdds) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  // ポットオッズが合わない大きなベット → フォールド
  if (toCall > state.pot * 0.5 && handEval.estimatedEquity < 0.35) {
    return { action: 'fold', amount: 0 };
  }

  const callAction = validActions.find(a => a.action === 'call');
  if (callAction) return { action: 'call', amount: callAction.minAmount };
  return { action: 'fold', amount: 0 };
}

/**
 * Cベット判断。プリフロップアグレッサーがフロップ/ターンでベットするか。
 */
function evaluateCbet(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  personality: BotPersonality,
  numOpponents: number,
  streetHistory: StreetHistory,
  playerIndex: number,
  street: Street
): { action: Action; amount: number } | null {
  const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
  if (!raiseAction) return null;

  let cbetChance = personality.cbetFreq;

  // マルチウェイ補正
  if (numOpponents >= 3) cbetChance *= 0.3;
  else if (numOpponents === 2) cbetChance *= 0.5;

  // ボード補正
  if (boardTexture.isWet) cbetChance *= 0.7;
  if (boardTexture.monotone) cbetChance *= 0.5;
  if (!boardTexture.isWet && boardTexture.hasBroadway) cbetChance += 0.10; // ドライ+ブロードウェイ → 有利

  // ハンド強度補正
  if (handEval.madeHandRank >= 3) cbetChance = Math.min(1, cbetChance + 0.30);
  if (handEval.hasFlushDraw || handEval.hasWrapDraw) cbetChance += 0.15;

  // ターンCベットはフロップより頻度ダウン（ダブルバレル）
  if (street === 'turn') {
    if (!shouldBarrel(street, handEval, boardTexture, streetHistory, personality, playerIndex)) {
      return null;
    }
  }

  if (Math.random() >= cbetChance) return null;

  // Cベットサイズ
  const spr = state.players[playerIndex].chips / Math.max(1, state.pot);
  const sizePct = decideBetSize({
    pot: state.pot,
    street,
    spr,
    boardTexture,
    handEval,
    isAggressor: true,
    numOpponents,
    personality,
  });
  const amount = calculateBetAmount(sizePct, state.pot, raiseAction.minAmount, raiseAction.maxAmount);
  return { action: raiseAction.action, amount };
}

/**
 * ドローハンドのプレイ。
 * エクイティベースの判断 + セミブラフ。
 */
function playDraw(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  potOdds: number,
  street: Street,
  personality: BotPersonality,
  positionBonus: number,
  streetHistory: StreetHistory,
  playerIndex: number
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const toCall = state.currentBet - player.currentBet;

  // リバーではドローの価値なし → メイドハンドの強さだけで判断
  if (street === 'river') {
    if (handEval.madeHandRank >= 2 && handEval.estimatedEquity > potOdds) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction && toCall > 0) return { action: 'call', amount: callAction.minAmount };
    }
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // セミブラフ判断
  const bluff = evaluateBluff(
    state, playerIndex, handEval, boardTexture, streetHistory,
    personality, positionBonus
  );

  if (bluff.shouldBluff && bluff.type === 'semi_bluff') {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      const spr = player.chips / Math.max(1, state.pot);
      const sizePct = decideBetSize({
        pot: state.pot,
        street,
        spr,
        boardTexture,
        handEval,
        isAggressor: streetHistory.preflopAggressor === playerIndex,
        numOpponents: state.players.filter(p => !p.isSittingOut && !p.folded).length - 1,
        personality,
      });
      const amount = calculateBetAmount(sizePct, state.pot, raiseAction.minAmount, raiseAction.maxAmount);
      return { action: raiseAction.action, amount };
    }
  }

  // ポットオッズ / エクイティ比較でコール
  if (handEval.estimatedEquity > potOdds) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction && toCall > 0) return { action: 'call', amount: callAction.minAmount };
  }

  // インプライドオッズ: ナッツドローなら緩めにコール
  if (handEval.drawStrength > 0.35 && handEval.estimatedEquity > potOdds * 0.7) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction && toCall > 0) return { action: 'call', amount: callAction.minAmount };
  }

  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  return { action: 'fold', amount: 0 };
}

/**
 * ワンペアのプレイ。
 */
function playOnePair(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: ExtendedHandEval,
  potOdds: number,
  personality: BotPersonality
): { action: Action; amount: number } {
  const player = state.players[state.currentPlayerIndex];
  const toCall = state.currentBet - player.currentBet;

  // トップペア以上 (strength > 0.4) なら継続
  if (handEval.strength > 0.4) {
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // エクイティがポットオッズを上回ればコール
    if (handEval.estimatedEquity > potOdds) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }

    // 小さなベットにはコール
    if (potOdds < 0.25) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
  }

  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  return { action: 'fold', amount: 0 };
}

/**
 * ブラフベットを実行する。
 */
function makeBluffBet(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  spr: number,
  personality: BotPersonality,
  numOpponents: number,
  playerIndex: number
): { action: Action; amount: number } {
  const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
  if (raiseAction) {
    const sizePct = decideBetSize({
      pot: state.pot,
      street: state.currentStreet,
      spr,
      boardTexture,
      handEval,
      isAggressor: false,
      numOpponents,
      personality,
    });
    const amount = calculateBetAmount(sizePct, state.pot, raiseAction.minAmount, raiseAction.maxAmount);
    return { action: raiseAction.action, amount };
  }

  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}
