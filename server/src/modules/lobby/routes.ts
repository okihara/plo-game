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
      return blindLevels.map(blinds => {
        const tables = tablesInfo.filter(t => t.blinds === blinds);
        const playerCount = tables.reduce((sum, t) => sum + t.players, 0);
        return {
          blinds,
          playerCount,
        };
      });
    });
  };
}
