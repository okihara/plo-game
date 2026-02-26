import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import ejs from 'ejs';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { authRoutes } from './modules/auth/routes.js';
import { bankrollRoutes } from './modules/auth/bankroll.js';
import { setupGameSocket } from './modules/game/socket.js';
import { adminRoutes } from './modules/admin/routes.js';
import { lobbyRoutes } from './modules/lobby/routes.js';
import { handHistoryRoutes } from './modules/history/routes.js';
import { statsRoutes } from './modules/stats/routes.js';
import { maintenanceService } from './modules/maintenance/MaintenanceService.js';
import { maintenanceRoutes } from './modules/maintenance/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: env.NODE_ENV === 'development' ? { level: 'warn' } : false,
  trustProxy: env.NODE_ENV === 'production',
});

// Plugins
await fastify.register(cors, {
  origin: env.CLIENT_URL,
  credentials: true,
});

await fastify.register(cookie);

await fastify.register(jwt, {
  secret: env.JWT_SECRET,
  cookie: {
    cookieName: 'token',
    signed: false,
  },
});

await fastify.register(view, {
  engine: { ejs },
  root: path.join(__dirname, 'modules/admin/views'),
});

// Decorate fastify with prisma
fastify.decorate('prisma', prisma);

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// API Routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(bankrollRoutes, { prefix: '/api/bankroll' });
await fastify.register(handHistoryRoutes, { prefix: '/api/history' });
await fastify.register(statsRoutes, { prefix: '/api/stats' });

// 静的ファイル配信
const staticRoot = env.NODE_ENV === 'production'
  ? path.join(__dirname, '../../dist')
  : path.join(__dirname, '../../public');
await fastify.register(fastifyStatic, {
  root: staticRoot,
  prefix: '/',
});

if (env.NODE_ENV === 'production') {

  // SPA フォールバック（API・admin以外のルートはindex.htmlを返す）
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/health') || request.url.startsWith('/admin/')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
}

// Start server and setup Socket.io
const start = async () => {
  try {
    // Health check: Database connection
    console.log('Checking database connection...');
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ Database connected');
    } catch (err) {
      console.error('❌ Database connection failed. Please start PostgreSQL with: docker-compose up -d');
      console.error(err);
      process.exit(1);
    }

    // Setup Socket.io on the same server (before listen for admin routes)
    const io = new Server(fastify.server, {
      cors: {
        origin: env.CLIENT_URL,
        credentials: true,
      },
      pingInterval: 10000,  // 10秒ごとにping
      pingTimeout: 5000,    // 5秒以内にpongがなければ切断と判断
    });

    const { tableManager } = setupGameSocket(io, fastify);

    // Initialize maintenance service
    await maintenanceService.initialize(io);
    maintenanceService.setOnDeactivate(() => {
      for (const info of tableManager.getTablesInfo()) {
        const table = tableManager.getTable(info.id);
        table?.triggerMaybeStartHand();
      }
    });

    // Register admin routes (needs io, tableManager)
    await fastify.register(adminRoutes({ io, tableManager }));
    await fastify.register(lobbyRoutes({ tableManager }));
    await fastify.register(maintenanceRoutes());

    await fastify.listen({ port: env.PORT, host: '0.0.0.0' });

    console.log(`✅ Server running on http://localhost:${env.PORT}`);
    console.log(`✅ WebSocket ready on ws://localhost:${env.PORT}`);
    console.log(`✅ Status dashboard: http://localhost:${env.PORT}/admin/status`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
