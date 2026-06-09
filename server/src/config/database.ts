import { Prisma, PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { recordDbQueryLatency } from '../modules/admin/metrics.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const logOptions: Prisma.PrismaClientOptions['log'] = [
  { emit: 'event', level: 'query' },
  ...(env.NODE_ENV === 'development'
    ? [
        { emit: 'stdout' as const, level: 'error' as const },
        { emit: 'stdout' as const, level: 'warn' as const },
      ]
    : [
        { emit: 'stdout' as const, level: 'error' as const },
      ]),
];

type PrismaClientWithQueryEvents = PrismaClient & {
  $on(eventType: 'query', callback: (event: Prisma.QueryEvent) => void): void;
};

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({ log: logOptions });
  (client as PrismaClientWithQueryEvents).$on('query', (event) => {
    recordDbQueryLatency(event.duration);
  });
  return client;
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
