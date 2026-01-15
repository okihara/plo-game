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
  formatPot
} from './ui';

// スタイルを注入
const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// ゲーム状態
let gameState: GameState;
let lastActions: Map<number, { action: Action; amount: number }> = new Map();
let isProcessingCPU = false;

// 初期化
function init() {
  gameState = createInitialGameState(10000);
  gameState = startNewHand(gameState);
  lastActions.clear();
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
  const humanIndex = gameState.players.findIndex(p => p.isHuman);
  const orderedPlayers = [];
  for (let i = 0; i < 6; i++) {
    const idx = (humanIndex + i) % 6;
    orderedPlayers.push({ player: gameState.players[idx], posIndex: i });
  }

  const playersHtml = orderedPlayers.map(({ player, posIndex }) => {
    const isCurrentPlayer = gameState.currentPlayerIndex === player.id && !gameState.isHandComplete;
    const isWinner = gameState.winners.some(w => w.playerId === player.id);
    const lastAction = lastActions.get(player.id) || null;
    return renderPlayer(player, posIndex, isCurrentPlayer, isWinner, lastAction, isShowdown);
  }).join('');

  app.innerHTML = `
    <div class="game-container">
      <div class="table-area">
        ${renderThinkingIndicator(currentPlayer?.name || '', isCPUTurn && isProcessingCPU)}
        <div class="poker-table">
          <div class="pot-display">POT: ${formatPot(gameState.pot)}</div>
          ${renderCommunityCards(gameState.communityCards)}
          ${playersHtml}
        </div>
      </div>
      ${renderMyCards(humanPlayer.holeCards)}
      ${renderActionPanel(gameState, handleAction)}
      ${renderResultOverlay(gameState)}
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

// 次のハンドを開始
function startNextHand() {
  // チップが0以下のプレイヤーをリセット
  for (const player of gameState.players) {
    if (player.chips <= 0) {
      player.chips = 10000; // リバイ
    }
  }
  gameState = startNewHand(gameState);
  lastActions.clear();
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

  lastActions.set(currentPlayer.id, { action, amount });
  gameState = applyAction(gameState, gameState.currentPlayerIndex, action, amount);
  render();

  // 人間プレイヤーがフォールドしたら少し待って次のハンドへ
  if (action === 'fold') {
    setTimeout(() => {
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

    const cpuAction = getCPUAction(gameState, gameState.currentPlayerIndex);
    lastActions.set(currentPlayer.id, cpuAction);
    gameState = applyAction(gameState, gameState.currentPlayerIndex, cpuAction.action, cpuAction.amount);
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
