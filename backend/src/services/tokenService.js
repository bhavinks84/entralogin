const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getRedisClient } = require('../config/redis');

const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

// Redis key for the refresh-token allowlist
const refreshKey = (jti) => `refresh:${jti}`;

/**
 * Issue an access token + refresh token pair for the given user.
 */
const issueTokens = async (user) => {
  const jti = uuidv4();

  const accessToken = jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  const refreshToken = jwt.sign(
    { sub: user._id.toString(), jti },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  );

  // Store refresh token JTI in Redis
  const redis = getRedisClient();
  await redis.setex(refreshKey(jti), REFRESH_TOKEN_TTL_SECONDS, user._id.toString());

  return { accessToken, refreshToken };
};

/**
 * Rotate a refresh token: validates old JTI, issues new pair, invalidates old JTI.
 */
const rotateRefreshToken = async (refreshToken, user) => {
  const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  const redis = getRedisClient();

  const stored = await redis.get(refreshKey(decoded.jti));
  if (!stored) {
    const err = new Error('Refresh token has been revoked.');
    err.status = 401;
    throw err;
  }

  // Revoke old JTI immediately
  await redis.del(refreshKey(decoded.jti));

  return issueTokens(user);
};

/**
 * Revoke a specific refresh token by JTI.
 */
const revokeRefreshToken = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const redis = getRedisClient();
    await redis.del(refreshKey(decoded.jti));
  } catch {
    // Token may already be expired – ignore
  }
};

/**
 * Set access + refresh tokens as HttpOnly cookies on the response.
 */
const setCookies = (res, accessToken, refreshToken) => {
  const isProd = process.env.NODE_ENV === 'production';

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth', // Restrict refresh token cookie to auth routes
  });
};

/**
 * Clear auth cookies.
 */
const clearCookies = (res) => {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token', { path: '/api/auth' });
};

module.exports = { issueTokens, rotateRefreshToken, revokeRefreshToken, setCookies, clearCookies };
