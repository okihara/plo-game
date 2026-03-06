import { FastifyInstance } from 'fastify';
import { TableManager } from '../table/TableManager.js';

interface LobbyDependencies {
  tableManager: TableManager;
}

export function lobbyRoutes(deps: LobbyDependencies) {
  const { tableManager } = deps;

  return async function (fastify: FastifyInstance) {
    // Player counts per blind level
    fastify.get('/api/lobby/tables', async () => {
      const tablesInfo = tableManager.getTablesInfo().filter(t => !t.isPrivate);
      // 実テーブルから blinds × isFastFold ごとにプレイヤー数を集計
      const key = (blinds: string, isFastFold: boolean) => `${blinds}:${isFastFold}`;
      const map = new Map<string, { blinds: string; playerCount: number; isFastFold: boolean }>();
      for (const t of tablesInfo) {
        const k = key(t.blinds, t.isFastFold);
        const entry = map.get(k);
        if (entry) {
          entry.playerCount += t.players;
        } else {
          map.set(k, { blinds: t.blinds, playerCount: t.players, isFastFold: t.isFastFold });
        }
      }
      return Array.from(map.values());
    });
  };
}
