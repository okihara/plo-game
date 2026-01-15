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
  showCards: boolean
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
    if (showCards && !player.folded) {
      holeCardsHtml = `
        <div class="hole-cards">
          ${player.holeCards.map(c => renderCard(c)).join('')}
        </div>
      `;
    } else if (!player.folded) {
      holeCardsHtml = `
        <div class="hole-cards hidden">
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

export function renderMyCards(cards: Card[]): string {
  if (cards.length === 0) return '';

  return `
    <div class="my-cards">
      ${cards.map(c => renderCard(c, true)).join('')}
    </div>
  `;
}

export function renderActionPanel(
  state: GameState,
  onAction: (action: Action, amount: number) => void
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
      <div class="bet-slider-container ${!canRaise || !isMyTurn ? 'hidden' : ''}">
        <input type="range" class="bet-slider" min="${minRaise}" max="${maxRaise}" value="${minRaise}" step="${state.bigBlind}">
        <span class="bet-amount-display">${formatChips(minRaise)}</span>
      </div>
      <div class="preset-bets ${!canRaise || !isMyTurn ? 'hidden' : ''}">
        <button class="preset-btn" data-preset="0.33">1/3</button>
        <button class="preset-btn" data-preset="0.5">1/2</button>
        <button class="preset-btn" data-preset="0.75">3/4</button>
        <button class="preset-btn" data-preset="1">ポット</button>
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
