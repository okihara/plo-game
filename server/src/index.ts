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
import { env, allowedOrigins } from './config/env.js';
import { prisma } from './config/database.js';
import { authRoutes } from './modules/auth/routes.js';
import { bankrollRoutes } from './modules/auth/bankroll.js';
import { setupGameSocket } from './modules/game/socket.js';
import { adminRoutes } from './modules/admin/routes.js';
import { lobbyRoutes } from './modules/lobby/routes.js';
import { handHistoryRoutes, publicHandHistoryRoutes } from './modules/history/routes.js';
import { statsRoutes } from './modules/stats/routes.js';
import { labelRoutes } from './modules/labels/routes.js';
import { maintenanceService } from './modules/maintenance/MaintenanceService.js';
import { maintenanceRoutes } from './modules/maintenance/routes.js';
import { announcementService } from './modules/announcement/AnnouncementService.js';
import { announcementRoutes } from './modules/announcement/routes.js';
import { startRankingBadgeScheduler } from './modules/badges/rankingBadgeScheduler.js';
import { ogpRoutes } from './modules/ogp/routes.js';
import { tournamentRoutes } from './modules/tournament/routes.js';
import { tournamentEvaluationRoutes } from './modules/tournamentEvaluation/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: env.NODE_ENV === 'development' ? { level: 'warn' } : false,
  trustProxy: env.NODE_ENV === 'production',
});

// Plugins
await fastify.register(cors, {
  origin: allowedOrigins,
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
await fastify.register(tournamentEvaluationRoutes, { prefix: '/api/tournament-evaluations' });
await fastify.register(publicHandHistoryRoutes, { prefix: '/api/hand' });
await fastify.register(statsRoutes, { prefix: '/api/stats' });
await fastify.register(labelRoutes, { prefix: '/api/labels' });
await fastify.register(ogpRoutes, { prefix: '/api/ogp' });

// 静的ファイル配信
const staticRoot = env.NODE_ENV === 'production'
  ? path.join(__dirname, '../../dist')
  : path.join(__dirname, '../../public');
await fastify.register(fastifyStatic, {
  root: staticRoot,
  prefix: '/',
});

if (env.NODE_ENV === 'production') {
  // クローラー判定用User-Agentパターン
  const CRAWLER_UA = /Twitterbot|facebookexternalhit|Discordbot|Slackbot|LinkedInBot|Googlebot|bingbot|LINE/i;

  // SPA フォールバック（API・admin以外のルートはindex.htmlを返す）
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/health') || request.url.startsWith('/admin/')) {
      return reply.status(404).send({ error: 'Not found' });
    }

    // /player/:userId へのクローラーアクセス → 動的OGPメタタグを返す
    const playerMatch = request.url.match(/^\/player\/([^/?#]+)/);
    if (playerMatch && CRAWLER_UA.test(request.headers['user-agent'] || '')) {
      const userId = playerMatch[1];
      const baseUrl = env.CLIENT_URL;
      const pageUrl = `${baseUrl}/player/${userId}`;

      // ユーザー名とスタッツを取得（OGPタイトル・キャッシュバストに使用）
      let title = 'Baby PLO - プレイヤースタッツ';
      let handsPlayed = 0;
      try {
        const [user, statsCache] = await Promise.all([
          prisma.user.findUnique({
            where: { id: userId },
            select: { username: true, displayName: true, nameMasked: true },
          }),
          prisma.playerStatsCache.findUnique({
            where: { userId },
            select: { handsPlayed: true },
          }),
        ]);
        if (user) {
          const { maskName } = await import('./shared/utils.js');
          const name = user.displayName || (user.nameMasked ? maskName(user.username) : user.username);
          title = `${name} のスタッツ | Baby PLO`;
        }
        if (statsCache) {
          handsPlayed = statsCache.handsPlayed;
        }
      } catch {
        // ignore
      }
      const ogpImageUrl = `${baseUrl}/api/ogp/player/${userId}?v=${handsPlayed}`;

      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="Baby PLO でのプレイヤースタッツを見る">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${ogpImageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Baby PLO">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="Baby PLO でのプレイヤースタッツを見る">
  <meta name="twitter:image" content="${ogpImageUrl}">
  <title>${title}</title>
</head>
<body></body>
</html>`;
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(html);
    }

    // /hand/:handId へのクローラーアクセス → 動的OGPメタタグを返す
    const handMatch = request.url.match(/^\/hand\/([^/?#]+)/);
    if (handMatch && CRAWLER_UA.test(request.headers['user-agent'] || '')) {
      const handId = handMatch[1];
      const tokenParam = (request.query as Record<string, string>).t || '';
      const tokenSuffix = tokenParam ? `?t=${encodeURIComponent(tokenParam)}` : '';
      const baseUrl = env.CLIENT_URL;
      const ogpImageUrl = `${baseUrl}/api/ogp/hand/${handId}${tokenSuffix}`;
      const pageUrl = `${baseUrl}/hand/${handId}${tokenSuffix}`;

      let title = 'Baby PLO - ハンド履歴';
      let description = 'Baby PLO でのハンド詳細を見る';
      try {
        const hand = await prisma.handHistory.findUnique({
          where: { id: handId },
          select: { blinds: true, potSize: true },
        });
        if (hand) {
          title = `Hand #${handId.slice(-6)} (${hand.blinds}) | Baby PLO`;
          description = `Pot ${hand.potSize} | Baby PLO でのハンド詳細`;
        }
      } catch {
        // ignore
      }

      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${ogpImageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Baby PLO">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${ogpImageUrl}">
  <title>${title}</title>
</head>
<body></body>
</html>`;
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(html);
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
        origin: allowedOrigins,
        credentials: true,
      },
      pingInterval: 10000,  // 10秒ごとにping
      pingTimeout: 5000,    // 5秒以内にpongがなければ切断と判断
    });

    const { tableManager, tournamentManager } = setupGameSocket(io, fastify);

    // Initialize services
    await maintenanceService.initialize(io);
    announcementService.initialize(io);
    maintenanceService.setOnDeactivate(() => {
      for (const info of tableManager.getTablesInfo()) {
        const table = tableManager.getTable(info.id);
        table?.triggerMaybeStartHand();
      }
    });

    // Register admin routes (needs io, tableManager, tournamentManager)
    await fastify.register(adminRoutes({ io, tableManager, tournamentManager }));
    await fastify.register(lobbyRoutes({ tableManager }));
    await fastify.register(tournamentRoutes({ tournamentManager }));
    await fastify.register(maintenanceRoutes());
    await fastify.register(announcementRoutes());

    // Badge scheduler
    startRankingBadgeScheduler();

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
