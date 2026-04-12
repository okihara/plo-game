import { PLAYERS_PER_TABLE } from './constants.js';
import { BalanceAction } from './types.js';

interface TablePlayerInfo {
  tableId: string;
  playerCount: number;
  isHandInProgress: boolean;
}

/**
 * テーブル間のプレイヤー数バランシングを管理する
 */
export class TableBalancer {
  /**
   * 初期テーブル割り当て: プレイヤーをシャッフルして均等に分配
   * @returns テーブルごとのプレイヤーodId配列
   */
  static initialAssignment(
    playerIds: string[],
    playersPerTable: number = PLAYERS_PER_TABLE
  ): string[][] {
    // シャッフル（Fisher-Yates）
    const shuffled = [...playerIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // テーブル数を計算
    const tableCount = Math.ceil(shuffled.length / playersPerTable);
    const tables: string[][] = Array.from({ length: tableCount }, () => []);

    // ラウンドロビンで均等分配
    for (let i = 0; i < shuffled.length; i++) {
      tables[i % tableCount].push(shuffled[i]);
    }

    return tables;
  }

  /**
   * テーブルバランスをチェックし、必要な移動アクションを返す
   *
   * ルール:
   * 1. テーブルが1つなら何もしない
   * 2. 全プレイヤー数 ≤ (テーブル数-1) × playersPerTable → 最少テーブルを破壊
   * 3. テーブル間のプレイヤー差 ≥ 2 → 多いテーブルから少ないテーブルへ移動
   *
   * @param tables 各テーブルの情報
   * @param getPlayerIds テーブルIDからプレイヤーodIdリストを取得する関数
   * @returns 実行すべき移動アクション（ハンド中のテーブルは移動元から除外）
   */
  /**
   * フォールド済みプレイヤーを即移動すべきか判定する。
   * ハンド中でもフォールド済みなので安全に移動できる前提。
   *
   * @param fromTableId フォールドしたプレイヤーがいるテーブル
   * @param tables 各テーブルのプレイヤー数（getPlayerCount: leftForFastFold 除外済み）
   * @returns 移動先テーブルID（移動不要なら null）
   */
  static shouldMoveFoldedPlayer(
    fromTableId: string,
    tables: { tableId: string; playerCount: number }[],
  ): string | null {
    if (tables.length <= 1) return null;

    const fromInfo = tables.find(t => t.tableId === fromTableId);
    if (!fromInfo) return null;

    const minTable = tables.reduce((min, t) => t.playerCount < min.playerCount ? t : min);

    // 差が2未満 or 移動先が自テーブルならバランス不要
    if (fromInfo.playerCount - minTable.playerCount < 2) return null;
    if (minTable.tableId === fromTableId) return null;

    return minTable.tableId;
  }

  static checkBalance(
    tables: TablePlayerInfo[],
    getPlayerIds: (tableId: string) => string[],
    playersPerTable: number = PLAYERS_PER_TABLE
  ): BalanceAction[] {
    if (tables.length <= 1) return [];

    const actions: BalanceAction[] = [];
    const totalPlayers = tables.reduce((sum, t) => sum + t.playerCount, 0);

    // テーブル破壊判定: プレイヤー数が (テーブル数-1) × 定員以内に収まるか
    const canReduceTable = totalPlayers <= (tables.length - 1) * playersPerTable;

    if (canReduceTable) {
      // 最少人数のテーブルを破壊対象に（ハンド中でないテーブル優先）
      const sortedByCount = [...tables].sort((a, b) => {
        // ハンド中でないテーブルを優先
        if (a.isHandInProgress !== b.isHandInProgress) {
          return a.isHandInProgress ? 1 : -1;
        }
        return a.playerCount - b.playerCount;
      });

      const breakTable = sortedByCount[0];

      // ハンド中なら今は移動しない（次のハンド完了後に再チェック）
      if (breakTable.isHandInProgress) return [];

      const playersToMove = getPlayerIds(breakTable.tableId);
      const remainingTables = tables
        .filter(t => t.tableId !== breakTable.tableId)
        .sort((a, b) => a.playerCount - b.playerCount);

      // 破壊テーブルのプレイヤーを他テーブルに均等分配
      let targetIndex = 0;
      for (const odId of playersToMove) {
        actions.push({
          type: 'break',
          odId,
          fromTableId: breakTable.tableId,
          toTableId: remainingTables[targetIndex].tableId,
        });
        remainingTables[targetIndex].playerCount++;
        // 次のターゲット（人数が少ないテーブルから埋める）
        remainingTables.sort((a, b) => a.playerCount - b.playerCount);
        targetIndex = 0;
      }

      return actions;
    }

    // バランシング: プレイヤー差 ≥ 2 のテーブル間で移動
    const sorted = [...tables].sort((a, b) => b.playerCount - a.playerCount);
    const maxTable = sorted[0];
    const minTable = sorted[sorted.length - 1];

    if (maxTable.playerCount - minTable.playerCount >= 2) {
      // ハンド中のテーブルからは移動しない
      if (maxTable.isHandInProgress) return [];

      const players = getPlayerIds(maxTable.tableId);
      if (players.length > 0) {
        // 最後のプレイヤーを移動（新しく着席した人を優先的に移動）
        actions.push({
          type: 'move',
          odId: players[players.length - 1],
          fromTableId: maxTable.tableId,
          toTableId: minTable.tableId,
        });
      }
    }

    return actions;
  }
}
