import { GameState, Player, Position, Action } from './types.js';
import { createDeck, shuffleDeck, dealCards } from './deck.js';
import { evaluatePLOHand, compareHands } from './handEvaluator.js';

// ポーカーテーブルの6つのポジション（ディーラーボタンから時計回り）
const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

/**
 * ゲームの初期状態を作成する
 * @param playerChips 各プレイヤーの初期チップ量（デフォルト: 600）
 * @returns 初期化されたGameState
 */
export function createInitialGameState(playerChips: number = 600): GameState {
  const players: Player[] = [];

  // プレイヤー作成
  const names = ['You', 'Miko', 'Kento', 'Luna', 'Hiro', 'Tomoka'];
  for (let i = 0; i < 6; i++) {
    players.push({
      id: i,
      name: names[i],
      position: POSITIONS[i],
      chips: playerChips,
      holeCards: [],         // PLOでは4枚のホールカード
      currentBet: 0,         // 現在のストリートでの累計ベット額
      totalBetThisRound: 0,  // このハンド全体での累計ベット額
      folded: false,
      isAllIn: false,
      hasActed: false,       // このストリートでアクション済みか
      isSittingOut: false,
    });
  }

  return {
    players,
    deck: [],
    communityCards: [],
    pot: 0,
    sidePots: [],
    currentStreet: 'preflop',
    dealerPosition: 0,       // ディーラーボタンの位置（プレイヤーインデックス）
    currentPlayerIndex: 0,   // 現在アクションするプレイヤーのインデックス
    currentBet: 0,           // 現在のストリートでの最高ベット額
    minRaise: 0,             // 最小レイズ額
    smallBlind: 1,
    bigBlind: 3,
    lastRaiserIndex: -1,     // 最後にレイズしたプレイヤー（-1は誰もレイズしていない）
    lastFullRaiseBet: 0,     // フルレイズが発生した時の currentBet（リオープン判定用）
    handHistory: [],         // このハンドのアクション履歴
    isHandComplete: false,
    winners: [],
  };
}

/**
 * 新しいハンドを開始する
 * デッキのシャッフル、ブラインド投稿、カード配布を行う
 */
export function startNewHand(state: GameState): GameState {
  const newState = { ...state };

  // === ハンド状態のリセット ===
  newState.communityCards = [];
  newState.pot = 0;
  newState.sidePots = [];
  newState.currentStreet = 'preflop';
  newState.currentBet = newState.bigBlind;  // プリフロップではBBが最低ベット
  newState.minRaise = newState.bigBlind;
  newState.handHistory = [];
  newState.isHandComplete = false;
  newState.winners = [];
  newState.lastRaiserIndex = -1;
  newState.lastFullRaiseBet = 0;

  // === プレイヤー状態のリセット ===
  newState.players = newState.players.map(p => ({
    ...p,
    holeCards: [],
    currentBet: 0,
    totalBetThisRound: 0,
    folded: p.isSittingOut,     // 空席は最初からfolded
    isAllIn: false,
    hasActed: p.isSittingOut,   // 空席はアクション不要
  }));

  // デッキをシャッフル
  newState.deck = shuffleDeck(createDeck());

  // === ディーラーボタンを移動 ===
  // チップを持っているプレイヤーの席へ（破産プレイヤーはスキップ）
  const nextDealer = getNextPlayerWithChips(newState, newState.dealerPosition);
  if (nextDealer !== -1) {
    newState.dealerPosition = nextDealer;
  }

  // ポジション名を更新（ディーラー位置基準で再計算）
  for (let i = 0; i < 6; i++) {
    const posIndex = (i - newState.dealerPosition + 6) % 6;
    newState.players[i].position = POSITIONS[posIndex];
  }

  // アクティブプレイヤー数を確認
  const activeCount = getActivePlayerCount(newState);

  // === ブラインド位置の決定 ===
  let sbIndex: number;
  let bbIndex: number;

  if (activeCount === 2) {
    // Heads-up（2人プレイ）の特殊ルール: BTN = SB
    // ディーラーがスモールブラインドを兼ねる
    sbIndex = getNextPlayerWithChips(newState, newState.dealerPosition - 1);
    if (sbIndex === -1) sbIndex = newState.dealerPosition;
    bbIndex = getNextPlayerWithChips(newState, sbIndex);
  } else {
    // 通常ルール（3人以上）: ディーラーの次がSB、その次がBB
    sbIndex = getNextPlayerWithChips(newState, newState.dealerPosition);
    bbIndex = getNextPlayerWithChips(newState, sbIndex);
  }

  // === ブラインドを投稿 ===
  // スモールブラインド（チップが足りない場合はオールイン）
  newState.players[sbIndex].currentBet = Math.min(newState.smallBlind, newState.players[sbIndex].chips);
  newState.players[sbIndex].totalBetThisRound = newState.players[sbIndex].currentBet;
  newState.players[sbIndex].chips -= newState.players[sbIndex].currentBet;
  if (newState.players[sbIndex].chips === 0) newState.players[sbIndex].isAllIn = true;

  // ビッグブラインド
  newState.players[bbIndex].currentBet = Math.min(newState.bigBlind, newState.players[bbIndex].chips);
  newState.players[bbIndex].totalBetThisRound = newState.players[bbIndex].currentBet;
  newState.players[bbIndex].chips -= newState.players[bbIndex].currentBet;
  if (newState.players[bbIndex].chips === 0) newState.players[bbIndex].isAllIn = true;

  // ブラインドをポットに加算
  newState.pot = newState.players[sbIndex].currentBet + newState.players[bbIndex].currentBet;

  // BBの投稿をフルレイズとして記録（プリフロップ特有）
  newState.lastFullRaiseBet = newState.currentBet;

  // === カードを配る ===
  // PLOは4枚ずつ配る（テキサスホールデムは2枚）
  for (let i = 0; i < 6; i++) {
    if (newState.players[i].isSittingOut) continue;
    const { cards, remainingDeck } = dealCards(newState.deck, 4);
    newState.players[i].holeCards = cards;
    newState.deck = remainingDeck;
  }

  // === アクション開始位置を決定 ===
  if (activeCount === 2) {
    // Heads-upではプリフロップはSB（BTN）から先にアクション
    newState.currentPlayerIndex = sbIndex;
  } else {
    // 通常ルール: UTG（BBの次）からアクション開始
    newState.currentPlayerIndex = getNextActivePlayer(newState, bbIndex);
  }
  // BBが最後のレイザーとして扱われる（プリフロップ特有）
  newState.lastRaiserIndex = bbIndex;

  // アクション可能なプレイヤーがいない場合（全員オールイン）はショーダウンへ
  if (newState.currentPlayerIndex === -1) {
    return runOutBoard(newState);
  }

  return newState;
}

/**
 * 次のアクション可能なプレイヤーを探す
 * @param fromIndex この位置の次から探し始める
 * @returns プレイヤーインデックス、見つからない場合は-1
 */
function getNextActivePlayer(state: GameState, fromIndex: number): number {
  let index = (fromIndex + 1) % 6;
  let count = 0;
  while (count < 6) {
    // 着席中で、フォールドしておらず、オールインでもないプレイヤー
    if (!state.players[index].isSittingOut && !state.players[index].folded && !state.players[index].isAllIn) {
      return index;
    }
    index = (index + 1) % 6;
    count++;
  }
  return -1;  // 全員がフォールドかオールイン
}

/**
 * ゲームに参加可能なプレイヤー数を取得
 * （着席中でフォールドしていない）
 */
function getActivePlayerCount(state: GameState): number {
  return state.players.filter(p => !p.isSittingOut && !p.folded).length;
}

/**
 * 指定位置から次の着席中プレイヤーを探す
 * ディーラーボタン移動やブラインド位置決定に使用
 */
function getNextPlayerWithChips(state: GameState, fromIndex: number): number {
  let index = (fromIndex + 1) % 6;
  let count = 0;
  while (count < 6) {
    if (!state.players[index].isSittingOut && !state.players[index].folded) {
      return index;
    }
    index = (index + 1) % 6;
    count++;
  }
  return -1;
}

/**
 * フォールドしていないプレイヤー一覧を取得
 */
export function getActivePlayers(state: GameState): Player[] {
  return state.players.filter(p => !p.folded);
}

/**
 * アクション可能なプレイヤー一覧を取得
 * （フォールドしておらず、オールインでもない）
 */
export function getPlayersWhoCanAct(state: GameState): Player[] {
  return state.players.filter(p => !p.folded && !p.isAllIn);
}

/**
 * 指定プレイヤーが取れる有効なアクション一覧を取得
 * ポットリミット制限を考慮したベット/レイズ額を計算
 */
export function getValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  const player = state.players[playerIndex];
  const actions: { action: Action; minAmount: number; maxAmount: number }[] = [];

  // フォールド済みまたはオールインのプレイヤーはアクション不可
  if (player.folded || player.isAllIn) return actions;

  // コールに必要な額を計算
  const toCall = state.currentBet - player.currentBet;

  // フォールドは常に可能
  actions.push({ action: 'fold', minAmount: 0, maxAmount: 0 });

  if (toCall === 0) {
    // 誰もベットしていない、またはすでに同額ベット済み → チェック可能
    actions.push({ action: 'check', minAmount: 0, maxAmount: 0 });
  } else {
    // コール（チップが足りない場合は持っているチップ全額）
    const callAmount = Math.min(toCall, player.chips);
    actions.push({ action: 'call', minAmount: callAmount, maxAmount: callAmount });
  }

  // === フルレイズルール: リレイズ権の判定 ===
  // hasActed=true かつ lastFullRaiseBet 以上のベット済み → リレイズ不可（コール/フォールドのみ）
  // 非フルレイズのオールインに対して、既にアクション済みプレイヤーはコール/フォールドのみ
  const canRaise = !player.hasActed || player.currentBet < state.lastFullRaiseBet;

  // === ポットリミット計算 ===
  // PLOのポットリミット: コール額 + (現在のポット + コール額)
  // 例: ポット100、コール額20 → 最大レイズ = 20 + (100 + 20) = 140
  const potAfterCall = state.pot + toCall;
  const potLimitRaise = toCall + potAfterCall;
  const maxByPotLimit = Math.min(potLimitRaise, player.chips);

  // ベット/レイズ（コール額より多くのチップが必要、かつリレイズ権あり）
  if (canRaise && player.chips > toCall) {
    const minRaiseTotal = state.currentBet + state.minRaise;  // 最小レイズ後の合計ベット額
    const minRaiseAmount = minRaiseTotal - player.currentBet; // プレイヤーが追加で出す額

    if (state.currentBet === 0) {
      // まだ誰もベットしていない → ベット
      // ポットリミットベット = 現在のポット額
      const potLimitBet = Math.min(state.pot, player.chips);
      const minBet = Math.min(state.bigBlind, player.chips);
      actions.push({ action: 'bet', minAmount: minBet, maxAmount: potLimitBet });
    } else {
      // 既にベットがある → レイズ
      if (player.chips >= minRaiseAmount) {
        actions.push({ action: 'raise', minAmount: minRaiseAmount, maxAmount: maxByPotLimit });
      }
    }
  }

  // オールイン（チップがポットリミット以下の場合のみ選択肢として表示、かつリレイズ権あり）
  if (canRaise && player.chips > 0) {
    const maxBetOrRaise = state.currentBet === 0 ? state.pot : potLimitRaise;
    if (player.chips <= maxBetOrRaise) {
      actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
    }
  }

  return actions;
}

/**
 * プレイヤーのアクションをゲーム状態に適用する
 * @param playerIndex アクションを行うプレイヤー
 * @param action アクション種別
 * @param amount ベット/レイズ額（該当する場合）
 * @returns 更新されたGameState
 */
export function applyAction(state: GameState, playerIndex: number, action: Action, amount: number = 0): GameState {
  // 状態をディープコピー（イミュータブルな更新）
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  const player = newState.players[playerIndex];

  player.hasActed = true;  // このストリートでアクション済みフラグ

  switch (action) {
    case 'fold':
      player.folded = true;
      break;

    case 'check':
      // 何もしない（ベット額0でパス）
      break;

    case 'call': {
      // 現在のベット額に合わせる
      const toCall = Math.min(newState.currentBet - player.currentBet, player.chips);
      player.chips -= toCall;
      player.currentBet += toCall;
      player.totalBetThisRound += toCall;
      newState.pot += toCall;
      if (player.chips === 0) player.isAllIn = true;
      break;
    }

    case 'bet':
    case 'raise': {
      // レイズ額を計算（前のベットからの増分）
      const raiseBy = amount - (newState.currentBet - player.currentBet);
      if (raiseBy > newState.minRaise) {
        newState.minRaise = raiseBy;  // 次のレイズの最小額を更新
      }
      player.chips -= amount;
      player.currentBet += amount;
      player.totalBetThisRound += amount;
      newState.pot += amount;
      newState.currentBet = player.currentBet;  // 新しい最高ベット額
      newState.lastRaiserIndex = playerIndex;
      newState.lastFullRaiseBet = newState.currentBet;  // bet/raiseは常にフルレイズ
      if (player.chips === 0) player.isAllIn = true;

      // レイズがあったら他のプレイヤーのhasActedをリセット
      // （全員に再度アクションの機会を与える）
      for (const p of newState.players) {
        if (p.id !== player.id && !p.folded && !p.isAllIn) {
          p.hasActed = false;
        }
      }
      break;
    }

    case 'allin': {
      // 残りチップ全額をベット
      const allInAmount = player.chips;
      if (player.currentBet + allInAmount > newState.currentBet) {
        // オールインがレイズになる場合
        const raiseBy = (player.currentBet + allInAmount) - newState.currentBet;
        const isFullRaise = raiseBy >= newState.minRaise;
        if (isFullRaise) {
          // 最小レイズ額以上なら正式なレイズ扱い（フルレイズ）
          newState.minRaise = raiseBy;
          newState.lastRaiserIndex = playerIndex;
          // 他のプレイヤーのhasActedをリセット
          for (const p of newState.players) {
            if (p.id !== player.id && !p.folded && !p.isAllIn) {
              p.hasActed = false;
            }
          }
        }
        newState.currentBet = player.currentBet + allInAmount;
        // フルレイズ時のみ lastFullRaiseBet を更新（非フルレイズでは既アクション済みプレイヤーにリレイズ権なし）
        if (isFullRaise) {
          newState.lastFullRaiseBet = newState.currentBet;
        }
      }
      player.currentBet += allInAmount;
      player.totalBetThisRound += allInAmount;
      newState.pot += allInAmount;
      player.chips = 0;
      player.isAllIn = true;
      break;
    }
  }

  // アクション履歴に記録
  newState.handHistory.push({ playerId: playerIndex, action, amount, street: state.currentStreet });

  // === 次のアクションを決定 ===
  const nextResult = determineNextAction(newState);
  if (nextResult.moveToNextStreet) {
    // 次のストリートへ進む
    return moveToNextStreet(newState);
  } else if (nextResult.nextPlayerIndex !== -1) {
    // 次のプレイヤーへ
    newState.currentPlayerIndex = nextResult.nextPlayerIndex;
  } else {
    // ハンド終了（1人だけ残った等）
    return determineWinner(newState);
  }

  return newState;
}

/**
 * アクションを適用した結果、次のストリートに進むかどうかを判定する（immutable）
 * 元の state は変更しない
 */
export function wouldAdvanceStreet(state: GameState, playerIndex: number, action: Action, amount: number = 0): boolean {
  const resultState = applyAction(state, playerIndex, action, amount);
  return resultState.currentStreet !== state.currentStreet;
}

/**
 * 次にアクションすべきプレイヤーを決定する
 * @returns nextPlayerIndex: 次のプレイヤー（-1なら終了）, moveToNextStreet: 次のストリートに進むか
 */
function determineNextAction(state: GameState): { nextPlayerIndex: number; moveToNextStreet: boolean } {
  const activePlayers = getActivePlayers(state);

  // 1人しか残っていない → ハンド終了
  if (activePlayers.length === 1) {
    return { nextPlayerIndex: -1, moveToNextStreet: false };
  }

  const playersWhoCanAct = getPlayersWhoCanAct(state);

  // アクション可能なプレイヤーがいない（全員オールインかフォールド）
  // → 次のストリートへ（ボードをランアウト）
  if (playersWhoCanAct.length === 0) {
    return { nextPlayerIndex: -1, moveToNextStreet: true };
  }

  // ベッティングラウンド終了条件:
  // 1. 全員がアクション済み
  // 2. 全員のベット額が揃っている（またはオールイン）
  const allActed = playersWhoCanAct.every(p => p.hasActed);
  const allBetsEqual = playersWhoCanAct.every(p => p.currentBet === state.currentBet || p.isAllIn);

  if (allActed && allBetsEqual) {
    return { nextPlayerIndex: -1, moveToNextStreet: true };
  }

  // 次のアクション待ちプレイヤーを探す
  let index = (state.currentPlayerIndex + 1) % 6;
  for (let i = 0; i < 6; i++) {
    const p = state.players[index];
    // アクションが必要なプレイヤー: フォールドしておらず、オールインでもなく、
    // まだアクションしていないか、ベット額が足りていない
    if (!p.folded && !p.isAllIn && (!p.hasActed || p.currentBet < state.currentBet)) {
      return { nextPlayerIndex: index, moveToNextStreet: false };
    }
    index = (index + 1) % 6;
  }

  // 全員アクション完了 → 次のストリートへ
  return { nextPlayerIndex: -1, moveToNextStreet: true };
}

/**
 * 次のストリート（フロップ/ターン/リバー/ショーダウン）へ進む
 */
function moveToNextStreet(state: GameState): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;

  // ストリート間でベット状態をリセット
  for (const p of newState.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }
  newState.currentBet = 0;
  newState.minRaise = newState.bigBlind;  // 最小レイズをBBにリセット
  newState.lastFullRaiseBet = 0;

  const activePlayers = getActivePlayers(newState);
  if (activePlayers.length === 1) {
    // 1人だけなら勝者決定
    return determineWinner(newState);
  }

  // === コミュニティカードを配る ===
  switch (newState.currentStreet) {
    case 'preflop': {
      // フロップ: 3枚のコミュニティカード
      newState.currentStreet = 'flop';
      const { cards, remainingDeck } = dealCards(newState.deck, 3);
      newState.communityCards = cards;
      newState.deck = remainingDeck;
      break;
    }
    case 'flop': {
      // ターン: 4枚目のコミュニティカード
      newState.currentStreet = 'turn';
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
      break;
    }
    case 'turn': {
      // リバー: 5枚目のコミュニティカード
      newState.currentStreet = 'river';
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
      break;
    }
    case 'river': {
      // ショーダウン: ベッティング終了、勝者決定へ
      newState.currentStreet = 'showdown';
      return determineWinner(newState);
    }
  }

  // === ポストフロップのアクション開始位置 ===
  // SB（ディーラーの次）から時計回りで最初のアクティブプレイヤー
  const sbIndex = (newState.dealerPosition + 1) % 6;
  let firstActorIndex = -1;
  for (let i = 0; i < 6; i++) {
    const idx = (sbIndex + i) % 6;
    if (!newState.players[idx].folded && !newState.players[idx].isAllIn) {
      firstActorIndex = idx;
      break;
    }
  }

  // アクション可能なプレイヤーが1人以下ならベッティング不要 → ランアウト
  const canActPlayers = activePlayers.filter(p => !p.isAllIn);
  if (canActPlayers.length <= 1) {
    return runOutBoard(newState);
  }

  newState.currentPlayerIndex = firstActorIndex;
  return newState;
}

/**
 * ボードをランアウトする（残りのコミュニティカードを全て配る）
 * 全員オールインの場合に使用
 */
function runOutBoard(state: GameState): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;

  // コミュニティカードが5枚になるまで配る
  while (newState.communityCards.length < 5 && newState.deck.length > 0) {
    const { cards, remainingDeck } = dealCards(newState.deck, 1);
    newState.communityCards.push(...cards);
    newState.deck = remainingDeck;
  }

  newState.currentStreet = 'showdown';
  return determineWinner(newState);
}

/**
 * プレイヤーの投入額からサイドポットを計算する
 * 各プレイヤーのtotalBetThisRoundを元に、オールインレベルごとにポットを分割する
 */
export function calculateSidePots(players: Player[]): { amount: number; eligiblePlayers: number[] }[] {
  // フォールドしていないプレイヤーのユニークな投入額レベルを取得（昇順）
  const nonFoldedLevels = [...new Set(
    players.filter(p => !p.folded).map(p => p.totalBetThisRound)
  )].sort((a, b) => a - b);

  const sidePots: { amount: number; eligiblePlayers: number[] }[] = [];
  let prevLevel = 0;

  for (const level of nonFoldedLevels) {
    if (level <= prevLevel) continue;

    let potAmount = 0;
    const eligiblePlayers: number[] = [];

    for (const player of players) {
      // このレベル区間に対するプレイヤーの貢献額
      const contribution = Math.min(player.totalBetThisRound, level) - Math.min(player.totalBetThisRound, prevLevel);
      potAmount += contribution;

      // フォールドしておらず、このレベル以上投入しているプレイヤーが対象
      if (!player.folded && player.totalBetThisRound >= level) {
        eligiblePlayers.push(player.id);
      }
    }

    if (potAmount > 0) {
      sidePots.push({ amount: potAmount, eligiblePlayers });
    }

    prevLevel = level;
  }

  return sidePots;
}

/**
 * 勝者を決定し、ポットを分配する
 * サイドポットを考慮して、各ポットごとに勝者を決定する
 */
export function determineWinner(state: GameState): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  newState.isHandComplete = true;
  newState.currentStreet = 'showdown';

  const activePlayers = getActivePlayers(newState);

  // アクティブプレイヤーがいない場合（異常ケース）
  if (activePlayers.length === 0) {
    console.error('determineWinner: No active players found');
    newState.winners = [];
    return newState;
  }

  // 1人だけ残っている場合 → その人が無条件で勝者
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    winner.chips += newState.pot;
    newState.winners = [{ playerId: winner.id, amount: newState.pot, handName: '' }];
    return newState;
  }

  // コミュニティカードが5枚揃っていない場合はランアウト
  if (newState.communityCards.length < 5) {
    while (newState.communityCards.length < 5 && newState.deck.length > 0) {
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
    }
  }

  // === サイドポット計算 ===
  const allPots = calculateSidePots(newState.players);

  // 相手がいないポット（eligible 1人）は未コール分として返却
  const contestedPots = allPots.filter(p => p.eligiblePlayers.length >= 2);
  const uncontestedPots = allPots.filter(p => p.eligiblePlayers.length === 1);
  for (const pot of uncontestedPots) {
    const player = newState.players.find(p => p.id === pot.eligiblePlayers[0])!;
    player.chips += pot.amount;
    newState.pot -= pot.amount;
  }
  newState.sidePots = contestedPots;

  // === PLOハンド評価 ===
  // PLOルール: ホールカードから必ず2枚、コミュニティカードから必ず3枚使用
  const playerHandMap = new Map<number, ReturnType<typeof evaluatePLOHand>>();
  for (const player of activePlayers) {
    playerHandMap.set(player.id, evaluatePLOHand(player.holeCards, newState.communityCards));
  }

  // === 各サイドポットの勝者を決定 ===
  const winnerAmounts = new Map<number, { amount: number; handName: string }>();

  for (const pot of contestedPots) {
    // このポットの対象プレイヤーのハンドを取得
    const eligibleHands = pot.eligiblePlayers
      .filter(id => playerHandMap.has(id))
      .map(id => ({ playerId: id, hand: playerHandMap.get(id)! }));

    if (eligibleHands.length === 0) continue;

    // ハンドの強さでソート（降順）
    eligibleHands.sort((a, b) => compareHands(b.hand, a.hand));

    // 同点チェック（タイの場合は複数人が勝者）
    const potWinners = [eligibleHands[0]];
    for (let i = 1; i < eligibleHands.length; i++) {
      if (compareHands(eligibleHands[i].hand, eligibleHands[0].hand) === 0) {
        potWinners.push(eligibleHands[i]);
      } else {
        break;
      }
    }

    // ポットを分配（均等分配、端数は最初の勝者に付与）
    const winAmount = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount % potWinners.length;

    for (let i = 0; i < potWinners.length; i++) {
      const amount = winAmount + (i === 0 ? remainder : 0);
      const existing = winnerAmounts.get(potWinners[i].playerId);
      if (existing) {
        existing.amount += amount;
      } else {
        winnerAmounts.set(potWinners[i].playerId, {
          amount,
          handName: potWinners[i].hand.name,
        });
      }
    }
  }

  // === チップ付与 & winners配列構築 ===
  newState.winners = [];
  for (const [playerId, { amount, handName }] of winnerAmounts) {
    const player = newState.players.find(p => p.id === playerId)!;
    player.chips += amount;
    newState.winners.push({ playerId, amount, handName });
  }

  return newState;
}

/**
 * ポジションを回転する（次のハンドの準備）
 * ディーラーボタンを1つ進め、全プレイヤーのポジション名を更新
 */
export function rotatePositions(state: GameState): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  newState.dealerPosition = (newState.dealerPosition + 1) % 6;

  // ディーラー位置を基準にポジション名を再計算
  for (let i = 0; i < 6; i++) {
    const posIndex = (i - newState.dealerPosition + 6) % 6;
    newState.players[i].position = POSITIONS[posIndex];
  }

  return newState;
}
