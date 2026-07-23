// バリアント記述子 (VariantDescriptor)
//
// ゲーム進行の骨組み（アクション適用 → 次アクター決定 → ストリート進行 →
// ショーダウン）は core.ts に 1 本だけ存在し、バリアントごとの差分は
// この記述子で宣言的に注入する。新バリアントの追加は
// 「variants/ に記述子を 1 つ書いて registry.ts に 1 行登録」で完結する。

import { GameState, Player, Street, Action, GameVariant } from '../types.js';
import { SidePot, PotWinnerEntry } from './pots.js';

export type ValidAction = { action: Action; minAmount: number; maxAmount: number };

/**
 * ベッティング構造（Pot Limit / No Limit / Fixed Limit）の差分。
 * fold / check / call / all-in の骨組みは core 側にあり、
 * bet/raise の額決定・フルレイズ判定・minRaise 管理だけが構造ごとに異なる。
 */
export interface BettingRules {
  /** fold/check/call + bet/raise/allin の選択肢（folded・allin・ドロー街の除外後に呼ばれる） */
  getActions(state: GameState, playerIndex: number): ValidAction[];

  /** 'bet' | 'raise' の適用（state を直接更新する） */
  applyBetRaise(state: GameState, playerIndex: number, action: Action, amount: number): void;

  /** call のカスタム処理（Stud のブリングイン投入）。処理した場合 true を返す */
  applyCallOverride?(state: GameState, playerIndex: number): boolean;

  /** オールインの増分がフルレイズ扱いになる閾値 */
  fullRaiseThreshold(state: GameState): number;

  /** フルレイズ相当のオールイン時の構造固有更新（minRaise / betCount / lastRaiserIndex / hasActed リセット） */
  onAllInFullRaise(state: GameState, playerIndex: number, raiseBy: number): void;

  /** フルレイズ相当のオールインが lastFullRaiseBet を更新するか（Stud は更新しない） */
  allInFullRaiseSetsLastFullRaiseBet: boolean;

  /** 新ストリート開始時の minRaise（カード配布後、street 更新済みの state で呼ばれる） */
  minRaiseForStreet(state: GameState): number;

  /**
   * ストリート遷移処理の冒頭（street 更新前）にセットする minRaise。
   * 既存エンジンが遷移前にリセットしていた値の互換用。undefined なら変更しない。
   */
  minRaiseBeforeAdvance?(state: GameState): number;
}

/** ストリート進行とカード配布の差分 */
export interface StreetFlowRules {
  /** 現在のストリートの次のストリート */
  nextStreet(state: GameState): Street;

  /** 新ストリートに入った直後のカード配布（community / boards / 各プレイヤー） */
  onEnterStreet(state: GameState): void;

  /** そのストリートで最初に行動するプレイヤー（-1 = 誰もいない） */
  firstToAct(state: GameState): number;

  /**
   * ベッティング不能（アクション可能プレイヤーが1人以下）のときの挙動。
   * 'runout' = 残りカードを配りショーダウン / 'skipStreet' = 次のストリートへ（Draw 系）
   */
  whenBettingImpossible: 'runout' | 'skipStreet';

  /**
   * runout 遷移時に determineWinner の前へカードを配りきるか。
   * ボード系は runOut を先に実行（従来の runOutBoard 相当）、
   * Stud/Draw は determineWinner 内の配布のみ（従来挙動の維持）。
   */
  runOutDealsBeforeShowdown: boolean;

  /** ショーダウンに必要な残りカードを配りきる（contested 時に determineWinner 内で呼ばれる） */
  runOut(state: GameState): void;
}

/** ショーダウン解決の差分 */
export interface ShowdownRules {
  /** ノーフロップ・ノードロップ: このストリートで終わったハンドはレーキなし（null = 常にレーキ） */
  noDropStreet: Street | null;

  /** レーキ cap の基準額（通常は bigBlind、bomb pot は ante） */
  rakeCapBase(state: GameState): number;

  /**
   * ポット構築。サイドポット計算・デッドマネー処理・uncontested 返却
   * （state.pot / chips の更新）まで行い、contested ポットだけを返す。
   */
  buildPots(state: GameState): SidePot[];

  /** contested ポットの勝者を決定（チップ付与は core 側で行う） */
  resolvePots(state: GameState, activePlayers: Player[], pots: SidePot[]): PotWinnerEntry[];
}

/** ドローフェーズ（カード交換）を持つバリアント用 */
export interface DrawPhaseRules {
  /** 'draw' アクションの適用。ストリート進行・勝者確定まで含めて解決した state を返す */
  apply(state: GameState, playerIndex: number, discardIndices: number[], descriptor: VariantDescriptor): GameState;
}

export interface VariantDescriptor {
  /**
   * ハンド開始時のバリアント固有フィールドのリセット
   * （currentStreet / currentBet / minRaise / betCount / discardPile / boards 等）。
   * 共通フィールドのリセットは core の startHandCore が行う。
   */
  resetHand(state: GameState): void;

  /**
   * 強制ベット（ブラインド/アンテ/ブリングイン）・ポジション決定・配牌・
   * 最初のアクター決定。全員オールイン等でハンドが即決着する場合は
   * 決着済みの state を返してよい。
   */
  setup(state: GameState): GameState;

  betting: BettingRules;
  flow: StreetFlowRules;
  showdown: ShowdownRules;
  drawPhase?: DrawPhaseRules;

  /**
   * テーブル層（VariantAdapter）向け: ブラインド表の値から初期 GameState を作る。
   * smallBlind/bigBlind の解釈（実ブラインド or ベットラダー）はバリアント知識なのでここに置く。
   */
  createTableState(variant: GameVariant, buyInChips: number, smallBlind: number, bigBlind: number, ante: number): GameState;
}
