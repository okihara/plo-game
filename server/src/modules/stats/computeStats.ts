// プレイヤースタッツ計算モジュール

export interface PlayerStats {
  handsPlayed: number;
  winRate: number;      // 勝ちハンド数 / 全ハンド数 (%)
  totalProfit: number;
  vpip: number;         // Voluntarily Put money In Pot (%)
  pfr: number;          // Pre-Flop Raise (%)
  threeBet: number;     // 3-Bet (%)
  afq: number;          // Aggression Frequency (%) - postflop
  cbet: number;         // Continuation Bet (%)
  foldToCbet: number;   // Fold to C-Bet (%)
  foldTo3Bet: number;   // Fold to 3-Bet (%)
  wtsd: number;         // Went To ShowDown (%)
  wsd: number;          // Won $ at ShowDown (%)
}

export interface StoredAction {
  seatIndex: number;
  odId: string;
  odName: string;
  action: string;
  amount: number;
  street?: string;
}

interface HandData {
  id: string;
  actions: StoredAction[];
  dealerPosition: number;
  winners: string[];
  blinds: string;
  communityCards: string[];
  players: { userId: string | null; seatPosition: number; profit: number; finalHand?: string | null }[];
}

/** 6-max テーブルでSBのシート位置を返す */
function getSBSeat(dealerPosition: number, activeSeatPositions: number[]): number {
  const sorted = [...activeSeatPositions].sort((a, b) => a - b);
  const dealerIdx = sorted.indexOf(dealerPosition);
  if (dealerIdx === -1) return -1;

  if (sorted.length === 2) {
    // heads-up: dealer = SB
    return dealerPosition;
  }
  return sorted[(dealerIdx + 1) % sorted.length];
}

/** 6-max テーブルでBBのシート位置を返す */
function getBBSeat(dealerPosition: number, activeSeatPositions: number[]): number {
  const sorted = [...activeSeatPositions].sort((a, b) => a - b);
  const dealerIdx = sorted.indexOf(dealerPosition);
  if (dealerIdx === -1) return -1;

  if (sorted.length === 2) {
    // heads-up: non-dealer = BB
    return sorted[(dealerIdx + 1) % sorted.length];
  }
  return sorted[(dealerIdx + 2) % sorted.length];
}

export function computeStats(handHistories: HandData[], userId: string): PlayerStats {
  let handsPlayed = 0;
  let winCount = 0;
  let totalProfit = 0;

  // Street情報があるハンドのみ詳細スタッツ計算
  let detailedHands = 0;
  let vpipCount = 0;
  let pfrCount = 0;
  let threeBetCount = 0;
  let threeBetOpportunity = 0;
  let foldTo3BetCount = 0;
  let faced3BetCount = 0;

  // Postflop aggression
  let aggressiveActions = 0; // bet + raise
  let totalPostflopActions = 0; // bet + raise + call + fold

  // CBet
  let cbetCount = 0;
  let cbetOpportunity = 0;
  let foldToCbetCount = 0;
  let facedCbetCount = 0;

  // Showdown
  let sawFlopCount = 0;
  let wtsdCount = 0;
  let wsdCount = 0;

  for (const hand of handHistories) {
    const playerEntry = hand.players.find(p => p.userId === userId);
    if (!playerEntry) continue;

    handsPlayed++;
    totalProfit += playerEntry.profit;
    if (hand.winners.includes(userId)) winCount++;

    const actions = hand.actions;
    const hasStreetInfo = actions.length > 0 && actions[0].street !== undefined;

    // ストリート情報なし → 基本スタッツのみ
    if (!hasStreetInfo || hand.dealerPosition < 0) continue;

    detailedHands++;
    const userSeat = playerEntry.seatPosition;
    const activeSeatPositions = hand.players.map(p => p.seatPosition);
    const bbSeat = getBBSeat(hand.dealerPosition, activeSeatPositions);

    // ストリート別にアクション分離
    const preflopActions = actions.filter(a => a.street === 'preflop');
    const flopActions = actions.filter(a => a.street === 'flop');
    const turnActions = actions.filter(a => a.street === 'turn');
    const riverActions = actions.filter(a => a.street === 'river');
    const postflopActions = [...flopActions, ...turnActions, ...riverActions];

    // ユーザーのpreflopアクション
    const userPreflopActions = preflopActions.filter(a => a.odId === userId);
    // ユーザーがpreflopでfoldしたか
    const foldedPreflop = userPreflopActions.some(a => a.action === 'fold');

    // === VPIP ===
    const hasVoluntaryAction = userPreflopActions.some(a =>
      a.action === 'call' || a.action === 'raise' || a.action === 'bet' || a.action === 'allin'
    );
    if (hasVoluntaryAction) {
      // BBがcheckだけでフロップに進んだ場合はVPIPではない
      if (userSeat === bbSeat) {
        const hasRaiseOrCall = userPreflopActions.some(a =>
          a.action === 'raise' || a.action === 'call' || a.action === 'allin'
        );
        // BBの場合、checkのみなら VPIP にカウントしない
        // callは通常BBではopenリンプに対するもの→ VPIPにカウント
        // raise/allinはVPIPにカウント
        if (hasRaiseOrCall) vpipCount++;
      } else {
        vpipCount++;
      }
    }

    // === PFR ===
    const hasRaisedPreflop = userPreflopActions.some(a =>
      a.action === 'raise' || a.action === 'bet'
    );
    if (hasRaisedPreflop) pfrCount++;

    // === 3Bet / Fold to 3Bet ===
    {
      let raiseCount = 0;
      let userOpenRaised = false;
      let userHad3BetOpportunity = false;
      let userResponded = false;

      for (const action of preflopActions) {
        const isRaise = action.action === 'raise' || action.action === 'bet';

        if (isRaise) {
          raiseCount++;

          if (raiseCount === 1 && action.odId === userId) {
            // ユーザーがopen raise
            userOpenRaised = true;
          }

          if (raiseCount === 2) {
            if (action.odId === userId) {
              // ユーザーが3bet
              threeBetCount++;
              threeBetOpportunity++;
              userResponded = true;
            }
            if (userOpenRaised) {
              // ユーザーのopen raiseに対する3bet
              faced3BetCount++;
            }
            break; // 3betまでのみ追跡
          }
        }

        // ユーザーの3bet機会チェック: open raiseの後にユーザーのアクション機会
        if (raiseCount === 1 && !isRaise && action.odId === userId && !userResponded) {
          threeBetOpportunity++;
          userHad3BetOpportunity = true;
          userResponded = true;
          // ユーザーが3betせずにcall/foldした
        }
      }

      // Fold to 3Bet: ユーザーがopen raiseして3betされた場合
      if (userOpenRaised && faced3BetCount > 0) {
        // 3bet後のユーザーのアクションを探す
        let found3Bet = false;
        for (const action of preflopActions) {
          if ((action.action === 'raise' || action.action === 'bet') && action.odId !== userId) {
            if (found3Bet) break; // 4bet以降は無視
            // 最初のraise（open raise）をスキップ
            let priorRaises = 0;
            for (const a2 of preflopActions) {
              if (a2 === action) break;
              if (a2.action === 'raise' || a2.action === 'bet') priorRaises++;
            }
            if (priorRaises === 1) {
              found3Bet = true;
            }
          }
          if (found3Bet && action.odId === userId) {
            if (action.action === 'fold') foldTo3BetCount++;
            break;
          }
        }
      }
    }

    // === Saw Flop / WTSD / W$SD ===
    const handReachedFlop = flopActions.length > 0 || hand.communityCards.length >= 3;
    const sawFlop = handReachedFlop && !foldedPreflop;

    if (sawFlop) {
      sawFlopCount++;

      // WTSDチェック: showdownまで到達したか
      const foldedPostflop = postflopActions.some(a =>
        a.odId === userId && a.action === 'fold'
      );
      const handReachedShowdown = hand.players.some(p => p.finalHand != null);

      if (!foldedPostflop && handReachedShowdown) {
        wtsdCount++;
        if (hand.winners.includes(userId)) {
          wsdCount++;
        }
      }
    }

    // === AFq (Postflop Aggression Frequency) ===
    const userPostflopActions = postflopActions.filter(a => a.odId === userId);
    for (const action of userPostflopActions) {
      if (action.action === 'bet' || action.action === 'raise' || action.action === 'allin') {
        aggressiveActions++;
        totalPostflopActions++;
      } else if (action.action === 'call' || action.action === 'fold') {
        totalPostflopActions++;
      }
      // check は AFq の分母に含めない（標準的な計算方法）
    }

    // === CBet / Fold to CBet ===
    if (handReachedFlop && flopActions.length > 0) {
      // preflop last aggressor を特定
      let lastPreflopAggressor: string | null = null;
      for (const action of preflopActions) {
        if (action.action === 'raise' || action.action === 'bet') {
          lastPreflopAggressor = action.odId;
        }
      }

      if (lastPreflopAggressor) {
        // フロップの最初のbet/raiseを探す
        const firstFlopBet = flopActions.find(a =>
          a.action === 'bet' || a.action === 'raise'
        );

        if (lastPreflopAggressor === userId) {
          // ユーザーがpreflop aggressor
          cbetOpportunity++;
          if (firstFlopBet && firstFlopBet.odId === userId) {
            cbetCount++;
          }
        }

        // Fold to CBet: 相手がCBetした場合
        if (lastPreflopAggressor !== userId && firstFlopBet && firstFlopBet.odId === lastPreflopAggressor) {
          // ユーザーがCBetに直面した
          // CBet後のユーザーのアクションを探す
          let afterCbet = false;
          for (const action of flopActions) {
            if (action === firstFlopBet) {
              afterCbet = true;
              continue;
            }
            if (afterCbet && action.odId === userId) {
              facedCbetCount++;
              if (action.action === 'fold') foldToCbetCount++;
              break;
            }
          }
        }
      }
    }
  }

  const pct = (num: number, denom: number) => denom > 0 ? (num / denom) * 100 : 0;

  return {
    handsPlayed,
    winRate: pct(winCount, handsPlayed),
    totalProfit,
    vpip: pct(vpipCount, detailedHands),
    pfr: pct(pfrCount, detailedHands),
    threeBet: pct(threeBetCount, threeBetOpportunity),
    afq: pct(aggressiveActions, totalPostflopActions),
    cbet: pct(cbetCount, cbetOpportunity),
    foldToCbet: pct(foldToCbetCount, facedCbetCount),
    foldTo3Bet: pct(foldTo3BetCount, faced3BetCount),
    wtsd: pct(wtsdCount, sawFlopCount),
    wsd: pct(wsdCount, wtsdCount),
  };
}
