import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * General API rate limiter
 * 100 requests per 15 minutes per IP
 */
export const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    //
    validate: { default: false }, // Add this
    //
    message: {
        error: 'Too many requests from this IP, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/healthz' || req.path === '/health';
    },
});

/**
 * Video call rate limiters
 */

/**
 * Start call limiter: Max 5 calls per hour per user
 */
export const startCallLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    //
    validate: { default: false }, // Add this
    //
    keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise fall back to IP with proper IPv6 handling
        const userId = (req as any).user?.userId;
        return userId ? `start-call-${userId}` : `start-call-${ipKeyGenerator(req.ip || '')}`;
    },
    message: {
        error: 'Too many calls started. Maximum 10 calls per hour.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Join call limiter: Max 20 join attempts per hour per user
 */
export const joinCallLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    //
    validate: { default: false }, // Add this
    //
    keyGenerator: (req) => {
        const userId = (req as any).user?.userId;
        return userId ? `join-call-${userId}` : `join-call-${ipKeyGenerator(req.ip || '')}`;
    },
    message: {
        error: 'Too many join attempts. Maximum 20 per hour.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Get call info limiter: Max 60 requests per minute (allows 5-second polling)
 */
export const getCallInfoLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    //
    validate: { default: false }, // Add this
    //
    keyGenerator: (req) => {
        const userId = (req as any).user?.userId;
        return userId ? `call-info-${userId}` : `call-info-${ipKeyGenerator(req.ip || '')}`;
    },
    message: {
        error: 'Too many call info requests. Maximum 60 per minute.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Enable recording limiter: Max 10 enable recording requests per hour
 */
export const enableRecordingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    //
    validate: { default: false }, // Add this
    //
    keyGenerator: (req) => {
        const userId = (req as any).user?.userId;
        return userId ? `recording-${userId}` : `recording-${ipKeyGenerator(req.ip || '')}`;
    },
    message: {
        error: 'Too many recording requests. Maximum 10 per hour.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * End call limiter: Max 10 end call requests per hour
 */
export const endCallLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    //
    validate: { default: false }, // Add this
    //
    keyGenerator: (req) => {
        const userId = (req as any).user?.userId;
        return userId ? `end-call-${userId}` : `end-call-${ipKeyGenerator(req.ip || '')}`;
    },
    message: {
        error: 'Too many end call requests. Maximum 10 per hour.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
