import type { ClientGameState, OnlinePlayer } from '@plo/shared';
import type { Card, GameState, Player, Position, Street, GameVariant } from '../logic/types';

export const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

export function convertOnlinePlayerToPlayer(
  online: OnlinePlayer | null,
  index: number,
  dealerSeat: number
): Player {
  const fallbackPosition = POSITIONS[(index - dealerSeat + 6) % 6];
  if (!online) {
    return {
      id: index,
      name: `Seat ${index + 1}`,
      chips: 0,
      holeCards: [],
      currentBet: 0,
      totalBetThisRound: 0,
      folded: true,
      isAllIn: false,
      hasActed: true,
      isSittingOut: true,
      position: fallbackPosition,
    };
  }

  return {
    id: index,
    name: online.odName,
    chips: online.chips,
    holeCards: online.cards ?? [],
    currentBet: online.currentBet,
    totalBetThisRound: online.currentBet,
    folded: online.folded,
    isAllIn: online.isAllIn,
    hasActed: online.hasActed,
    isSittingOut: false,
    position: online.position ?? fallbackPosition,
    avatarId: online.avatarId,
    avatarUrl: online.avatarUrl,
    odId: online.odId,
  };
}

export function convertClientStateToGameState(
  clientState: ClientGameState,
  myHoleCards: Card[],
  mySeat: number | null,
  showdownCards: Map<number, Card[]>
): GameState {
  const players = clientState.players.map((p, i) => convertOnlinePlayerToPlayer(p, i, clientState.dealerSeat));

  if (mySeat !== null && players[mySeat]) {
    players[mySeat].holeCards = myHoleCards;
  }

  for (const [seatIndex, cards] of showdownCards) {
    if (players[seatIndex] && seatIndex !== mySeat) {
      players[seatIndex].holeCards = cards;
      players[seatIndex].isShowdown = true;
    }
  }

  return {
    tableId: clientState.tableId,
    players,
    deck: [],
    communityCards: clientState.communityCards,
    pot: clientState.pot,
    sidePots: (clientState.sidePots || []).map(sp => ({
      amount: sp.amount,
      eligiblePlayers: sp.eligiblePlayerSeats,
    })),
    currentStreet: clientState.currentStreet as Street,
    currentBet: clientState.currentBet,
    minRaise: clientState.minRaise,
    dealerPosition: clientState.dealerSeat,
    smallBlind: clientState.smallBlind,
    bigBlind: clientState.bigBlind,
    currentPlayerIndex: clientState.currentPlayerSeat ?? -1,
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: !clientState.isHandInProgress,
    winners: [],
    rake: clientState.rake ?? 0,
    variant: (clientState.variant as GameVariant) ?? 'plo',
    ante: clientState.ante ?? 0,
    bringIn: clientState.bringIn ?? 0,
    betCount: 0,
    maxBetsPerRound: 4,
    validActions: clientState.validActions ?? null,
  };
}
