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

  // === 0. Cベットに対するフォールド判断 ===
  // 相手がアグレッサーでベットに直面 + 弱いハンド → foldToCbet で判断
  if (toCall > 0 && !isAggressor && (street === 'flop' || street === 'turn') &&
      handEval.madeHandRank <= 2 && !handEval.hasFlushDraw && !handEval.hasWrapDraw) {
    const drawBonus = handEval.hasStraightDraw ? 0.15 : 0;
    const strengthBonus = handEval.madeHandRank === 2 ? 0.15 : 0;
    const adjustedFoldRate = Math.max(0.10, personality.foldToCbet - drawBonus - strengthBonus);
    if (Math.random() < adjustedFoldRate) {
      return { action: 'fold', amount: 0 };
    }
  }

  // === 0b. リバーベットに対するフォールド判断 ===
  // PLOではリバーベットは非常に強いレンジ。ワンペア以下はほぼフォールドすべき
  if (toCall > 0 && street === 'river') {
    // ハイカード以下（rank 0-1）: リバーベットに対して100%フォールド
    if (handEval.madeHandRank <= 1) {
      return { action: 'fold', amount: 0 };
    }
    // ワンペア（rank 2）
    if (handEval.madeHandRank === 2) {
      const betToPotRatio = toCall / Math.max(1, state.pot);
      const sizeBonus = Math.max(0, (betToPotRatio - 0.2) * 0.5);
      const strengthBonus = handEval.strength > 0.6 ? 0.08 : 0;
      const adjustedFoldRate = Math.max(0.55, personality.foldToRiverBet + 0.15 + sizeBonus - strengthBonus);
      if (Math.random() < adjustedFoldRate) {
        return { action: 'fold', amount: 0 };
      }
    }
  }

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

  // 非常に安いならコール（ただしリバーではワンペア以下でコールしない）
  if (potOdds < 0.1 && toCall < player.chips * 0.03) {
    if (!(street === 'river' && handEval.madeHandRank <= 2)) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
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
  const street = state.currentStreet;

  // === リバーでの大きなベットに対する判断（PLOではツーペア〜ストレートは脆弱） ===
  if (street === 'river' && toCall > 0) {
    const betToPotRatio = toCall / Math.max(1, state.pot);

    // ツーペア (rank 3): リバーの大きなベットにはかなりフォールド
    if (handEval.madeHandRank === 3) {
      if (betToPotRatio >= 0.6) {
        // foldToRiverBet をベースに、ベットサイズとアグレッションで補正
        const baseFoldChance = personality.foldToRiverBet + 0.05 - personality.aggression * 0.1;
        const sizingBonus = (betToPotRatio - 0.6) * 0.4;
        const foldChance = Math.min(0.85, baseFoldChance + sizingBonus);
        if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
      }
    }

    // セット (rank 4): スケアリーボードの大きなベットに慎重
    if (handEval.madeHandRank === 4 && betToPotRatio >= 0.7) {
      if (boardTexture.flushPossible || boardTexture.straightPossible) {
        const baseFoldChance = personality.foldToRiverBet * 0.5;
        const foldChance = Math.min(0.50, baseFoldChance + (betToPotRatio - 0.7) * 0.3);
        if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
      }
    }

    // ストレート (rank 5): フラッシュ完成ボードの大きなベットに慎重
    if (handEval.madeHandRank === 5 && boardTexture.flushPossible && betToPotRatio >= 0.7) {
      const baseFoldChance = personality.foldToRiverBet * 0.4;
      const foldChance = Math.min(0.40, baseFoldChance + (betToPotRatio - 0.7) * 0.3);
      if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
    }
  }

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
        street,
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

  // コール: エクイティがポットオッズを上回る場合
  if (handEval.estimatedEquity > potOdds) {
    // リバーでツーペア以下はベットに対して慎重に（相手のレンジは強い）
    if (street === 'river' && toCall > 0 && handEval.madeHandRank <= 3) {
      const betToPotRatio = toCall / Math.max(1, state.pot);
      // ツーペアでも中〜大きなベットには高い確率でフォールド
      const riverFoldChance = Math.min(0.75, personality.foldToRiverBet + betToPotRatio * 0.3);
      if (Math.random() < riverFoldChance) {
        return { action: 'fold', amount: 0 };
      }
    }
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  // リバーでエクイティがポットオッズに足りない → フォールド
  if (street === 'river') {
    return { action: 'fold', amount: 0 };
  }

  // フロップ/ターンではインプライドオッズを考慮して緩めにコール
  if (toCall <= state.pot * 0.5) {
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

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
  // PLOではドロー外れのワンペアでコールはほぼ常に負ける
  if (street === 'river') {
    if (handEval.madeHandRank >= 3 && handEval.estimatedEquity > potOdds) {
      // ツーペア以上のメイドハンドがあればコール検討
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
  const street = state.currentStreet;

  // リバーではワンペアは非常に弱い（PLO）→ ほぼフォールド
  if (street === 'river' && toCall > 0) {
    const betToPotRatio = toCall / Math.max(1, state.pot);

    // ポットの30%以上のベット → ほぼフォールド
    if (betToPotRatio >= 0.3) {
      // オーバーペア級の高strength + アグレッシブ性格 → 稀にヒーローコール
      if (handEval.strength > 0.6 && Math.random() < personality.aggression * 0.06) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }

    // 非常に小さなベット（30%未満）→ 強いトップペアのみコール
    if (handEval.strength > 0.55) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }

    return { action: 'fold', amount: 0 };
  }

  // フロップ/ターン: トップペア以上 (strength > 0.4) なら継続
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
