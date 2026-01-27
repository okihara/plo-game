import Redis from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

// Redis key prefixes
export const REDIS_KEYS = {
  session: (sessionId: string) => `session:${sessionId}`,
  tableState: (tableId: string) => `table:state:${tableId}`,
  fastfoldQueue: (blinds: string) => `fastfold:queue:${blinds}`,
  playerTable: (userId: string) => `player:table:${userId}`,
  tableChannel: (tableId: string) => `channel:table:${tableId}`,
} as const;
