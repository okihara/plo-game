import { GameState, Player, Position, Action } from './types.js';
import { createDeck, shuffleDeck, dealCards } from './deck.js';
import { evaluatePLOHand, compareHands } from './handEvaluator.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

export function createInitialGameState(playerChips: number = 600): GameState {
  const players: Player[] = [];

  // プレイヤー作成 (人間は常にBTN位置からスタート)
  const names = ['You', 'Miko', 'Kento', 'Luna', 'Hiro', 'Tomoka'];
  for (let i = 0; i < 6; i++) {
    players.push({
      id: i,
      name: names[i],
      position: POSITIONS[i],
      chips: playerChips,
      holeCards: [],
      currentBet: 0,
      totalBetThisRound: 0,
      folded: false,
      isAllIn: false,
      isHuman: i === 0,
      hasActed: false,
    });
  }

  return {
    players,
    deck: [],
    communityCards: [],
    pot: 0,
    sidePots: [],
    currentStreet: 'preflop',
    dealerPosition: 0,
    currentPlayerIndex: 0,
    currentBet: 0,
    minRaise: 0,
    smallBlind: 1,
    bigBlind: 3,
    lastRaiserIndex: -1,
    handHistory: [],
    isHandComplete: false,
    winners: [],
  };
}

export function startNewHand(state: GameState): GameState {
  const newState = { ...state };

  // リセット
  newState.communityCards = [];
  newState.pot = 0;
  newState.sidePots = [];
  newState.currentStreet = 'preflop';
  newState.currentBet = newState.bigBlind;
  newState.minRaise = newState.bigBlind;
  newState.handHistory = [];
  newState.isHandComplete = false;
  newState.winners = [];
  newState.lastRaiserIndex = -1;

  // プレイヤーをリセット
  newState.players = newState.players.map(p => ({
    ...p,
    holeCards: [],
    currentBet: 0,
    totalBetThisRound: 0,
    folded: false,
    isAllIn: false,
    hasActed: false,
  }));

  // デッキをシャッフル
  newState.deck = shuffleDeck(createDeck());

  // ディーラーを移動
  newState.dealerPosition = (newState.dealerPosition + 1) % 6;

  // ポジションを更新
  for (let i = 0; i < 6; i++) {
    const posIndex = (i - newState.dealerPosition + 6) % 6;
    newState.players[i].position = POSITIONS[posIndex];
  }

  // アクティブプレイヤー数を確認
  const activeCount = getActivePlayerCount(newState);

  let sbIndex: number;
  let bbIndex: number;

  if (activeCount === 2) {
    // Heads-up（2人プレイ）の特殊ルール: BTN = SB
    // ディーラー位置から最初のアクティブプレイヤーがBTN兼SB
    sbIndex = getNextPlayerWithChips(newState, newState.dealerPosition - 1);
    if (sbIndex === -1) sbIndex = newState.dealerPosition;
    bbIndex = getNextPlayerWithChips(newState, sbIndex);
  } else {
    // 通常ルール（3人以上）: ディーラーの次がSB、その次がBB
    sbIndex = getNextPlayerWithChips(newState, newState.dealerPosition);
    bbIndex = getNextPlayerWithChips(newState, sbIndex);
  }

  // ブラインドを投稿
  newState.players[sbIndex].currentBet = Math.min(newState.smallBlind, newState.players[sbIndex].chips);
  newState.players[sbIndex].totalBetThisRound = newState.players[sbIndex].currentBet;
  newState.players[sbIndex].chips -= newState.players[sbIndex].currentBet;
  if (newState.players[sbIndex].chips === 0) newState.players[sbIndex].isAllIn = true;

  newState.players[bbIndex].currentBet = Math.min(newState.bigBlind, newState.players[bbIndex].chips);
  newState.players[bbIndex].totalBetThisRound = newState.players[bbIndex].currentBet;
  newState.players[bbIndex].chips -= newState.players[bbIndex].currentBet;
  if (newState.players[bbIndex].chips === 0) newState.players[bbIndex].isAllIn = true;

  newState.pot = newState.players[sbIndex].currentBet + newState.players[bbIndex].currentBet;

  // 4枚ずつ配る (PLO)
  for (let i = 0; i < 6; i++) {
    const { cards, remainingDeck } = dealCards(newState.deck, 4);
    newState.players[i].holeCards = cards;
    newState.deck = remainingDeck;
  }

  // アクション開始位置を決定
  if (activeCount === 2) {
    // Heads-upではプリフロップはSB（BTN）から先にアクション
    newState.currentPlayerIndex = sbIndex;
  } else {
    // 通常ルール: UTG（BBの次）からアクション開始
    newState.currentPlayerIndex = getNextActivePlayer(newState, bbIndex);
  }
  newState.lastRaiserIndex = bbIndex;

  // アクション可能なプレイヤーがいない場合（全員オールイン）はショーダウンへ
  if (newState.currentPlayerIndex === -1) {
    return runOutBoard(newState);
  }

  return newState;
}

function getNextActivePlayer(state: GameState, fromIndex: number): number {
  let index = (fromIndex + 1) % 6;
  let count = 0;
  while (count < 6) {
    if (!state.players[index].folded && !state.players[index].isAllIn && state.players[index].chips > 0) {
      return index;
    }
    index = (index + 1) % 6;
    count++;
  }
  return -1;
}

// ゲームに参加可能なプレイヤー数（folded でなく、チップを持っている）
function getActivePlayerCount(state: GameState): number {
  return state.players.filter(p => !p.folded && p.chips > 0).length;
}

// ディーラーから見て次のアクティブプレイヤー（チップ > 0、foldedでない）
function getNextPlayerWithChips(state: GameState, fromIndex: number): number {
  let index = (fromIndex + 1) % 6;
  let count = 0;
  while (count < 6) {
    if (!state.players[index].folded && state.players[index].chips > 0) {
      return index;
    }
    index = (index + 1) % 6;
    count++;
  }
  return -1;
}

export function getActivePlayers(state: GameState): Player[] {
  return state.players.filter(p => !p.folded);
}

export function getPlayersWhoCanAct(state: GameState): Player[] {
  return state.players.filter(p => !p.folded && !p.isAllIn);
}

export function getValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  const player = state.players[playerIndex];
  const actions: { action: Action; minAmount: number; maxAmount: number }[] = [];

  if (player.folded || player.isAllIn) return actions;

  const toCall = state.currentBet - player.currentBet;

  // フォールドは常に可能
  actions.push({ action: 'fold', minAmount: 0, maxAmount: 0 });

  if (toCall === 0) {
    // チェック可能
    actions.push({ action: 'check', minAmount: 0, maxAmount: 0 });
  } else {
    // コール
    const callAmount = Math.min(toCall, player.chips);
    actions.push({ action: 'call', minAmount: callAmount, maxAmount: callAmount });
  }

  // ポットリミット計算: コール額 + (現在のポット + コール額)
  const potAfterCall = state.pot + toCall;
  const potLimitRaise = toCall + potAfterCall; // コール額 + コール後のポット
  const maxByPotLimit = Math.min(potLimitRaise, player.chips);

  // ベット/レイズ
  if (player.chips > toCall) {
    const minRaiseTotal = state.currentBet + state.minRaise;
    const minRaiseAmount = minRaiseTotal - player.currentBet;

    if (state.currentBet === 0) {
      // ベット（ポットリミット = 現在のポット）
      const potLimitBet = Math.min(state.pot, player.chips);
      const minBet = Math.min(state.bigBlind, player.chips);
      actions.push({ action: 'bet', minAmount: minBet, maxAmount: potLimitBet });
    } else {
      // レイズ
      if (player.chips >= minRaiseAmount) {
        actions.push({ action: 'raise', minAmount: minRaiseAmount, maxAmount: maxByPotLimit });
      }
    }
  }

  // オールイン（チップがポットリミット以下の場合のみ）
  if (player.chips > 0) {
    const maxBetOrRaise = state.currentBet === 0 ? state.pot : potLimitRaise;
    if (player.chips <= maxBetOrRaise) {
      actions.push({ action: 'allin', minAmount: player.chips, maxAmount: player.chips });
    }
  }

  return actions;
}

export function applyAction(state: GameState, playerIndex: number, action: Action, amount: number = 0): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  const player = newState.players[playerIndex];

  player.hasActed = true;

  switch (action) {
    case 'fold':
      player.folded = true;
      break;

    case 'check':
      break;

    case 'call': {
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
      const raiseBy = amount - (newState.currentBet - player.currentBet);
      if (raiseBy > newState.minRaise) {
        newState.minRaise = raiseBy;
      }
      player.chips -= amount;
      player.currentBet += amount;
      player.totalBetThisRound += amount;
      newState.pot += amount;
      newState.currentBet = player.currentBet;
      newState.lastRaiserIndex = playerIndex;
      if (player.chips === 0) player.isAllIn = true;

      // レイズがあったら他のプレイヤーのhasActedをリセット
      for (const p of newState.players) {
        if (p.id !== player.id && !p.folded && !p.isAllIn) {
          p.hasActed = false;
        }
      }
      break;
    }

    case 'allin': {
      const allInAmount = player.chips;
      if (player.currentBet + allInAmount > newState.currentBet) {
        const raiseBy = (player.currentBet + allInAmount) - newState.currentBet;
        if (raiseBy >= newState.minRaise) {
          newState.minRaise = raiseBy;
          newState.lastRaiserIndex = playerIndex;
          // レイズがあったら他のプレイヤーのhasActedをリセット
          for (const p of newState.players) {
            if (p.id !== player.id && !p.folded && !p.isAllIn) {
              p.hasActed = false;
            }
          }
        }
        newState.currentBet = player.currentBet + allInAmount;
      }
      player.currentBet += allInAmount;
      player.totalBetThisRound += allInAmount;
      newState.pot += allInAmount;
      player.chips = 0;
      player.isAllIn = true;
      break;
    }
  }

  newState.handHistory.push({ playerId: playerIndex, action, amount });

  // 次のプレイヤーを決定
  const nextResult = determineNextAction(newState);
  if (nextResult.moveToNextStreet) {
    return moveToNextStreet(newState);
  } else if (nextResult.nextPlayerIndex !== -1) {
    newState.currentPlayerIndex = nextResult.nextPlayerIndex;
  } else {
    // ハンド終了
    return determineWinner(newState);
  }

  return newState;
}

function determineNextAction(state: GameState): { nextPlayerIndex: number; moveToNextStreet: boolean } {
  const activePlayers = getActivePlayers(state);

  // 1人しか残っていない
  if (activePlayers.length === 1) {
    return { nextPlayerIndex: -1, moveToNextStreet: false };
  }

  const playersWhoCanAct = getPlayersWhoCanAct(state);

  // アクション可能なプレイヤーがいない（全員オールインかフォールド）
  if (playersWhoCanAct.length === 0) {
    return { nextPlayerIndex: -1, moveToNextStreet: true };
  }

  // 全員がアクション済みで、ベット額が揃っている
  const allActed = playersWhoCanAct.every(p => p.hasActed);
  const allBetsEqual = playersWhoCanAct.every(p => p.currentBet === state.currentBet || p.isAllIn);

  if (allActed && allBetsEqual) {
    return { nextPlayerIndex: -1, moveToNextStreet: true };
  }

  // 次のプレイヤーを探す
  let index = (state.currentPlayerIndex + 1) % 6;
  for (let i = 0; i < 6; i++) {
    const p = state.players[index];
    if (!p.folded && !p.isAllIn && (!p.hasActed || p.currentBet < state.currentBet)) {
      return { nextPlayerIndex: index, moveToNextStreet: false };
    }
    index = (index + 1) % 6;
  }

  return { nextPlayerIndex: -1, moveToNextStreet: true };
}

function moveToNextStreet(state: GameState): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;

  // ベットをリセット
  for (const p of newState.players) {
    p.currentBet = 0;
    p.hasActed = false;
  }
  newState.currentBet = 0;
  newState.minRaise = newState.bigBlind;

  const activePlayers = getActivePlayers(newState);
  if (activePlayers.length === 1) {
    return determineWinner(newState);
  }

  switch (newState.currentStreet) {
    case 'preflop': {
      newState.currentStreet = 'flop';
      const { cards, remainingDeck } = dealCards(newState.deck, 3);
      newState.communityCards = cards;
      newState.deck = remainingDeck;
      break;
    }
    case 'flop': {
      newState.currentStreet = 'turn';
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
      break;
    }
    case 'turn': {
      newState.currentStreet = 'river';
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
      break;
    }
    case 'river': {
      newState.currentStreet = 'showdown';
      return determineWinner(newState);
    }
  }

  // ポストフロップはSBからアクション（またはSBより後で最初のアクティブプレイヤー）
  const sbIndex = (newState.dealerPosition + 1) % 6;
  let firstActorIndex = -1;
  for (let i = 0; i < 6; i++) {
    const idx = (sbIndex + i) % 6;
    if (!newState.players[idx].folded && !newState.players[idx].isAllIn) {
      firstActorIndex = idx;
      break;
    }
  }

  if (firstActorIndex === -1) {
    // 全員オールインなのでショーダウンへ
    return runOutBoard(newState);
  }

  newState.currentPlayerIndex = firstActorIndex;
  return newState;
}

function runOutBoard(state: GameState): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;

  while (newState.communityCards.length < 5) {
    const { cards, remainingDeck } = dealCards(newState.deck, 1);
    newState.communityCards.push(...cards);
    newState.deck = remainingDeck;
  }

  newState.currentStreet = 'showdown';
  return determineWinner(newState);
}

function determineWinner(state: GameState): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  newState.isHandComplete = true;
  newState.currentStreet = 'showdown';

  const activePlayers = getActivePlayers(newState);

  // 1人だけ残っている場合
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    winner.chips += newState.pot;
    newState.winners = [{ playerId: winner.id, amount: newState.pot, handName: '' }];
    return newState;
  }

  // コミュニティカードが5枚揃っていない場合はランアウト
  if (newState.communityCards.length < 5) {
    while (newState.communityCards.length < 5) {
      const { cards, remainingDeck } = dealCards(newState.deck, 1);
      newState.communityCards.push(...cards);
      newState.deck = remainingDeck;
    }
  }

  // ハンドを評価
  const playerHands = activePlayers.map(p => ({
    player: p,
    hand: evaluatePLOHand(p.holeCards, newState.communityCards)
  }));

  // ベストハンドを見つける
  playerHands.sort((a, b) => compareHands(b.hand, a.hand));

  // 同点チェック
  const winners: typeof playerHands = [playerHands[0]];
  for (let i = 1; i < playerHands.length; i++) {
    if (compareHands(playerHands[i].hand, playerHands[0].hand) === 0) {
      winners.push(playerHands[i]);
    } else {
      break;
    }
  }

  // ポットを分配
  const winAmount = Math.floor(newState.pot / winners.length);
  const remainder = newState.pot % winners.length;

  newState.winners = winners.map((w, i) => {
    const amount = winAmount + (i === 0 ? remainder : 0);
    const playerInState = newState.players.find(p => p.id === w.player.id)!;
    playerInState.chips += amount;
    return { playerId: w.player.id, amount, handName: w.hand.name };
  });

  return newState;
}

export function rotatePositions(state: GameState): GameState {
  const newState = JSON.parse(JSON.stringify(state)) as GameState;
  newState.dealerPosition = (newState.dealerPosition + 1) % 6;

  for (let i = 0; i < 6; i++) {
    const posIndex = (i - newState.dealerPosition + 6) % 6;
    newState.players[i].position = POSITIONS[posIndex];
  }

  return newState;
}
