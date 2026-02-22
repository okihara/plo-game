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
      const tablesInfo = tableManager.getTablesInfo();
      const blindLevels = ['1/3', '2/5', '5/10'];
      const results: { blinds: string; playerCount: number; isFastFold: boolean }[] = [];
      for (const blinds of blindLevels) {
        for (const isFastFold of [false, true]) {
          const tables = tablesInfo.filter(t => t.blinds === blinds && t.isFastFold === isFastFold);
          const playerCount = tables.reduce((sum, t) => sum + t.players, 0);
          results.push({ blinds, playerCount, isFastFold });
        }
      }
      return results;
    });
  };
}
