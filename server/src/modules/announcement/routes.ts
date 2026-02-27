import { FastifyInstance } from 'fastify';
import { announcementService } from './AnnouncementService.js';

export function announcementRoutes() {
  return async function (fastify: FastifyInstance) {
    fastify.get('/api/announcement/status', async () => {
      return announcementService.getStatus();
    });
  };
}
