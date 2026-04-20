import Redis from 'ioredis';
import { ENV } from './env.js';

let redisInstance: Redis | null = null;
let redisSubscriberInstance: Redis | null = null;

// Parse Redis URL to extract connection options
const parseRedisUrl = (url: string) => {
    try {
        // Convert redis:// to rediss:// for TLS if it's an Upstash URL
        let processedUrl = url;
        if (url.includes('upstash.io') && url.startsWith('redis://')) {
            console.log('[Redis] Detected Upstash URL, converting to TLS (rediss://)');
            processedUrl = url.replace('redis://', 'rediss://');
        }
        
        const redisUrl = new URL(processedUrl);
        return {
            host: redisUrl.hostname || 'localhost',
            port: parseInt(redisUrl.port || '6379', 10),
            password: redisUrl.password || undefined,
            username: redisUrl.username || undefined,
            db: redisUrl.pathname ? parseInt(redisUrl.pathname.slice(1), 10) : 0,
            tls: processedUrl.startsWith('rediss://') ? {} : undefined,
        };
    } catch (err) {
        console.error('[Redis] Error parsing URL:', (err as Error).message);
        return {
            host: 'localhost',
            port: 6379,
            db: 0,
        };
    }
};

// The main connection for basic commands, publisher, and standard queues
export const getRedisClient = () => {
    if (!redisInstance) {
        console.log(`[Redis] Initializing connection...`);
        
        // Use parsed options for better stability
        const redisOptions = parseRedisUrl(ENV.REDIS_URL);
        
        redisInstance = new Redis({
            ...redisOptions,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            enableOfflineQueue: true,
            connectTimeout: 10000,
            lazyConnect: false,
            retryStrategy: (times) => {
                if (times > 5) {
                    console.error('[Redis] Max retries exceeded, giving up');
                    return null;
                }
                const delay = Math.min(times * 500, 3000);
                console.log(`[Redis] Retry attempt ${times}, waiting ${delay}ms...`);
                return delay;
            },
            reconnectOnError: (err) => {
                const targetError = 'READONLY';
                if (err.message.includes(targetError)) {
                    return true;
                }
                return false;
            }
        });

        redisInstance.on('error', (err) => {
            console.error('[Redis] Error:', err.message);
        });

        redisInstance.on('connect', () => {
            console.log('✅ Redis connected successfully');
        });

        redisInstance.on('ready', () => {
            console.log('[Redis] Ready for commands');
        });

        redisInstance.on('close', () => {
            console.warn('[Redis] Connection closed');
        });

        redisInstance.on('reconnecting', () => {
            console.log('[Redis] Attempting to reconnect...');
        });
    }
    return redisInstance;
};

// A separate connection needed by BullMQ for subscribers/blocking operations
export const getRedisSubscriber = () => {
    if (!redisSubscriberInstance) {
        console.log(`[Redis] Initializing subscriber connection...`);
        
        // Use parsed options for consistency
        const redisOptions = parseRedisUrl(ENV.REDIS_URL);
        
        redisSubscriberInstance = new Redis({
            ...redisOptions,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            enableOfflineQueue: true,
            connectTimeout: 10000,
            lazyConnect: false,
            retryStrategy: (times) => {
                if (times > 5) {
                    console.error('[Redis Subscriber] Max retries exceeded');
                    return null;
                }
                const delay = Math.min(times * 500, 3000);
                return delay;
            },
            reconnectOnError: (err) => {
                const targetError = 'READONLY';
                if (err.message.includes(targetError)) {
                    return true;
                }
                return false;
            }
        });

        redisSubscriberInstance.on('error', (err) => {
            console.error('[Redis Subscriber] Error:', err.message);
        });

        redisSubscriberInstance.on('connect', () => {
            console.log('✅ Redis subscriber connected successfully');
        });

        redisSubscriberInstance.on('close', () => {
            console.warn('[Redis Subscriber] Connection closed');
        });
    }
    return redisSubscriberInstance;
};

// BullMQ connection configuration - pass plain options object, not Redis instance
export const connection = parseRedisUrl(ENV.REDIS_URL);
