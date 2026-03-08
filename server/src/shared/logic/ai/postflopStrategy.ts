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

  // === リバー: 専用ロジックに委譲 ===
  if (street === 'river') {
    return playRiver(
      state, playerIndex, validActions, handEval, boardTexture,
      potOdds, spr, personality, streetHistory, numOpponents,
      positionBonus, opponentModel
    );
  }

  // === 0. Cベットに対するフォールド判断 ===
  // 相手がアグレッサーでベットに直面 + 弱いハンド → foldToCbet で判断
  if (toCall > 0 && !isAggressor &&
      handEval.madeHandRank <= 2 && !handEval.hasFlushDraw && !handEval.hasWrapDraw) {
    const drawBonus = handEval.hasStraightDraw ? 0.15 : 0;
    const strengthBonus = handEval.madeHandRank === 2 ? 0.15 : 0;
    const adjustedFoldRate = Math.max(0.10, personality.foldToCbet - drawBonus - strengthBonus);
    if (Math.random() < adjustedFoldRate) {
      return { action: 'fold', amount: 0 };
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
  if (toCall === 0 && isAggressor) {
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
    return playOnePair(validActions, handEval, potOdds);
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
  // フロートコール: ディフェンス頻度を確保（降りすぎ防止）
  // ポジションがあるほどフロート有利
  if (toCall > 0) {
    const floatChance = 0.10 + positionBonus * 0.08;
    if (potOdds <= 0.30 && Math.random() < floatChance) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
    // 非常に安いならコール
    if (potOdds < 0.15 && toCall < player.chips * 0.05) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
  }

  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  return { action: 'fold', amount: 0 };
}

/**
 * リバー専用の意思決定。
 * ハンド強度に基づく階層的な判断:
 *   1. ナッツ → バリューベット/スロープレイ
 *   2. ニアナッツ → バリューベット/慎重コール
 *   3. 強メイド → ボードテクスチャ+nutRankで判断
 *   4. ワンペア → ほぼフォールド
 *   5. ハイカード → フォールド/ブラフ
 */
function playRiver(
  state: GameState,
  playerIndex: number,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: ExtendedHandEval,
  boardTexture: ExtendedBoardTexture,
  potOdds: number,
  spr: number,
  personality: BotPersonality,
  streetHistory: StreetHistory,
  numOpponents: number,
  positionBonus: number,
  opponentModel?: OpponentModel
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const toCall = state.currentBet - player.currentBet;
  const isAggressor = streetHistory.preflopAggressor === playerIndex;
  const nr = handEval.nutRank ?? 99;
  const betToPotRatio = toCall > 0 ? toCall / Math.max(1, state.pot) : 0;

  const canCheck = () => validActions.find(a => a.action === 'check');
  const canCall = () => validActions.find(a => a.action === 'call');
  const canRaise = () => validActions.find(a => a.action === 'raise' || a.action === 'bet');

  const makeValueBet = (): { action: Action; amount: number } | null => {
    const raiseAction = canRaise();
    if (!raiseAction) return null;
    const sizePct = decideBetSize({
      pot: state.pot, street: 'river', spr, boardTexture, handEval,
      isAggressor, numOpponents, personality,
    });
    const amount = calculateBetAmount(sizePct, state.pot, raiseAction.minAmount, raiseAction.maxAmount);
    return { action: raiseAction.action, amount };
  };

  // === 1. ナッツ (nutRank 1) ===
  if (nr === 1) {
    return playMonster(state, validActions, handEval, boardTexture, spr, personality, streetHistory, playerIndex);
  }

  // === 2. ニアナッツ (nutRank 2-3, rank >= 3) ===
  if (nr <= 3 && handEval.madeHandRank >= 3) {
    if (toCall > 0) {
      // フラッシュボード + フラッシュ未保持: nr2-3なので控えめにフォールド
      if (boardTexture.flushPossible && handEval.madeHandRank < 6 && betToPotRatio >= 0.6) {
        const foldChance = nr === 2 ? Math.min(0.20, (betToPotRatio - 0.6) * 0.3)
                                     : Math.min(0.35, 0.15 + (betToPotRatio - 0.6) * 0.3);
        if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
      }
      // ストレートボード + ストレート未保持: フラッシュより緩めだがケア
      if (boardTexture.straightPossible && handEval.madeHandRank < 5 && betToPotRatio >= 0.7) {
        const foldChance = nr === 2 ? Math.min(0.12, (betToPotRatio - 0.7) * 0.2)
                                     : Math.min(0.25, 0.10 + (betToPotRatio - 0.7) * 0.25);
        if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
      }
      if (nr === 3 && betToPotRatio >= 0.7) {
        const foldChance = Math.min(0.25, personality.foldToRiverBet * 0.25);
        if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
      }
      // フォールドチェック通過 → バリューレイズ or コール
      let valueBetChanceFacing: number;
      if (nr === 2) {
        valueBetChanceFacing = 0.80 + personality.aggression * 0.10;
        if (boardTexture.isWet) valueBetChanceFacing += 0.05;
      } else {
        valueBetChanceFacing = 0.55 + personality.aggression * 0.15;
        if (boardTexture.isWet) valueBetChanceFacing += 0.05;
      }
      if (Math.random() < valueBetChanceFacing) {
        const bet = makeValueBet();
        if (bet) return bet;
      }
      const callAction = canCall();
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
    // バリューベット（ベット非直面時）
    let valueBetChance: number;
    if (nr === 2) {
      valueBetChance = 0.80 + personality.aggression * 0.10;
      if (boardTexture.isWet) valueBetChance += 0.05;
    } else {
      valueBetChance = 0.55 + personality.aggression * 0.15;
      if (boardTexture.isWet) valueBetChance += 0.05;
    }
    if (Math.random() < valueBetChance) {
      const bet = makeValueBet();
      if (bet) return bet;
    }
    const checkAction = canCheck();
    if (checkAction) return { action: 'check', amount: 0 };
    const callAction = canCall();
    if (callAction) return { action: 'call', amount: callAction.minAmount };
    return { action: 'fold', amount: 0 };
  }

  // === 3. 強いメイドハンド (rank >= 3, nutRank 4+ or 未計算) ===
  if (handEval.madeHandRank >= 3) {
    if (toCall > 0) {
      // フラッシュ可能ボード + フラッシュ未保持: セット以上は緩め、ツーペアは厳しめ
      if (boardTexture.flushPossible && handEval.madeHandRank < 6 && betToPotRatio >= 0.5) {
        const baseFold = handEval.madeHandRank >= 4 ? 0.20 : 0.40;
        const cap = handEval.madeHandRank >= 4 ? 0.40 : 0.60;
        const foldChance = Math.min(cap, baseFold + (betToPotRatio - 0.5) * 0.3);
        if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
      }
      // ストレート可能ボード + ストレート未保持: フラッシュの70%程度の強度
      if (boardTexture.straightPossible && handEval.madeHandRank < 5 && betToPotRatio >= 0.5) {
        const baseFold = handEval.madeHandRank >= 4 ? 0.15 : 0.30;
        const cap = handEval.madeHandRank >= 4 ? 0.30 : 0.45;
        const foldChance = Math.min(cap, baseFold + (betToPotRatio - 0.5) * 0.25);
        if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
      }
      // nutRank 4+: ベット(>50%pot)に対してフォールド（ただし降りすぎ防止キャップ）
      if (nr >= 4 && betToPotRatio >= 0.5) {
        const sizingBonus = (betToPotRatio - 0.5) * 0.3;
        const foldChance = Math.min(0.45, personality.foldToRiverBet * 0.5 + sizingBonus);
        if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
      }
      // nutRank 未計算フォールバック
      if (handEval.nutRank === undefined) {
        if (handEval.madeHandRank === 3 && betToPotRatio >= 0.6) {
          const foldChance = Math.min(0.55, personality.foldToRiverBet * 0.7 + (betToPotRatio - 0.6) * 0.3);
          if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
        }
        if (handEval.madeHandRank === 4 && betToPotRatio >= 0.7 && (boardTexture.flushPossible || boardTexture.straightPossible)) {
          const foldChance = Math.min(0.35, personality.foldToRiverBet * 0.4 + (betToPotRatio - 0.7) * 0.2);
          if (Math.random() < foldChance) return { action: 'fold', amount: 0 };
        }
      }
      // ペアボードでフルハウス以下 + 大ベット → 慎重に
      if (boardTexture.isPaired && handEval.madeHandRank < 7 && toCall > state.pot * 0.5) {
        if (handEval.estimatedEquity > potOdds) {
          const callAction = canCall();
          if (callAction) return { action: 'call', amount: callAction.minAmount };
        }
        return { action: 'fold', amount: 0 };
      }
      // フラッシュボードでフラッシュ未完成 + ベット(>40%pot) → 慎重（ただしセット以上はコール寄り）
      if (boardTexture.flushPossible && handEval.madeHandRank < 6 && toCall > state.pot * 0.4) {
        if (handEval.estimatedEquity > potOdds) {
          const callAction = canCall();
          if (callAction) return { action: 'call', amount: callAction.minAmount };
        }
        // セット以上は簡単に降りない
        if (handEval.madeHandRank >= 4 && Math.random() < 0.35) {
          const callAction = canCall();
          if (callAction) return { action: 'call', amount: callAction.minAmount };
        }
        return { action: 'fold', amount: 0 };
      }
      // ストレートボードでストレート未完成 + ベット(>50%pot) → 慎重
      if (boardTexture.straightPossible && handEval.madeHandRank < 5 && toCall > state.pot * 0.5) {
        if (handEval.estimatedEquity > potOdds) {
          const callAction = canCall();
          if (callAction) return { action: 'call', amount: callAction.minAmount };
        }
        if (handEval.madeHandRank >= 4 && Math.random() < 0.40) {
          const callAction = canCall();
          if (callAction) return { action: 'call', amount: callAction.minAmount };
        }
        return { action: 'fold', amount: 0 };
      }
      // アグレッションベースのレイズ（フォールドチェックを通過した場合）
      if (Math.random() > (1 - personality.aggression * 0.6)) {
        const bet = makeValueBet();
        if (bet) return bet;
      }
      // エクイティ > potOdds → コール（nutRank が高くても既にフォールド判定を通過しているので緩めに）
      if (handEval.estimatedEquity > potOdds) {
        if (nr >= 5 && betToPotRatio >= 0.6) {
          const riverFoldChance = Math.min(0.45, personality.foldToRiverBet * 0.4 + (betToPotRatio - 0.6) * 0.2);
          if (Math.random() < riverFoldChance) return { action: 'fold', amount: 0 };
        }
        const callAction = canCall();
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }
    // ベットに直面していない → アグレッションベースでベット
    if (Math.random() > (1 - personality.aggression * 0.6)) {
      const bet = makeValueBet();
      if (bet) return bet;
    }
    const checkAction = canCheck();
    if (checkAction) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // === 4. ワンペア (rank 2) ===
  if (handEval.madeHandRank === 2) {
    if (toCall > 0) {
      // 一箇所でフォールド率を計算（多段直列による降りすぎを防止）
      let foldRate = 0.70;

      // ベットサイズ: 小さいほどコール寄り、大きいほどフォールド寄り
      if (betToPotRatio < 0.3) foldRate -= 0.20;
      else if (betToPotRatio < 0.6) foldRate += 0.00;
      else if (betToPotRatio < 1.0) foldRate += 0.10;
      else foldRate += 0.15;

      // ボードテクスチャ: 危険なボードほどフォールド寄り
      if (boardTexture.flushPossible) foldRate += 0.10;
      if (boardTexture.straightPossible) foldRate += 0.05;
      if (!boardTexture.isWet) foldRate -= 0.10;

      // ハンド強度: 強いペアほどブラフキャッチ
      if (handEval.strength > 0.6) foldRate -= 0.15;
      else if (handEval.strength > 0.5) foldRate -= 0.08;
      else if (handEval.strength < 0.4) foldRate += 0.10;

      // パーソナリティ: foldToRiverBet 0.6 を基準に±調整
      foldRate += (personality.foldToRiverBet - 0.6) * 0.3;

      // クランプ: PLOリバーのワンペアは弱いが、最低限のブラフキャッチは必要
      foldRate = Math.max(0.45, Math.min(0.92, foldRate));

      if (Math.random() < foldRate) {
        return { action: 'fold', amount: 0 };
      }
      const callAction = canCall();
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
    // ベット非直面: たまにシンバリューベット（降りすぎ読みへの対策）
    if (handEval.strength > 0.6 && Math.random() < 0.15 + personality.aggression * 0.10) {
      const bet = makeValueBet();
      if (bet) return bet;
    }
    const checkAction = canCheck();
    if (checkAction) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // === 5. ハイカード以下 (rank <= 1) ===
  if (toCall > 0) {
    return { action: 'fold', amount: 0 };
  }
  // ブラフ検討
  const bluffDecision = evaluateBluff(
    state, playerIndex, handEval, boardTexture, streetHistory,
    personality, positionBonus, opponentModel
  );
  if (bluffDecision.shouldBluff) {
    return makeBluffBet(state, validActions, handEval, boardTexture, spr, personality, numOpponents, playerIndex);
  }
  const checkAction = canCheck();
  if (checkAction) return { action: 'check', amount: 0 };
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
 * 強いメイドハンド (ツーペア+) のプレイ。（フロップ/ターン用）
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

  // ペアボードでフルハウス以下 + 大ベット → 慎重だがバランスを取る
  if (boardTexture.isPaired && handEval.madeHandRank < 7) {
    if (toCall > state.pot * 0.5) {
      // エクイティがポットオッズを上回ればコール（フロップ/ターンはまだストリートが残る）
      if (handEval.estimatedEquity > potOdds * 0.9) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      // セット以上なら簡単に降りない（フロップ/ターンでフルハウスリドローあり）
      if (handEval.madeHandRank >= 4 && Math.random() < 0.40) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }
  }

  // フラッシュボードでフラッシュ未完成 → 慎重だがバランスを取る
  if (boardTexture.flushPossible && handEval.madeHandRank < 6) {
    if (toCall > state.pot * 0.4) {
      if (handEval.estimatedEquity > potOdds) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      // ツーペア+ならフロップ/ターンで安易にフォールドしない
      if (handEval.madeHandRank >= 3 && Math.random() < 0.30) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }
  }

  // ストレートボードでストレート未完成 → フラッシュより緩めだが慎重に
  if (boardTexture.straightPossible && handEval.madeHandRank < 5) {
    if (toCall > state.pot * 0.5) {
      if (handEval.estimatedEquity > potOdds) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      if (handEval.madeHandRank >= 3 && Math.random() < 0.35) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }
  }

  // チェックレンジ: アグレッサーでも強ハンドをたまにチェック（予測可能性を下げる）
  const isAggressorHere = streetHistory.preflopAggressor === playerIndex;
  if (toCall === 0 && isAggressorHere && Math.random() < 0.15) {
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
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
        isAggressor: isAggressorHere,
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
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
  }

  // インプライドオッズを考慮して緩めにコール
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
 * ドローハンドのプレイ。（フロップ/ターン用）
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

  // ペアボード → ストレート/フラッシュを引いてもフルハウスに負けるリスク
  if (boardTexture.isPaired && handEval.madeHandRank < 7) {
    if (handEval.madeHandRank <= 2) {
      // 強いドロー（drawStrength > 0.5）ならフルハウスドローの可能性 → インプライドオッズで緩めにコール
      if (handEval.drawStrength > 0.5 && toCall > 0 && handEval.estimatedEquity > potOdds * 0.6) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
      return { action: 'fold', amount: 0 };
    }
    // ツーペア+でもベットに直面 + 大きめサイズなら慎重に
    if (toCall > 0 && potOdds > 0.3) {
      // インプライドオッズ: 強ドローならエクイティ要件を緩和
      const equityThreshold = handEval.drawStrength > 0.4 ? potOdds * 0.8 : potOdds;
      if (handEval.estimatedEquity > equityThreshold) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }
  }

  // フラッシュ可能ボードでフラッシュドロー無し → ストレートドローのインプライドオッズが激減
  // ストレートを引いてもフラッシュに負けるため、弱いドローはフォールド寄りに
  if (boardTexture.flushPossible && !handEval.hasFlushDraw) {
    // メイドハンドが弱い（ワンペア以下）場合はほぼフォールド
    if (handEval.madeHandRank <= 2) {
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
      return { action: 'fold', amount: 0 };
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
 * ワンペアのプレイ。（フロップ/ターン用）
 */
function playOnePair(
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  handEval: ExtendedHandEval,
  potOdds: number
): { action: Action; amount: number } {
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
