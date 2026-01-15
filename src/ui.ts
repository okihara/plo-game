import { GameState, Card, Player, Action } from './types';
import { getValidActions } from './gameEngine';

const SUIT_SYMBOLS: Record<string, string> = {
  h: '♥',
  d: '♦',
  c: '♣',
  s: '♠'
};

const SUIT_NAMES: Record<string, string> = {
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
  s: 'spades'
};

export function renderCard(card: Card, large: boolean = false): string {
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const suitName = SUIT_NAMES[card.suit];
  const sizeClass = large ? 'large' : '';

  return `
    <div class="card ${suitName} ${sizeClass}">
      <span class="rank">${card.rank}</span>
      <span class="suit">${suitSymbol}</span>
    </div>
  `;
}

export function renderFaceDownCard(large: boolean = false): string {
  const sizeClass = large ? 'large' : '';
  return `<div class="card face-down ${sizeClass}"></div>`;
}

export function renderCommunityCards(cards: Card[]): string {
  const cardElements = cards.map(c => renderCard(c, true)).join('');
  // 5枚まで空のスロットを表示
  const emptySlots = 5 - cards.length;
  const emptyElements = Array(emptySlots).fill('<div class="card face-down large" style="opacity:0.3"></div>').join('');

  return `
    <div class="community-cards">
      ${cardElements}${emptyElements}
    </div>
  `;
}

export function renderPlayer(
  player: Player,
  positionIndex: number,
  isCurrentPlayer: boolean,
  isWinner: boolean,
  lastAction: { action: Action; amount: number } | null,
  showCards: boolean,
  isDealing: boolean = false
): string {
  const avatarClass = [
    'player-avatar',
    isCurrentPlayer ? 'active' : '',
    player.folded ? 'folded' : '',
    isWinner ? 'winner' : ''
  ].filter(Boolean).join(' ');

  const emoji = player.isHuman ? '👤' : '🤖';

  const dealerButton = player.position === 'BTN'
    ? '<div class="dealer-button">D</div>'
    : '';

  const positionBadge = `<span class="position-badge">${player.position}</span>`;

  const betDisplay = player.currentBet > 0
    ? `<div class="player-bet">${formatChips(player.currentBet)}</div>`
    : '';

  const lastActionDisplay = lastAction && !player.folded
    ? `<div class="last-action ${lastAction.action}">${formatAction(lastAction)}</div>`
    : '';

  // 人間プレイヤーのカードは別の場所に表示するので、ここでは他プレイヤーのみ
  let holeCardsHtml = '';
  if (!player.isHuman && player.holeCards.length > 0) {
    const dealingClass = isDealing ? 'dealing' : '';
    if (showCards && !player.folded) {
      holeCardsHtml = `
        <div class="hole-cards ${dealingClass}">
          ${player.holeCards.map(c => renderCard(c)).join('')}
        </div>
      `;
    } else if (!player.folded) {
      holeCardsHtml = `
        <div class="hole-cards hidden ${dealingClass}">
          ${Array(4).fill(renderFaceDownCard()).join('')}
        </div>
      `;
    }
  }

  return `
    <div class="player-position pos-${positionIndex}">
      <div class="${avatarClass}">
        ${emoji}
        ${positionBadge}
      </div>
      <div class="player-info">
        <div class="player-name">${player.name}</div>
        <div class="player-chips">${formatChips(player.chips)}</div>
      </div>
      ${holeCardsHtml}
      ${betDisplay}
      ${lastActionDisplay}
      ${dealerButton}
    </div>
  `;
}

export function renderMyCards(cards: Card[], isDealing: boolean = false): string {
  if (cards.length === 0) return '';

  const dealingClass = isDealing ? 'dealing' : '';
  return `
    <div class="my-cards ${dealingClass}">
      ${cards.map(c => renderCard(c, true)).join('')}
    </div>
  `;
}

export function renderActionPanel(
  state: GameState,
  _onAction: (action: Action, amount: number) => void
): string {
  const humanPlayer = state.players.find(p => p.isHuman)!;
  const isMyTurn = state.players[state.currentPlayerIndex]?.isHuman && !state.isHandComplete;
  const validActions = isMyTurn ? getValidActions(state, state.currentPlayerIndex) : [];

  const toCall = state.currentBet - humanPlayer.currentBet;
  const canRaise = validActions.some(a => a.action === 'raise' || a.action === 'bet');
  const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');

  const minRaise = raiseAction?.minAmount || state.bigBlind;
  const maxRaise = raiseAction?.maxAmount || humanPlayer.chips;

  return `
    <div class="action-panel">
      <div class="action-info">
        <span class="current-bet-info">
          ベット: <span>${formatChips(state.currentBet)}</span>
          ${toCall > 0 ? ` | コール: <span>${formatChips(toCall)}</span>` : ''}
        </span>
      </div>
      <div class="action-buttons">
        <button class="action-btn fold" ${!isMyTurn ? 'disabled' : ''} data-action="fold">
          フォールド
        </button>
        <button class="action-btn ${toCall === 0 ? 'check' : 'call'}" ${!isMyTurn ? 'disabled' : ''} data-action="${toCall === 0 ? 'check' : 'call'}">
          ${toCall === 0 ? 'チェック' : `コール ${formatChips(toCall)}`}
        </button>
        <button class="action-btn ${state.currentBet === 0 ? 'bet' : 'raise'}" ${!canRaise || !isMyTurn ? 'disabled' : ''} data-action="${state.currentBet === 0 ? 'bet' : 'raise'}">
          ${state.currentBet === 0 ? 'ベット' : 'レイズ'}
        </button>
        <button class="action-btn allin" ${!isMyTurn ? 'disabled' : ''} data-action="allin">
          オールイン
        </button>
      </div>
      <div class="bet-slider-container ${!canRaise || !isMyTurn ? 'disabled' : ''}">
        <input type="range" class="bet-slider" min="${minRaise}" max="${maxRaise}" value="${minRaise}" step="${state.bigBlind}" ${!canRaise || !isMyTurn ? 'disabled' : ''}>
        <span class="bet-amount-display">${formatChips(minRaise)}</span>
      </div>
      <div class="preset-bets ${!canRaise || !isMyTurn ? 'disabled' : ''}">
        <button class="preset-btn" data-preset="0.33" ${!canRaise || !isMyTurn ? 'disabled' : ''}>1/3</button>
        <button class="preset-btn" data-preset="0.5" ${!canRaise || !isMyTurn ? 'disabled' : ''}>1/2</button>
        <button class="preset-btn" data-preset="0.75" ${!canRaise || !isMyTurn ? 'disabled' : ''}>3/4</button>
        <button class="preset-btn" data-preset="1" ${!canRaise || !isMyTurn ? 'disabled' : ''}>ポット</button>
      </div>
    </div>
  `;
}

export function renderResultOverlay(state: GameState): string {
  if (!state.isHandComplete) {
    return '<div class="result-overlay hidden"></div>';
  }

  const humanPlayer = state.players.find(p => p.isHuman)!;
  const humanWon = state.winners.some(w => w.playerId === humanPlayer.id);
  const winnerInfo = state.winners[0];

  let title = '';
  let details = '';
  let amount = '';

  if (humanWon) {
    const myWinAmount = state.winners.find(w => w.playerId === humanPlayer.id)!.amount;
    title = 'YOU WIN!';
    details = winnerInfo.handName ? `${winnerInfo.handName}` : '';
    amount = `+${formatChips(myWinAmount)}`;
  } else {
    const winner = state.players.find(p => p.id === winnerInfo.playerId)!;
    title = 'YOU LOSE';
    details = `${winner.name}の勝利${winnerInfo.handName ? ` - ${winnerInfo.handName}` : ''}`;
    amount = '';
  }

  return `
    <div class="result-overlay">
      <div class="result-content">
        <div class="result-title ${humanWon ? 'win' : 'lose'}">${title}</div>
        <div class="result-details">${details}</div>
        ${amount ? `<div class="result-amount">${amount}</div>` : ''}
        <button class="next-hand-btn">次のハンド</button>
      </div>
    </div>
  `;
}

export function renderThinkingIndicator(playerName: string, visible: boolean): string {
  return `
    <div class="thinking-indicator ${visible ? '' : 'hidden'}">
      <span>${playerName}が考え中</span>
      <div class="thinking-dots">
        <div class="thinking-dot"></div>
        <div class="thinking-dot"></div>
        <div class="thinking-dot"></div>
      </div>
    </div>
  `;
}

export function renderWaitingMessage(visible: boolean): string {
  return `<div class="waiting-message ${visible ? '' : 'hidden'}">あなたの番を待っています...</div>`;
}

export function renderTableTransition(visible: boolean): string {
  return `
    <div class="table-transition-overlay ${visible ? '' : 'hidden'}">
      <div class="table-transition-content">
        <span>テーブル移動中...</span>
      </div>
    </div>
  `;
}

function formatChips(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  }
  return amount.toString();
}

function formatAction(lastAction: { action: Action; amount: number }): string {
  switch (lastAction.action) {
    case 'fold': return 'FOLD';
    case 'check': return 'CHECK';
    case 'call': return `CALL ${formatChips(lastAction.amount)}`;
    case 'bet': return `BET ${formatChips(lastAction.amount)}`;
    case 'raise': return `RAISE ${formatChips(lastAction.amount)}`;
    case 'allin': return 'ALL-IN';
    default: return '';
  }
}

export function formatPot(pot: number): string {
  return formatChips(pot);
}

// カード配布アニメーション用のポジション情報
interface DealPosition {
  x: number;
  y: number;
  rotate: number;
}

// プレイヤーポジションごとの配布先座標（テーブル中央からの相対位置）
function getPlayerDealPosition(positionIndex: number, cardIndex: number): DealPosition {
  // 各ポジションの基準座標（テーブル中央からの相対px）
  const positions: Record<number, { x: number; y: number }> = {
    0: { x: 0, y: 180 },      // 人間プレイヤー - 下
    1: { x: -120, y: 100 },   // SB - 左下
    2: { x: -130, y: -20 },   // BB - 左
    3: { x: 0, y: -120 },     // UTG - 上
    4: { x: 130, y: -20 },    // HJ - 右
    5: { x: 120, y: 100 },    // CO - 右下
  };

  const basePos = positions[positionIndex];
  // 4枚のカードを少しずつずらして配置
  const offsetX = (cardIndex - 1.5) * 15;
  const rotate = (Math.random() - 0.5) * 10;

  return {
    x: basePos.x + offsetX,
    y: basePos.y,
    rotate
  };
}

export function renderDealOverlay(): string {
  return '<div class="deal-overlay" id="deal-overlay"></div>';
}

export async function playDealAnimation(playerCount: number, humanPositionIndex: number): Promise<void> {
  const overlay = document.getElementById('deal-overlay');
  if (!overlay) return;

  // テーブル中央の座標を取得
  const table = document.querySelector('.poker-table');
  if (!table) return;

  const tableRect = table.getBoundingClientRect();
  const centerX = tableRect.left + tableRect.width / 2;
  const centerY = tableRect.top + tableRect.height / 2;

  // ディーラーの位置（BTNの次のSBから配布開始）
  const dealOrder: number[] = [];
  for (let i = 0; i < playerCount; i++) {
    dealOrder.push((humanPositionIndex + 1 + i) % playerCount);
  }

  const cards: HTMLElement[] = [];
  const CARDS_PER_PLAYER = 4;
  const DEAL_DELAY = 80; // カード間の遅延（ms）

  // 各プレイヤーに1枚ずつ配る（4周）
  for (let round = 0; round < CARDS_PER_PLAYER; round++) {
    for (let playerIdx = 0; playerIdx < playerCount; playerIdx++) {
      const posIndex = dealOrder[playerIdx];
      const dealPos = getPlayerDealPosition(posIndex, round);

      const card = document.createElement('div');
      card.className = 'dealing-card';
      card.style.left = `${centerX - 20}px`;
      card.style.top = `${centerY - 28}px`;
      card.style.setProperty('--deal-x', `${dealPos.x}px`);
      card.style.setProperty('--deal-y', `${dealPos.y}px`);
      card.style.setProperty('--deal-rotate', `${dealPos.rotate}deg`);

      overlay.appendChild(card);
      cards.push(card);

      // アニメーション開始
      await new Promise(resolve => setTimeout(resolve, 10));
      card.classList.add('animate');

      await new Promise(resolve => setTimeout(resolve, DEAL_DELAY));
    }
  }

  // 少し待ってからフェードアウト
  await new Promise(resolve => setTimeout(resolve, 300));

  // カードをフェードアウト
  cards.forEach(card => {
    card.classList.remove('animate');
    card.classList.add('fade-out');
  });

  await new Promise(resolve => setTimeout(resolve, 300));

  // オーバーレイをクリア
  overlay.innerHTML = '';
}
