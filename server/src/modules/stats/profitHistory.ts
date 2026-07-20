// 収支推移グラフ用データの構築・ダウンサンプリング（純関数）

export interface ProfitHistoryRow {
  profit: number;
  finalHand: string | null;
  allInEVProfit: number | null;
}

export interface ProfitHistoryPoint {
  p: number; // 区間の収支（ダウンサンプリング時はバケット合計）
  c: number; // 累積収支
  s: number; // 累積ショーダウン収支
  n: number; // 累積ノンショーダウン収支
  e: number; // 累積EV収支
}

/**
 * ハンドごとの収支から累積グラフ用ポイント列を作る。
 * 数万ハンド級のユーザーでレスポンスが数MBに膨らむため、maxPoints を超える場合は
 * 等間隔バケットの末尾値にダウンサンプリングする（累積値はバケット末尾時点の正確な値）。
 *
 * DB の allInEVProfit はほとんど NULL のため、全行 NULL の場合は
 * スタッツキャッシュ由来の EV 差分 (cacheEvDiff) をハンド位置に比例して補正する。
 */
export function buildProfitHistoryPoints(
  rows: ProfitHistoryRow[],
  cacheEvDiff: number,
  maxPoints: number,
): { points: ProfitHistoryPoint[]; totalHands: number } {
  let cumTotal = 0;
  let cumSD = 0;
  let cumNoSD = 0;
  let cumEV = 0;
  const full: ProfitHistoryPoint[] = rows.map(r => {
    const sd = r.finalHand != null;
    cumTotal += r.profit;
    cumEV += r.allInEVProfit ?? r.profit;
    if (sd) cumSD += r.profit; else cumNoSD += r.profit;
    return { p: r.profit, c: cumTotal, s: cumSD, n: cumNoSD, e: cumEV };
  });

  // allInEVProfit が全てNULLの場合(cumEV === cumTotal)、キャッシュの差分で補正
  if (full.length > 0 && cumEV === cumTotal && cacheEvDiff !== 0) {
    for (let i = 0; i < full.length; i++) {
      full[i].e = Math.round(full[i].c + cacheEvDiff * ((i + 1) / full.length));
    }
  }

  if (full.length <= maxPoints) {
    return { points: full, totalHands: full.length };
  }

  // 等間隔バケットの末尾のポイントを採用（最後のバケットは必ず最終ハンド）
  const points: ProfitHistoryPoint[] = [];
  let prevEnd = -1;
  for (let k = 0; k < maxPoints; k++) {
    const end = Math.ceil(((k + 1) * full.length) / maxPoints) - 1;
    if (end <= prevEnd) continue;
    const pt = full[end];
    // p はバケット内の収支合計に置き換える（c の差分で厳密に出る）
    const prevC = prevEnd >= 0 ? full[prevEnd].c : 0;
    points.push({ ...pt, p: pt.c - prevC });
    prevEnd = end;
  }
  return { points, totalHands: full.length };
}
