import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { TableManager } from '../table/TableManager.js';

interface PrivateRoomsDependencies {
  tableManager: TableManager;
}

/**
 * プライベートルーム一覧API（ADMIN role のログインユーザー専用）。
 * ADMIN_SECRET クエリ方式の /api/admin/* とは独立に、JWT Cookie のユーザー役割で認可する。
 */
export function privateRoomsRoutes(deps: PrivateRoomsDependencies) {
  const { tableManager } = deps;

  return async function (fastify: FastifyInstance) {
    fastify.addHook('onRequest', async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const { userId } = request.user as { userId: string };
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user?.role !== 'ADMIN') {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    });

    fastify.get('/api/private-rooms', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const rooms = tableManager.getPrivateTables().map(table => {
        const state = table.getClientGameState();
        const players = table
          .getAdminSeats()
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .map(s => ({
            odId: s.odId,
            odName: s.odName,
            seatNumber: s.seatNumber,
            chips: s.chips,
            isConnected: s.isConnected,
          }));
        return {
          tableId: table.id,
          inviteCode: table.inviteCode,
          blinds: table.blinds,
          playerCount: players.length,
          maxPlayers: table.maxPlayers,
          isHandInProgress: state.isHandInProgress,
          currentStreet: state.currentStreet,
          pot: state.pot,
          spectatorCount: table.getSpectatorCount(),
          players,
        };
      });
      return { rooms };
    });
  };
}
