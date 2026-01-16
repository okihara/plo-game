export const styles = `
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  font-family: 'Roboto', sans-serif;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%);
  color: #fff;
  touch-action: manipulation;
}

#app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.game-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 100vw;
  max-height: 100vh;
  overflow: hidden;
  position: relative;
}

/* テーブル */
.table-area {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  min-height: 0;
}

.poker-table {
  width: 85%;
  max-width: 320px;
  aspect-ratio: 0.7;
  background: radial-gradient(ellipse at center, #1e5631 0%, #145028 50%, #0d3d1c 100%);
  border-radius: 45%;
  border: 8px solid #2a1810;
  box-shadow:
    0 0 0 4px #4a3020,
    0 0 30px rgba(0,0,0,0.5),
    inset 0 0 60px rgba(0,0,0,0.3);
  position: relative;
}

/* ポット表示 */
.pot-display {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.7);
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: bold;
  color: #ffd700;
  text-shadow: 0 0 10px rgba(255,215,0,0.5);
  z-index: 10;
}

/* コミュニティカード */
.community-cards {
  position: absolute;
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 3px;
  z-index: 5;
}

/* プレイヤーポジション */
.player-position {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: all 0.3s ease;
}

.player-position.pos-0 { bottom: -12%; left: 50%; transform: translateX(-50%); } /* 人間プレイヤー - 下 */
.player-position.pos-1 { bottom: 10%; left: -15%; }   /* SB - 左下 */
.player-position.pos-2 { top: 25%; left: -15%; }    /* BB - 左 */
.player-position.pos-3 { top: -8%; left: 50%; transform: translateX(-50%); }    /* UTG - 上 */
.player-position.pos-4 { top: 25%; right: -15%; }   /* HJ - 右 */
.player-position.pos-5 { bottom: 10%; right: -15%; }   /* CO - 右下 */

.player-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3a3a5c 0%, #2a2a4c 100%);
  border: 3px solid #444;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  position: relative;
  overflow: hidden;
}

.player-avatar.active {
  border-color: #ffd700;
  box-shadow: 0 0 15px rgba(255,215,0,0.6);
  animation: pulse 1.5s infinite;
}

.player-avatar.folded {
  opacity: 0.4;
  filter: grayscale(1);
}

.player-avatar.winner {
  border-color: #00ff00;
  box-shadow: 0 0 20px rgba(0,255,0,0.6);
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 15px rgba(255,215,0,0.6); }
  50% { box-shadow: 0 0 25px rgba(255,215,0,0.9); }
}

.player-info {
  background: rgba(0,0,0,0.8);
  padding: 4px 10px;
  border-radius: 10px;
  margin-top: 4px;
  text-align: center;
  min-width: 70px;
}

.player-name {
  font-size: 11px;
  color: #aaa;
  white-space: nowrap;
}

.player-chips {
  font-size: 12px;
  font-weight: bold;
  color: #fff;
}

.player-bet {
  position: absolute;
  background: rgba(0,0,0,0.7);
  color: #ffd700;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: bold;
  white-space: nowrap;
}

.player-position.pos-0 .player-bet { top: -30px; }
.player-position.pos-1 .player-bet { top: 0; right: -50px; }
.player-position.pos-2 .player-bet { top: 20px; right: -60px; }
.player-position.pos-3 .player-bet { bottom: -25px; }
.player-position.pos-4 .player-bet { top: 20px; left: -60px; }
.player-position.pos-5 .player-bet { top: 0; left: -50px; }

.position-badge {
  position: absolute;
  top: -8px;
  right: -8px;
  background: #ff6b35;
  color: #fff;
  font-size: 9px;
  font-weight: bold;
  padding: 2px 5px;
  border-radius: 8px;
  min-width: 24px;
  text-align: center;
}

/* ディーラーボタン */
.dealer-button {
  position: absolute;
  width: 28px;
  height: 28px;
  background: linear-gradient(145deg, #fff9e6 0%, #ffd700 50%, #cc9900 100%);
  border: 2px solid #aa8800;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 900;
  color: #333;
  box-shadow:
    0 2px 4px rgba(0,0,0,0.4),
    inset 0 1px 2px rgba(255,255,255,0.6);
  z-index: 25;
}

.player-position.pos-0 .dealer-button { top: -40px; left: 80px; }
.player-position.pos-1 .dealer-button { top: -5px; right: -35px; }
.player-position.pos-2 .dealer-button { top: -5px; right: -35px; }
.player-position.pos-3 .dealer-button { bottom: -35px; right: 60px; }
.player-position.pos-4 .dealer-button { top: -5px; left: -35px; }
.player-position.pos-5 .dealer-button { top: -5px; left: -35px; }

/* ホールカード表示 */
.hole-cards {
  display: flex;
  gap: 1px;
  margin-top: 4px;
}

.hole-cards .card {
  width: 21px;
  height: 29px;
  font-size: 8px;
  border-radius: 3px;
}

.hole-cards .card .suit {
  font-size: 9px;
}

.hole-cards.hidden .card {
  background: linear-gradient(135deg, #1a3a8a 0%, #0a2060 100%);
}

.hole-cards.cards-folded {
  visibility: hidden;
}

/* カード */
.card {
  width: 32px;
  height: 44px;
  background: linear-gradient(135deg, #fff 0%, #f0f0f0 100%);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  position: relative;
}

.card.large {
  width: 40px;
  height: 56px;
  font-size: 14px;
}

.card .rank {
  line-height: 1;
}

.card .suit {
  font-size: 14px;
  line-height: 1;
}

.card.large .suit {
  font-size: 18px;
}

.card.hearts, .card.diamonds {
  color: #e63946;
}

.card.clubs, .card.spades {
  color: #1d3557;
}

.card.face-down {
  background: linear-gradient(135deg, #1a3a8a 0%, #0a2060 100%);
  border: 1px solid #4a6ab0;
}

.card.face-down::after {
  content: '';
  position: absolute;
  width: 70%;
  height: 70%;
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 3px,
    rgba(255,255,255,0.1) 3px,
    rgba(255,255,255,0.1) 6px
  );
  border-radius: 2px;
}

/* 人間プレイヤーの手札（大きく表示） */
.my-cards {
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 10px 0;
  background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.3) 100%);
}

.my-cards .card {
  width: 52px;
  height: 72px;
  font-size: 18px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.4);
}

.my-cards .card .suit {
  font-size: 24px;
}

/* アクションパネル */
.action-panel {
  background: linear-gradient(180deg, #1a1a2e 0%, #0f0f1e 100%);
  padding: 12px;
  border-top: 1px solid #333;
  min-height: 130px;
}

.action-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding: 0 5px;
}

.current-bet-info {
  font-size: 13px;
  color: #aaa;
}

.current-bet-info span {
  color: #ffd700;
  font-weight: bold;
}

.action-buttons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}

.action-btn {
  padding: 14px 8px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.action-btn:active {
  transform: scale(0.95);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-btn.fold {
  background: linear-gradient(180deg, #666 0%, #444 100%);
  color: #fff;
}

.action-btn.check {
  background: linear-gradient(180deg, #2196F3 0%, #1976D2 100%);
  color: #fff;
}

.action-btn.call {
  background: linear-gradient(180deg, #4CAF50 0%, #388E3C 100%);
  color: #fff;
}

.action-btn.raise, .action-btn.bet {
  background: linear-gradient(180deg, #FF9800 0%, #F57C00 100%);
  color: #fff;
}

.action-btn.allin {
  background: linear-gradient(180deg, #e63946 0%, #b52a37 100%);
  color: #fff;
}

/* ベットスライダー */
.bet-slider-container {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 5px;
}

.bet-slider-container.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.bet-slider {
  flex: 1;
  -webkit-appearance: none;
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(90deg, #333 0%, #555 100%);
  outline: none;
}

.bet-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffd700 0%, #ffaa00 100%);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}

.bet-amount-display {
  min-width: 70px;
  text-align: center;
  font-size: 16px;
  font-weight: bold;
  color: #ffd700;
}

.preset-bets {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  padding: 0 5px;
}

.preset-bets.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.preset-btn {
  flex: 1;
  padding: 8px 4px;
  border: 1px solid #444;
  border-radius: 6px;
  background: rgba(255,255,255,0.1);
  color: #fff;
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-btn:active {
  background: rgba(255,215,0,0.3);
  border-color: #ffd700;
}

/* 結果表示 */
.result-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 40px;
  z-index: 100;
  animation: fadeIn 0.3s ease;
}

.result-overlay.hidden {
  display: none;
}

/* テーブル移動オーバーレイ */
.table-transition-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}

.table-transition-overlay.hidden {
  display: none;
}

.table-transition-content {
  color: #fff;
  font-size: 24px;
  font-weight: bold;
  text-align: center;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.result-content {
  text-align: center;
  padding: 20px;
  background: rgba(0,0,0,0.7);
  border-radius: 20px;
  margin: 0 20px;
}

.result-title {
  font-size: 28px;
  font-weight: 900;
  margin-bottom: 15px;
  text-transform: uppercase;
}

.result-title.win {
  color: #00ff00;
  text-shadow: 0 0 20px rgba(0,255,0,0.5);
}

.result-title.lose {
  color: #ff4444;
  text-shadow: 0 0 20px rgba(255,68,68,0.5);
}

.result-details {
  font-size: 16px;
  color: #aaa;
  margin-bottom: 20px;
}

.result-amount {
  font-size: 24px;
  font-weight: bold;
  color: #ffd700;
  margin-bottom: 30px;
}

.next-hand-btn {
  padding: 18px 60px;
  font-size: 18px;
  font-weight: bold;
  background: linear-gradient(180deg, #4CAF50 0%, #388E3C 100%);
  color: #fff;
  border: none;
  border-radius: 30px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 1px;
  box-shadow: 0 4px 15px rgba(76,175,80,0.4);
  min-width: 200px;
}

.next-hand-btn:active {
  transform: scale(0.95);
}

/* CPU思考中表示 */
.thinking-indicator {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.8);
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 12px;
  color: #ffd700;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 50;
}

.thinking-indicator.hidden {
  display: none;
}

.thinking-dots {
  display: flex;
  gap: 4px;
}

.thinking-dot {
  width: 6px;
  height: 6px;
  background: #ffd700;
  border-radius: 50%;
  animation: thinking 1.4s infinite ease-in-out both;
}

.thinking-dot:nth-child(1) { animation-delay: -0.32s; }
.thinking-dot:nth-child(2) { animation-delay: -0.16s; }
.thinking-dot:nth-child(3) { animation-delay: 0s; }

@keyframes thinking {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

/* 最後のアクション表示 - プレイヤーアイコンの上に表示 */
.last-action {
  position: absolute;
  background: rgba(0,0,0,0.9);
  color: #fff;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: bold;
  text-transform: uppercase;
  white-space: nowrap;
  z-index: 15;
  left: 50%;
  transform: translateX(-50%);
  top: -30px;
  animation: actionPopAndFade 1s ease forwards;
}

@keyframes actionPopAndFade {
  0% {
    transform: translateX(-50%) scale(0.5);
    opacity: 0;
  }
  20% {
    transform: translateX(-50%) scale(1);
    opacity: 1;
  }
  80% {
    transform: translateX(-50%) scale(1);
    opacity: 1;
  }
  100% {
    transform: translateX(-50%) scale(0.8);
    opacity: 0;
  }
}

.last-action.fold { background: #666; }
.last-action.check { background: #2196F3; }
.last-action.call { background: #4CAF50; }
.last-action.raise, .last-action.bet { background: #FF9800; }
.last-action.allin { background: #e63946; }

/* 待機メッセージ */
.waiting-message {
  position: absolute;
  bottom: 150px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.8);
  padding: 10px 20px;
  border-radius: 20px;
  color: #aaa;
  font-size: 13px;
  z-index: 20;
}

.waiting-message.hidden {
  display: none;
}

/* カード配布アニメーション */
.deal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 200;
}

.dealing-card {
  position: absolute;
  width: 40px;
  height: 56px;
  background: linear-gradient(135deg, #1a3a8a 0%, #0a2060 100%);
  border: 1px solid #4a6ab0;
  border-radius: 4px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.4);
  opacity: 0;
  z-index: 201;
}

.dealing-card::after {
  content: '';
  position: absolute;
  width: 70%;
  height: 70%;
  top: 15%;
  left: 15%;
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 3px,
    rgba(255,255,255,0.1) 3px,
    rgba(255,255,255,0.1) 6px
  );
  border-radius: 2px;
}

.dealing-card.animate {
  animation: dealCard 0.4s ease-out forwards;
}

@keyframes dealCard {
  0% {
    opacity: 1;
    transform: translate(0, 0) rotate(0deg) scale(0.5);
  }
  100% {
    opacity: 1;
    transform: translate(var(--deal-x), var(--deal-y)) rotate(var(--deal-rotate)) scale(1);
  }
}

.dealing-card.fade-out {
  animation: dealCardFadeOut 0.3s ease-out forwards;
}

@keyframes dealCardFadeOut {
  0% {
    opacity: 1;
    transform: translate(var(--deal-x), var(--deal-y)) rotate(var(--deal-rotate)) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(var(--deal-x), var(--deal-y)) rotate(var(--deal-rotate)) scale(0.8);
  }
}

/* 配布中はホールカードを非表示 */
.my-cards.dealing {
  opacity: 0;
}

.my-cards.fade-in {
  animation: cardsAppear 0.5s ease-out forwards;
}

@keyframes cardsAppear {
  0% { opacity: 0; transform: scale(0.8); }
  100% { opacity: 1; transform: scale(1); }
}

.hole-cards.dealing {
  opacity: 0;
}

.hole-cards.fade-in {
  animation: cardsAppear 0.3s ease-out forwards;
}

/* コミュニティカードのめくりアニメーション */
.community-cards .card {
  transform-style: preserve-3d;
  perspective: 1000px;
}

.community-cards .card.new-card {
  animation: flipCard 0.6s ease forwards;
  animation-delay: 0.3s;
}

/* 裏面を最初に表示 */
.community-cards .card.new-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #1a3a8a 0%, #0a2060 100%);
  border-radius: 4px;
  backface-visibility: hidden;
  animation: hideBack 0.6s ease forwards;
  animation-delay: 0.3s;
}

.community-cards .card.new-card .rank,
.community-cards .card.new-card .suit {
  animation: showFace 0.6s ease forwards;
  animation-delay: 0.3s;
  opacity: 0;
}

@keyframes flipCard {
  0% {
    transform: rotateY(0deg);
  }
  100% {
    transform: rotateY(180deg);
  }
}

@keyframes hideBack {
  0%, 45% {
    opacity: 1;
  }
  55%, 100% {
    opacity: 0;
  }
}

@keyframes showFace {
  0%, 45% {
    opacity: 0;
  }
  55%, 100% {
    opacity: 1;
  }
}

`;
