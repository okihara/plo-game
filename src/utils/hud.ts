import type { HudRatio, HudStatKey } from '../logic';

/** 詳細表示のラベル（並びは HUD_STAT_KEYS 順） */
export const HUD_STAT_LABELS: Record<HudStatKey, string> = {
  vpip: 'VPIP',
  pfr: 'PFR',
  threeBet: '3Bet',
  donk: 'Donk',
  checkRaise: 'XR',
  bmcb: 'BMCB',
  foldTo3Bet: 'Fold to 3B',
  fourBet: '4Bet',
  foldTo4Bet: 'Fold to 4B',
  cbet: 'CB',
  threeBetCbet: '3Bet CB',
  foldToCbet: 'Fold to CB',
  bbFoldVsOpen: 'BB Fold',
  bb3BetVsOpen: 'BB 3Bet',
  steal: 'Steal',
};

/** 機会がなければ '-'、あれば整数の % */
export function hudPercent(r: HudRatio): string {
  return r.d > 0 ? String(Math.round((r.n / r.d) * 100)) : '-';
}
