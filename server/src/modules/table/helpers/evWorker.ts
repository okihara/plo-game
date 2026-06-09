// オールインEV計算を専用スレッドで実行する worker_threads エントリ。
// メインのイベントループを塞がないよう、重いモンテカルロ計算をここに逃がす。
// 起動は evWorker.boot.mjs 経由（本番の tsx ランタイムでも .ts を解決するため）。
import { parentPort } from 'node:worker_threads';
import { calculateAllInEVProfits, SidePot } from '../../../shared/logic/equityCalculator.js';
import { Card } from '../../../shared/logic/types.js';

/** EV 計算ジョブの入力。postMessage で structured clone されるため Map は entries 配列で渡す。 */
export interface EVJobInput {
  communityCards: Card[];
  allPlayers: { playerId: number; holeCards: Card[]; folded: boolean }[];
  sidePots: SidePot[];
  totalBets: [number, number][];
}

interface EVJobMessage {
  id: number;
  input: EVJobInput;
}

interface EVJobResult {
  id: number;
  profits: [number, number][];
}

parentPort?.on('message', (msg: EVJobMessage) => {
  const { id, input } = msg;
  try {
    const profits = calculateAllInEVProfits(
      input.communityCards,
      input.allPlayers,
      input.sidePots,
      new Map(input.totalBets),
    );
    const result: EVJobResult = { id, profits: [...profits] };
    parentPort?.postMessage(result);
  } catch (err) {
    // 失敗してもメインは EV なしで成立する（後追い UPDATE をスキップするだけ）
    parentPort?.postMessage({ id, profits: [] } satisfies EVJobResult);
    console.error('[evWorker] EV calculation failed:', err);
  }
});
