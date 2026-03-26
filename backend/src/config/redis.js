const Redis = require('ioredis');

let redis;

const getRedisClient = () => {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
    });

    redis.on('error', (err) => {
      console.error('Redis error:', err.message);
    });

    redis.on('connect', () => {
      console.log('Redis connected');
    });
  }
  return redis;
};

module.exports = { getRedisClient };
