// ハンドスタッツの純粋な計算ロジック（DB依存なし）

export interface ActionEntry {
  seatIndex: number;
  odId: string;
  action: string;
  amount: number;
  street?: string;
}

/** 6-max テーブルでBBのシート位置を返す */
function getBBSeat(dealerPosition: number, activeSeatPositions: number[]): number {
  const sorted = [...activeSeatPositions].sort((a, b) => a - b);
  const dealerIdx = sorted.indexOf(dealerPosition);
  if (dealerIdx === -1) return -1;
  if (sorted.length === 2) return sorted[(dealerIdx + 1) % sorted.length];
  return sorted[(dealerIdx + 2) % sorted.length];
}

export interface StatsIncrement {
  handsPlayed: number;
  winCount: number;
  totalProfit: number;
  totalAllInEVProfit: number;
  detailedHands: number;
  vpipCount: number;
  pfrCount: number;
  threeBetCount: number;
  threeBetOpportunity: number;
  foldTo3BetCount: number;
  faced3BetCount: number;
  fourBetCount: number;
  fourBetOpportunity: number;
  aggressiveActions: number;
  totalPostflopActions: number;
  cbetCount: number;
  cbetOpportunity: number;
  foldToCbetCount: number;
  facedCbetCount: number;
  sawFlopCount: number;
  wtsdCount: number;
  wsdCount: number;
}

export function emptyIncrement(): StatsIncrement {
  return {
    handsPlayed: 0, winCount: 0, totalProfit: 0, totalAllInEVProfit: 0, detailedHands: 0,
    vpipCount: 0, pfrCount: 0,
    threeBetCount: 0, threeBetOpportunity: 0, foldTo3BetCount: 0, faced3BetCount: 0,
    fourBetCount: 0, fourBetOpportunity: 0,
    aggressiveActions: 0, totalPostflopActions: 0,
    cbetCount: 0, cbetOpportunity: 0, foldToCbetCount: 0, facedCbetCount: 0,
    sawFlopCount: 0, wtsdCount: 0, wsdCount: 0,
  };
}

/** 1ハンド分のスタッツ増分を計算する */
export function computeIncrementForPlayer(
  userId: string,
  userSeat: number,
  profit: number,
  actions: ActionEntry[],
  dealerPosition: number,
  winnerOdIds: string[],
  activeSeatPositions: number[],
  communityCardsCount: number,
  players: { odId: string; seatPosition: number; finalHand: string | null }[],
  allInEVProfit?: number | null,
): StatsIncrement {
  const inc = emptyIncrement();

  inc.handsPlayed = 1;
  inc.totalProfit = profit;
  // allInEVProfit が null（非オールインハンド）の場合は実利益を使用
  inc.totalAllInEVProfit = allInEVProfit ?? profit;
  if (winnerOdIds.includes(userId)) inc.winCount = 1;

  const hasStreetInfo = actions.length > 0 && actions[0].street !== undefined;
  if (!hasStreetInfo || dealerPosition < 0) return inc;

  inc.detailedHands = 1;
  const bbSeat = getBBSeat(dealerPosition, activeSeatPositions);

  const preflopActions = actions.filter(a => a.street === 'preflop');
  const flopActions = actions.filter(a => a.street === 'flop');
  const turnActions = actions.filter(a => a.street === 'turn');
  const riverActions = actions.filter(a => a.street === 'river');
  const postflopActions = [...flopActions, ...turnActions, ...riverActions];

  const userPreflopActions = preflopActions.filter(a => a.odId === userId);
  const foldedPreflop = userPreflopActions.some(a => a.action === 'fold');

  // VPIP
  const hasVoluntaryAction = userPreflopActions.some(a =>
    a.action === 'call' || a.action === 'raise' || a.action === 'bet' || a.action === 'allin'
  );
  if (hasVoluntaryAction) {
    if (userSeat === bbSeat) {
      const hasRaiseOrCall = userPreflopActions.some(a =>
        a.action === 'raise' || a.action === 'call' || a.action === 'allin'
      );
      if (hasRaiseOrCall) inc.vpipCount = 1;
    } else {
      inc.vpipCount = 1;
    }
  }

  // PFR
  if (userPreflopActions.some(a => a.action === 'raise' || a.action === 'bet')) {
    inc.pfrCount = 1;
  }

  // 3Bet / Fold to 3Bet
  {
    let raiseCount = 0;
    let userOpenRaised = false;
    let userResponded = false;
    let localFaced3Bet = 0;

    for (const action of preflopActions) {
      const isRaise = action.action === 'raise' || action.action === 'bet';

      if (isRaise) {
        raiseCount++;
        if (raiseCount === 1 && action.odId === userId) {
          userOpenRaised = true;
        }
        if (raiseCount === 2) {
          if (action.odId === userId) {
            inc.threeBetCount = 1;
            inc.threeBetOpportunity = 1;
            userResponded = true;
          }
          if (userOpenRaised) {
            localFaced3Bet = 1;
            inc.faced3BetCount = 1;
          }
          break;
        }
      }

      if (raiseCount === 1 && !isRaise && action.odId === userId && !userResponded) {
        inc.threeBetOpportunity = 1;
        userResponded = true;
      }
    }

    if (userOpenRaised && localFaced3Bet > 0) {
      let found3Bet = false;
      for (const action of preflopActions) {
        if ((action.action === 'raise' || action.action === 'bet') && action.odId !== userId) {
          if (found3Bet) break;
          let priorRaises = 0;
          for (const a2 of preflopActions) {
            if (a2 === action) break;
            if (a2.action === 'raise' || a2.action === 'bet') priorRaises++;
          }
          if (priorRaises === 1) found3Bet = true;
        }
        if (found3Bet && action.odId === userId) {
          if (action.action === 'fold') inc.foldTo3BetCount = 1;
          break;
        }
      }
    }
  }

  // 4Bet
  {
    let raiseCount = 0;
    let threeBettorId: string | null = null;

    for (const action of preflopActions) {
      const isRaise = action.action === 'raise' || action.action === 'bet';

      if (isRaise) {
        raiseCount++;
        if (raiseCount === 2) {
          threeBettorId = action.odId;
        }
        if (raiseCount === 3) {
          if (action.odId === userId) {
            inc.fourBetCount = 1;
            inc.fourBetOpportunity = 1;
          }
          break;
        }
      }

      // User acts after 3-bet (not the 3-bettor) → 4-bet opportunity
      if (raiseCount === 2 && !isRaise && action.odId === userId && threeBettorId !== userId) {
        inc.fourBetOpportunity = 1;
        break;
      }
    }
  }

  // Saw Flop / WTSD / W$SD
  const handReachedFlop = flopActions.length > 0 || communityCardsCount >= 3;
  const sawFlop = handReachedFlop && !foldedPreflop;

  if (sawFlop) {
    inc.sawFlopCount = 1;

    const foldedPostflop = postflopActions.some(a =>
      a.odId === userId && a.action === 'fold'
    );
    const handReachedShowdown = players.some(p => p.finalHand != null);

    if (!foldedPostflop && handReachedShowdown) {
      inc.wtsdCount = 1;
      if (winnerOdIds.includes(userId)) inc.wsdCount = 1;
    }
  }

  // AFq
  const userPostflopActions = postflopActions.filter(a => a.odId === userId);
  for (const action of userPostflopActions) {
    if (action.action === 'bet' || action.action === 'raise' || action.action === 'allin') {
      inc.aggressiveActions++;
      inc.totalPostflopActions++;
    } else if (action.action === 'call' || action.action === 'fold') {
      inc.totalPostflopActions++;
    }
  }

  // CBet / Fold to CBet
  if (handReachedFlop && flopActions.length > 0) {
    let lastPreflopAggressor: string | null = null;
    for (const action of preflopActions) {
      if (action.action === 'raise' || action.action === 'bet') {
        lastPreflopAggressor = action.odId;
      }
    }

    if (lastPreflopAggressor) {
      const firstFlopBet = flopActions.find(a =>
        a.action === 'bet' || a.action === 'raise'
      );

      if (lastPreflopAggressor === userId) {
        inc.cbetOpportunity = 1;
        if (firstFlopBet && firstFlopBet.odId === userId) inc.cbetCount = 1;
      }

      if (lastPreflopAggressor !== userId && firstFlopBet && firstFlopBet.odId === lastPreflopAggressor) {
        let afterCbet = false;
        for (const action of flopActions) {
          if (action === firstFlopBet) { afterCbet = true; continue; }
          if (afterCbet && action.odId === userId) {
            inc.facedCbetCount = 1;
            if (action.action === 'fold') inc.foldToCbetCount = 1;
            break;
          }
        }
      }
    }
  }

  return inc;
}

/** 卓内 HUD 用のフロップ指標（DB には保存しない）。各 *Opportunity が分母 */
export interface FlopHudIncrement {
  donkCount: number;
  donkOpportunity: number;
  checkRaiseCount: number;
  checkRaiseOpportunity: number;
  bmcbCount: number;
  bmcbOpportunity: number;
}

/**
 * フロップのドンクベット / チェックレイズ / BMCB（Bet vs Missed CBet）を判定する。
 * ベット判定は CBet と同じく bet / raise のみ（allin は含めない）。
 */
export function computeFlopHudIncrement(userId: string, actions: ActionEntry[]): FlopHudIncrement {
  const inc: FlopHudIncrement = {
    donkCount: 0, donkOpportunity: 0,
    checkRaiseCount: 0, checkRaiseOpportunity: 0,
    bmcbCount: 0, bmcbOpportunity: 0,
  };
  const isBet = (a: ActionEntry) => a.action === 'bet' || a.action === 'raise';

  const flopActions = actions.filter(a => a.street === 'flop');
  const userIdx = flopActions.findIndex(a => a.odId === userId);
  if (userIdx === -1) return inc;
  const userFirst = flopActions[userIdx];
  const betBeforeUser = flopActions.slice(0, userIdx).some(isBet);

  let pfa: string | null = null;
  for (const a of actions) {
    if (a.street === 'preflop' && isBet(a)) pfa = a.odId;
  }

  if (pfa && pfa !== userId && !betBeforeUser) {
    const pfaIdx = flopActions.findIndex(a => a.odId === pfa);
    // ドンク: PFA より先に、誰もベットしていない状態で行動する
    if (pfaIdx > userIdx) {
      inc.donkOpportunity = 1;
      if (isBet(userFirst)) inc.donkCount = 1;
    }
    // BMCB: PFA がチェックした後、誰もベットしていない状態で行動する
    if (pfaIdx !== -1 && pfaIdx < userIdx && flopActions[pfaIdx].action === 'check') {
      inc.bmcbOpportunity = 1;
      if (isBet(userFirst)) inc.bmcbCount = 1;
    }
  }

  // チェックレイズ: チェックした後に他者のベットを受け、再び行動する
  if (userFirst.action === 'check') {
    const rest = flopActions.slice(userIdx + 1);
    const nextUserIdx = rest.findIndex(a => a.odId === userId);
    if (nextUserIdx !== -1 && rest.slice(0, nextUserIdx).some(isBet)) {
      inc.checkRaiseOpportunity = 1;
      if (isBet(rest[nextUserIdx])) inc.checkRaiseCount = 1;
    }
  }

  return inc;
}
