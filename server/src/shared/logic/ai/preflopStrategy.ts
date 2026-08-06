import { GameState, Action } from '../types.js';
import { getValidActions } from '../gameEngine.js';
import { BotPersonality, OpponentModel } from './types.js';

import { PreFlopEvaluation } from '../cpuAI.js';
import { evaluatePreflopByVariant } from './preflopFacade.js';

/**
 * プリフロップの意思決定。
 * パーソナリティによるVPIP/PFR制御、3ベット戦略、サイジング改善。
 */
export function getPreflopDecision(
  state: GameState,
  playerIndex: number,
  personality: BotPersonality,
  positionBonus: number,
  opponentModel?: OpponentModel
): { action: Action; amount: number } {
  const player = state.players[playerIndex];
  const validActions = getValidActions(state, playerIndex);
  const evaluation = evaluatePreflopByVariant(player.holeCards, state.variant);
  const handStrength = evaluation.score;
  const effectiveStrength = Math.min(1, handStrength + positionBonus);

  const toCall = state.currentBet - player.currentBet;
  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
  const random = Math.random();

  const facingRaise = state.currentBet > state.bigBlind;
  // PLO の標準オープンは 3.5BB。ここまでは「ビッグレイズ」扱いせず、フォールド頻度を上げない。
  const facingBigRaise = facingRaise && state.currentBet > state.bigBlind * 3.5;

  // プリフロップのレイズ回数で3bet/4bet状況を検出
  // raiseCount=1: オープンレイズ, =2: 3bet, >=3: 4bet+
  const preflopRaiseCount = state.handHistory.filter(
    a => a.action === 'raise' || a.action === 'allin'
  ).length;
  const facing3Bet = preflopRaiseCount >= 2;
  const facing4Bet = preflopRaiseCount >= 3;

  const isAAxx = evaluation.hasPair && evaluation.pairRank?.startsWith('A');
  const isKKxx = evaluation.hasPair && evaluation.pairRank?.startsWith('K');
  const isRainbow = isRainbowHand(player.holeCards);

  // === AAxx は常にプレミアムハンド扱い ===
  // PLOでAAxxはどんな構成でもプリフロップでレイズすべき最強カテゴリ
  if (isAAxx) {
    if (facing4Bet) {
      // 4betに対しては構成を問わず5bet（ポットレイズ＝実質オールイン圏）を返す。
      // AAxxはプリフロップの瞬間が相対的に一番強く、コール止めはSPR1前後で
      // 相性の悪い相手とフロップを見ることになる。5betしないBotは4betブラフの
      // コストが下がり搾取される（ソルバー: 構成問わず5betオールイン約96〜100%）
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'allin');
      if (raiseAction) return { action: raiseAction.action, amount: raiseAction.maxAmount };
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
      return { action: 'fold', amount: 0 };
    }
    // トラップ（コール止め）に回すのはほぼレインボーAAのみ
    // （ソルバー: ダブルスーテッド100% 3bet、レインボーは3bet 64%/コール36%）
    const raiseFreq = isRainbow ? 0.65 : 0.97;
    return playPremium(
      state, playerIndex, validActions, Math.max(effectiveStrength, 0.80), facingRaise, raiseFreq
    );
  }

  // === 4ベット以上に直面 ===
  // AAxx 以外全降りだと 4bet ブラフに搾取される（2026-07 実測: fold 79.7%、採算ライン約67%。
  // docs/bot-redesign.md Phase 0 参照）。良構造のプレミアムはコールで継続する
  if (facing4Bet) {
    // KKxx は相手のレンジが絞られるほど弱くなる手で、4betを受けた時点で
    // ほとんど降りる側（ソルバー: フォールド80.1%）。良構造でも残しすぎない
    if (isKKxx) {
      if (random < 0.80) return { action: 'fold', amount: 0 };
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
      return { action: 'fold', amount: 0 };
    }
    const goodStructure =
      evaluation.isDoubleSuited || (evaluation.isRundown && !evaluation.hasDangler);
    if (effectiveStrength > 0.80 && goodStructure) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }
    return { action: 'fold', amount: 0 };
  }

  // === 3ベットに直面: ハンド構造を考慮した判断 ===
  // プレミアムハンド（0.85+）でも3betに直面したら構造を考慮
  if (facing3Bet) {
    return facing3BetDecision(state, effectiveStrength, evaluation, isRainbow, validActions, personality, random);
  }

  // VPIP閾値: パーソナリティに基づいてハンド参加閾値を計算
  // vpip=0.40なら effectiveStrength 0.59以上で参加
  // vpip=0.20なら effectiveStrength 0.72以上で参加
  const vpipThreshold = Math.max(0.55, 0.85 - personality.vpip * 0.65);

  // PFR閾値: レイズする閾値
  const pfrThreshold = vpipThreshold + (personality.vpip - personality.pfr) * 0.8;

  // === プレミアムハンド (effectiveStrength > 0.85) ===
  // ここに到達するのはオープンor単一レイズに直面した場合のみ
  if (effectiveStrength > 0.85) {
    const raiseFreq = 0.70 + personality.aggression * 0.20;
    return playPremium(state, playerIndex, validActions, effectiveStrength, facingRaise, raiseFreq);
  }

  // === 3ベット判断（オープンレイズに対して re-raise） ===
  if (facingRaise && effectiveStrength > pfrThreshold + 0.10) {
    const threeBetDecision = evaluate3Bet(
      state, validActions, effectiveStrength, personality, positionBonus, random
    );
    if (threeBetDecision) return threeBetDecision;
  }

  // === 良いハンド: レイズ or コール ===
  if (effectiveStrength > pfrThreshold) {
    // 大きなレイズに直面 → 慎重
    if (facingBigRaise) {
      if (effectiveStrength > pfrThreshold + 0.10) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }

    // オープン（未レイズポット）: リンプせずレイズ or フォールド
    if (!facingRaise) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction) {
        const raiseSize = getOpenRaiseSize(state, playerIndex);
        const amount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, raiseSize));
        return { action: raiseAction.action, amount };
      }
    }

    // コール（レイズに直面している場合）
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction && potOdds < effectiveStrength * 0.8) {
      return { action: 'call', amount: callAction.minAmount };
    }
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    if (toCall > 0) return { action: 'fold', amount: 0 };
  }

  // === 参加可能なハンド (vpipThreshold以上) ===
  if (effectiveStrength > vpipThreshold) {
    // 大きなレイズ（ポットの半分超）には降りる
    if (facingBigRaise) {
      return { action: 'fold', amount: 0 };
    }

    // チェック（BBなど）
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // レイズに直面 → コール（ポットオッズに見合えば）
    if (facingRaise) {
      if (potOdds < effectiveStrength * 0.6) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      return { action: 'fold', amount: 0 };
    }

    // 未レイズポット: リンプせずフォールド（マージナルハンドでオープンリンプしない）
    return { action: 'fold', amount: 0 };
  }

  // === 弱いハンド: 基本フォールド ===
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };

  // スチール: ポジションが良い + ルースなパーソナリティ
  if (!facingRaise && positionBonus >= 0.08 && random < personality.bluffFreq * 0.5) {
    const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
    if (raiseAction) {
      return { action: raiseAction.action, amount: raiseAction.minAmount };
    }
  }

  return { action: 'fold', amount: 0 };
}

/**
 * 3ベットに直面した場合の判断。
 * ハンド強度だけでなく構造（スーテッド・コネクティビティ・ダングラー）を考慮。
 * PLOでは3betポットでのプレイアビリティが重要。
 */
function facing3BetDecision(
  state: GameState,
  effectiveStrength: number,
  evaluation: PreFlopEvaluation,
  isRainbow: boolean,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  personality: BotPersonality,
  random: number
): { action: Action; amount: number } {
  // 3ベットに対する最低必要強度（パーソナリティ依存）
  // 2026-07 実測で vs3bet fold 79.6%（採算ライン約67%）と搾取されていたため引き下げ。
  // TAG (vpip=0.20): ~0.65, LAG (vpip=0.38): ~0.62
  const minStrength = 0.55 + (1 - personality.vpip) * 0.12;

  // 最低強度未満は即フォールド
  if (effectiveStrength < minStrength) {
    return { action: 'fold', amount: 0 };
  }

  // レインボーは3betポットのフラッシュ経路がなく、コールして見に行っても
  // 勝ちを拾いにくい。「降りるか殴るか」の二極でプレイし、真ん中（コール）を
  // ほぼ残さない（ソルバー: フォールド69% / 4bet 14% / コール17%）
  if (isRainbow) {
    if (random < 0.69) return { action: 'fold', amount: 0 };
    const raiseAction = validActions.find(a => a.action === 'raise');
    if (raiseAction && random < 0.83 && effectiveStrength > minStrength + 0.10) {
      return { action: 'raise', amount: raiseAction.maxAmount };
    }
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };
    return { action: 'fold', amount: 0 };
  }

  // ハンド構造チェック: 3betポットでプレイアビリティが高いか
  // - ダブルスーテッド: フラッシュドロー2つでエクイティ実現しやすい
  // - ランダウン（ダングラー無し）: ストレートドロー豊富
  // - シングルスーテッド + ラップポテンシャル: ドロー力あり
  // - ペア + スーテッド + ダングラー無し: セット狙い + バックアップドロー
  const hasGoodStructure = (
    evaluation.isDoubleSuited ||
    (evaluation.isRundown && !evaluation.hasDangler) ||
    (evaluation.isSingleSuited && evaluation.hasWrap) ||
    (evaluation.hasPair && !evaluation.hasDangler &&
     (evaluation.hasAceSuited || evaluation.isSingleSuited || evaluation.isDoubleSuited))
  );

  if (!hasGoodStructure) {
    // 構造が悪い手は高確率でフォールド（最低45%、foldTo3Bet+5%）
    const foldRate = Math.max(0.45, personality.foldTo3Bet + 0.05);
    if (random < foldRate) {
      return { action: 'fold', amount: 0 };
    }
  }

  // 構造が良い手でもパーソナリティベースのフォールド判定
  const strengthBonus = Math.max(0, (effectiveStrength - minStrength) * 0.8);
  const adjustedFoldRate = Math.max(0.08, personality.foldTo3Bet - 0.12 - strengthBonus);
  if (random < adjustedFoldRate) {
    return { action: 'fold', amount: 0 };
  }

  // プレミアムハンド（0.85+）かつ良い構造なら4betも検討（コール止めが基本）
  if (effectiveStrength > 0.85 && hasGoodStructure) {
    const raiseAction = validActions.find(a => a.action === 'raise');
    if (raiseAction && random < personality.threeBetFreq * 0.5) {
      // 4betサイズ: ポットレイズ固定（サイズを1種類にして情報を漏らさない）
      return { action: 'raise', amount: raiseAction.maxAmount };
    }
  }

  // コール
  const callAction = validActions.find(a => a.action === 'call');
  if (callAction) return { action: 'call', amount: callAction.minAmount };

  return { action: 'fold', amount: 0 };
}

/**
 * プレミアムハンドのプレイ。
 * サイズはポットに固定（オープン3.5BB基準、3bet/4betはポットレイズ）。
 */
function playPremium(
  state: GameState,
  playerIndex: number,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  effectiveStrength: number,
  facingRaise: boolean,
  raiseFreq: number
): { action: Action; amount: number } {
  const random = Math.random();
  const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');

  if (raiseAction) {
    if (random < raiseFreq) {
      let raiseSize: number;
      if (facingRaise) {
        // 3ベット: ポットレイズ固定
        raiseSize = raiseAction.maxAmount;
      } else {
        // オープン: ポット（3.5BB + リンパー分）
        raiseSize = getOpenRaiseSize(state, playerIndex);
      }
      const amount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, raiseSize));
      return { action: raiseAction.action, amount };
    }
  }

  // コール（トラップ）
  const callAction = validActions.find(a => a.action === 'call');
  if (callAction) return { action: 'call', amount: callAction.minAmount };
  const checkAction = validActions.find(a => a.action === 'check');
  if (checkAction) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

/**
 * 3ベット判断。
 * ポジションと相手タイプに応じた3ベット（ブラフ3ベット含む）。
 */
function evaluate3Bet(
  state: GameState,
  validActions: { action: Action; minAmount: number; maxAmount: number }[],
  effectiveStrength: number,
  personality: BotPersonality,
  positionBonus: number,
  random: number
): { action: Action; amount: number } | null {
  const raiseAction = validActions.find(a => a.action === 'raise');
  if (!raiseAction) return null;

  let threeBetChance = personality.threeBetFreq;

  // ポジションが良いと3ベット頻度UP
  if (positionBonus >= 0.08) threeBetChance += 0.03;

  // 強いほど3ベット率UP
  if (effectiveStrength > 0.85) threeBetChance += 0.05;

  if (random >= threeBetChance) return null;

  // 3ベットサイズ: ポットレイズ固定（サイズを1種類にして情報を漏らさない）
  return { action: 'raise', amount: raiseAction.maxAmount };
}

/**
 * オープンレイズサイズ。
 * ポットに固定: 3.5BB + リンパー1人につき+1BB（ポットリミットの正しいレイズ額
 * 「3×直前のベット＋デッドマネー」と一致する）。小さく開けると相手が受ける値段が
 * 安くなり、PLOでは最弱手でも最強手に対し3割前後あるためほぼ何でも受けられてしまう。
 * サイズを1種類に固定することで情報漏れも防ぐ。
 */
function getOpenRaiseSize(state: GameState, playerIndex: number): number {
  // リンパー数（ちょうどBB額をベットしている人数。ブラインド投稿のBB自身は除く）
  const limpers = state.players.filter(p =>
    !p.folded && p.currentBet === state.bigBlind && p.id !== playerIndex && p.position !== 'BB'
  ).length;

  return Math.floor(state.bigBlind * (3.5 + limpers * 1.0));
}

/** 4枚すべて異なるスートか（レインボー判定） */
function isRainbowHand(holeCards: { suit: string }[]): boolean {
  const suits = new Set(holeCards.filter(c => c && c.suit).map(c => c.suit));
  return suits.size === 4;
}
