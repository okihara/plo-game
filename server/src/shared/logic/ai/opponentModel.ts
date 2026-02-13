import { Action, Street, GameAction } from '../types.js';
import { OpponentModel, OpponentStats } from './types.js';

/**
 * 相手モデリング。ハンド間で統計を蓄積し、相手の傾向を分析する。
 * BotClientのインスタンスごとに保持。
 */
export class SimpleOpponentModel implements OpponentModel {
  private stats: Map<number, OpponentStats> = new Map();

  /**
   * ハンド完了時に統計を更新。
   */
  updateFromActions(actions: GameAction[], activePlayers: number[]): void {
    // 各プレイヤーのアクションを集計
    for (const action of actions) {
      const stats = this.getOrCreateStats(action.playerId);
      stats.totalActions++;

      switch (action.action) {
        case 'fold':
          stats.foldCount++;
          break;
        case 'call':
          stats.aggCalls++;
          break;
        case 'check':
          stats.aggChecks++;
          break;
        case 'bet':
        case 'raise':
        case 'allin':
          stats.aggBets++;
          break;
      }
    }

    // VPIP, PFR の更新（プリフロップのアクションのみ対象）
    // 簡易版: 全アクションから推定
    for (const playerId of activePlayers) {
      const stats = this.getOrCreateStats(playerId);
      stats.handsPlayed++;

      const playerActions = actions.filter(a => a.playerId === playerId);
      const hasVoluntaryAction = playerActions.some(a =>
        a.action === 'call' || a.action === 'raise' || a.action === 'bet' || a.action === 'allin'
      );
      const hasRaise = playerActions.some(a =>
        a.action === 'raise' || a.action === 'bet' || a.action === 'allin'
      );

      if (hasVoluntaryAction) {
        // 移動平均でVPIP/PFRを更新（直近の傾向を重視）
        const alpha = Math.min(0.1, 1 / stats.handsPlayed); // 学習率
        stats.vpip = stats.vpip * (1 - alpha) + (hasVoluntaryAction ? 1 : 0) * alpha;
        stats.pfr = stats.pfr * (1 - alpha) + (hasRaise ? 1 : 0) * alpha;
      }
    }
  }

  /**
   * 特定プレイヤーの統計を取得。
   */
  getStats(playerId: number): OpponentStats | null {
    return this.stats.get(playerId) ?? null;
  }

  /**
   * プレイヤーのスタイルを分類。
   */
  classifyPlayer(playerId: number): 'TAG' | 'LAG' | 'TP' | 'LP' | 'unknown' {
    const stats = this.stats.get(playerId);
    if (!stats || stats.handsPlayed < 5) return 'unknown';

    const isLoose = stats.vpip > 0.30;
    const isAggressive = stats.aggBets > stats.aggCalls;

    if (!isLoose && isAggressive) return 'TAG';
    if (isLoose && isAggressive) return 'LAG';
    if (!isLoose && !isAggressive) return 'TP';
    return 'LP';
  }

  /**
   * フォールド確率を推定。
   */
  estimateFoldProbability(playerId: number, street: Street): number {
    const stats = this.stats.get(playerId);
    if (!stats || stats.totalActions < 5) return 0.4; // デフォルト

    const foldRate = stats.foldCount / stats.totalActions;

    // ストリートによる補正
    let streetMultiplier = 1.0;
    if (street === 'preflop') streetMultiplier = 0.9;
    if (street === 'flop') streetMultiplier = 1.0;
    if (street === 'turn') streetMultiplier = 1.1;
    if (street === 'river') streetMultiplier = 1.2;

    return Math.min(0.9, foldRate * streetMultiplier);
  }

  private getOrCreateStats(playerId: number): OpponentStats {
    let stats = this.stats.get(playerId);
    if (!stats) {
      stats = {
        odId: String(playerId),
        handsPlayed: 0,
        vpip: 0.30, // デフォルト（平均的プレイヤー）
        pfr: 0.20,
        cbetCount: 0,
        cbetOpportunities: 0,
        foldToCbetCount: 0,
        foldToCbetOpportunities: 0,
        aggBets: 0,
        aggCalls: 0,
        aggChecks: 0,
        foldCount: 0,
        totalActions: 0,
      };
      this.stats.set(playerId, stats);
    }
    return stats;
  }
}
