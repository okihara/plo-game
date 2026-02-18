import { FastifyInstance } from 'fastify';
import { maintenanceService } from './MaintenanceService.js';

export function maintenanceRoutes() {
  return async function (fastify: FastifyInstance) {
    fastify.get('/api/maintenance/status', async () => {
      return maintenanceService.getStatus();
    });
  };
}
