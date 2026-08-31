import 'dotenv/config';
import Redis from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is completely missing.');
}

const globalForRedis = global as unknown as { redis: Redis };

export const redis =
  globalForRedis.redis ||
  new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null, 
    enableReadyCheck: false,
    keepAlive: 10000, 
    retryStrategy(times) {
      return Math.min(times * 100, 3000); 
    },
  });

redis.removeAllListeners('error');
redis.removeAllListeners('connect');

redis.on('error', (err) => {
  if (err.message.includes('ECONNRESET')) return;
  console.error('[Redis Client Error]:', err);
});

redis.on('connect', () => console.log('[Redis] Shared connection established with Upstash.'));

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;