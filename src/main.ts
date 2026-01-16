import { styles } from './styles';
import { GameState, Action } from './types';
import { createInitialGameState, startNewHand, applyAction, getValidActions } from './gameEngine';
import { getCPUAction } from './cpuAI';
import {
  renderCommunityCards,
  renderPlayer,
  renderMyCards,
  renderActionPanel,
  renderResultOverlay,
  renderThinkingIndicator,
  renderTableTransition,
  renderDealOverlay,
  playDealAnimation,
  formatPot,
  resetCommunityCardCount
} from './ui';

// スタイルを注入
const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// ゲーム状態
let gameState: GameState;
let lastActions: Map<number, { action: Action; amount: number; timestamp: number }> = new Map();
let isProcessingCPU = false;
let isTableTransition = false;
let isDealingCards = false;
let newCommunityCardsCount = 0;
let actionMarkerTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

// 初期化
async function init() {
  gameState = createInitialGameState(10000);
  gameState = startNewHand(gameState);
  lastActions.clear();
  isDealingCards = true;
  newCommunityCardsCount = 0;
  resetCommunityCardCount();
  render();

  // カード配布アニメーション（人間プレイヤーは常にインデックス0）
  await playDealAnimation(6, 0);

  isDealingCards = false;
  render();
  scheduleNextCPUAction();
}

// レンダリング
function render() {
  const app = document.getElementById('app')!;
  const humanPlayer = gameState.players.find(p => p.isHuman)!;
  const isShowdown = gameState.currentStreet === 'showdown' || gameState.isHandComplete;
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const isCPUTurn = currentPlayer && !currentPlayer.isHuman && !gameState.isHandComplete;

  // プレイヤーの表示順序を計算（人間プレイヤーが下に来るように）
  // 人間プレイヤーは常にid:0なので、配列インデックス0に固定
  const humanIndex = 0;
  const orderedPlayers = [];
  for (let i = 0; i < 6; i++) {
    const idx = (humanIndex + i) % 6;
    orderedPlayers.push({ player: gameState.players[idx], playerIdx: idx, posIndex: i });
  }

  const playersHtml = orderedPlayers.map(({ player, playerIdx, posIndex }) => {
    const isCurrentPlayer = gameState.currentPlayerIndex === playerIdx && !gameState.isHandComplete;
    const isWinner = gameState.winners.some(w => w.playerId === player.id);
    const lastAction = lastActions.get(player.id) || null;
    return renderPlayer(player, posIndex, isCurrentPlayer, isWinner, lastAction, isShowdown, isDealingCards);
  }).join('');

  app.innerHTML = `
    <div class="game-container">
      <div class="table-area">
        ${renderThinkingIndicator(currentPlayer?.name || '', isCPUTurn && isProcessingCPU)}
        <div class="poker-table">
          <div class="pot-display">POT: ${formatPot(gameState.pot)}</div>
          ${renderCommunityCards(gameState.communityCards, newCommunityCardsCount)}
          ${playersHtml}
        </div>
      </div>
      ${renderMyCards(humanPlayer.holeCards, isDealingCards)}
      ${renderActionPanel(gameState, handleAction)}
      ${renderResultOverlay(gameState)}
      ${renderTableTransition(isTableTransition)}
      ${renderDealOverlay()}
    </div>
  `;

  attachEventListeners();
}

// イベントリスナー
function attachEventListeners() {
  // アクションボタン
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      if (target.disabled) return;

      const action = target.dataset.action as Action;
      const slider = document.querySelector('.bet-slider') as HTMLInputElement;
      let amount = 0;

      if (action === 'call') {
        const humanPlayer = gameState.players.find(p => p.isHuman)!;
        amount = Math.min(gameState.currentBet - humanPlayer.currentBet, humanPlayer.chips);
      } else if (action === 'bet' || action === 'raise') {
        amount = parseInt(slider?.value || '0', 10);
      } else if (action === 'allin') {
        const humanPlayer = gameState.players.find(p => p.isHuman)!;
        amount = humanPlayer.chips;
      }

      handleAction(action, amount);
    });
  });

  // スライダー
  const slider = document.querySelector('.bet-slider') as HTMLInputElement;
  const amountDisplay = document.querySelector('.bet-amount-display');
  if (slider && amountDisplay) {
    slider.addEventListener('input', () => {
      const value = parseInt(slider.value, 10);
      amountDisplay.textContent = formatAmount(value);
    });
  }

  // プリセットボタン
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const preset = parseFloat(target.dataset.preset || '0');
      const potSize = gameState.pot;
      const humanPlayer = gameState.players.find(p => p.isHuman)!;
      const toCall = gameState.currentBet - humanPlayer.currentBet;
      const raiseAmount = Math.round(potSize * preset) + toCall;

      const slider = document.querySelector('.bet-slider') as HTMLInputElement;
      const amountDisplay = document.querySelector('.bet-amount-display');
      if (slider) {
        const min = parseInt(slider.min, 10);
        const max = parseInt(slider.max, 10);
        const clampedValue = Math.max(min, Math.min(max, raiseAmount));
        slider.value = clampedValue.toString();
        if (amountDisplay) {
          amountDisplay.textContent = formatAmount(clampedValue);
        }
      }
    });
  });

  // 次のハンドボタン
  const nextHandBtn = document.querySelector('.next-hand-btn');
  if (nextHandBtn) {
    nextHandBtn.addEventListener('click', startNextHand);
  }
}

function formatAmount(amount: number): string {
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  }
  return amount.toString();
}

// アクションマーカーを1秒後に消すタイマー
function scheduleActionMarkerClear(playerId: number) {
  // 既存のタイマーをクリア
  const existingTimer = actionMarkerTimers.get(playerId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    lastActions.delete(playerId);
    actionMarkerTimers.delete(playerId);
    render();
  }, 1000);

  actionMarkerTimers.set(playerId, timer);
}

function clearAllActionMarkerTimers() {
  actionMarkerTimers.forEach(timer => clearTimeout(timer));
  actionMarkerTimers.clear();
}

// 次のハンドを開始
async function startNextHand() {
  // チップが0以下のプレイヤーをリセット
  for (const player of gameState.players) {
    if (player.chips <= 0) {
      player.chips = 10000; // リバイ
    }
  }
  gameState = startNewHand(gameState);
  lastActions.clear();
  clearAllActionMarkerTimers();
  isDealingCards = true;
  newCommunityCardsCount = 0;
  resetCommunityCardCount();
  render();

  // カード配布アニメーション（人間プレイヤーは常にインデックス0）
  await playDealAnimation(6, 0);

  isDealingCards = false;
  render();
  scheduleNextCPUAction();
}

// アクションハンドラー
function handleAction(action: Action, amount: number) {
  if (gameState.isHandComplete) return;

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  if (!currentPlayer.isHuman) return;

  // 有効なアクションかチェック
  const validActions = getValidActions(gameState, gameState.currentPlayerIndex);
  const isValid = validActions.some(a => a.action === action);
  if (!isValid) return;

  const previousStreet = gameState.currentStreet;
  const prevCardCount = gameState.communityCards.length;
  const playerId = currentPlayer.id;
  lastActions.set(playerId, { action, amount, timestamp: Date.now() });
  gameState = applyAction(gameState, gameState.currentPlayerIndex, action, amount);

  // ストリートが変わったらアクションマーカーをクリアしてカードアニメーション
  if (gameState.currentStreet !== previousStreet) {
    lastActions.clear();
    clearAllActionMarkerTimers();
    newCommunityCardsCount = gameState.communityCards.length - prevCardCount;
  } else {
    newCommunityCardsCount = 0;
    // 1秒後にアクションマーカーを消すためのタイマー
    scheduleActionMarkerClear(playerId);
  }
  render();

  // 人間プレイヤーがフォールドしたら「テーブル移動中」を表示して次のハンドへ
  if (action === 'fold') {
    isTableTransition = true;
    render();
    setTimeout(() => {
      isTableTransition = false;
      startNextHand();
    }, 1000);
    return;
  }

  if (!gameState.isHandComplete) {
    scheduleNextCPUAction();
  }
}

// CPUアクション
function scheduleNextCPUAction() {
  if (gameState.isHandComplete) return;

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  if (!currentPlayer || currentPlayer.isHuman) return;

  isProcessingCPU = true;
  render();

  // CPUの思考時間をシミュレート
  const thinkTime = 800 + Math.random() * 1200;

  setTimeout(() => {
    if (gameState.isHandComplete) {
      isProcessingCPU = false;
      render();
      return;
    }

    const previousStreet = gameState.currentStreet;
    const prevCardCount = gameState.communityCards.length;
    const playerId = currentPlayer.id;
    const cpuAction = getCPUAction(gameState, gameState.currentPlayerIndex);
    lastActions.set(playerId, { ...cpuAction, timestamp: Date.now() });
    gameState = applyAction(gameState, gameState.currentPlayerIndex, cpuAction.action, cpuAction.amount);

    // ストリートが変わったらアクションマーカーをクリアしてカードアニメーション
    if (gameState.currentStreet !== previousStreet) {
      lastActions.clear();
      clearAllActionMarkerTimers();
      newCommunityCardsCount = gameState.communityCards.length - prevCardCount;
    } else {
      newCommunityCardsCount = 0;
      // 1秒後にアクションマーカーを消すためのタイマー
      scheduleActionMarkerClear(playerId);
    }

    isProcessingCPU = false;
    render();

    // 次のCPUアクションをスケジュール
    if (!gameState.isHandComplete) {
      setTimeout(() => scheduleNextCPUAction(), 300);
    }
  }, thinkTime);
}

// ゲーム開始
init();
