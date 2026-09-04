/**
 * カード配布アニメーションのタイミング。
 * 席順にずらして配る演出は PlayerCards（他プレイヤー）・MyCards（自分）・
 * 配布中フラグ（useOnlineGameState）の3箇所で足並みを揃える必要があるため、
 * 計算をここに集約する。
 */

/** カード1枚ごとの配布間隔 */
export const DEAL_CARD_STEP_MS = 40;

/** index.css の .animate-deal-card（deal-card 0.4s）の長さ */
export const DEAL_CARD_DURATION_MS = 400;

/**
 * dealOrder 番目のプレイヤーの cardIndex 枚目を配り始めるまでの待ち時間。
 * SBから時計回りに1枚ずつ、全員に配ってから次の1枚へ進む。
 */
export function dealCardDelayMs(cardIndex: number, dealOrder: number, seatCount: number): number {
  return (cardIndex * seatCount + dealOrder) * DEAL_CARD_STEP_MS;
}

/**
 * 最後の1枚が配り終わるまでの総時間。配布中フラグを落とすタイミングに使う。
 * これより短いと、最後に配られるカードの飛んでくる演出が途中で打ち切られる。
 */
export function dealAnimationTotalMs(seatCount: number, cardsPerPlayer: number): number {
  const lastCard = Math.max(cardsPerPlayer - 1, 0);
  const lastSeat = Math.max(seatCount - 1, 0);
  return dealCardDelayMs(lastCard, lastSeat, seatCount) + DEAL_CARD_DURATION_MS;
}
