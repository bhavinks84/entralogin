const express = require('express');
const { body, query } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');

const User = require('../models/User');
const { sendOtp, verifyOtp } = require('../services/otpService');
const { issueTokens, rotateRefreshToken, revokeRefreshToken, setCookies, clearCookies } = require('../services/tokenService');
const { requestPasswordReset, resetPassword } = require('../services/passwordService');
const { createEntraUser, findEntraUserByEmail } = require('../services/entraUserService');
const { getAuthCodeUrl, acquireTokenByCode } = require('../config/msal');

const router = express.Router();

// ──────────────────────────────────────────
// OTP Routes
// ──────────────────────────────────────────

/**
 * POST /api/auth/otp/request
 * Send a 6-digit OTP to the provided email address.
 */
router.post(
  '/otp/request',
  authRateLimiter,
  [body('email').isEmail().normalizeEmail()],
  validate,
  async (req, res) => {
    try {
      await sendOtp(req.body.email);
      res.json({ message: 'OTP sent. Check your inbox.' });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/auth/otp/verify
 * Verify OTP and sign in (or create) the user.
 */
router.post(
  '/otp/verify',
  authRateLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, otp, displayName } = req.body;

      await verifyOtp(email, otp);

      // Upsert the user – first-time sign-in creates the account
      let user = await User.findOne({ email });
      const isNewUser = !user;

      if (!user) {
        // ── Provision the user in Entra External ID first ──────────────────
        // Every OTP-registered account is mirrored into Entra so users can
        // also sign in later via the "Sign in with Microsoft" button.
        let entraExternalId;
        try {
          const entraUser = await createEntraUser({
            email,
            displayName: displayName || email.split('@')[0],
          });
          entraExternalId = entraUser?.id;
        } catch (entraErr) {
          // Log but don't block registration – a sync can be retried later.
          console.error('[Entra] User provisioning failed:', entraErr.message);
        }
        // ───────────────────────────────────────────────────────────────────

        user = await User.create({
          email,
          emailVerified: true,
          displayName: displayName || email.split('@')[0],
          ...(entraExternalId && { entraExternalId }),
        });
      } else {
        // Existing user sign-in – backfill entraExternalId if missing
        if (!user.entraExternalId) {
          try {
            const entraUser = await findEntraUserByEmail(email);
            if (entraUser) {
              user.entraExternalId = entraUser.id;
              console.log(`[Entra] Linked existing user ${email} to Entra id ${entraUser.id}`);
            } else {
              // Not in Entra yet – provision now
              const created = await createEntraUser({ email, displayName: user.displayName });
              if (created) user.entraExternalId = created.id;
            }
          } catch (entraErr) {
            console.error('[Entra] Backfill failed:', entraErr.message);
          }
        }
        user.lastLoginAt = new Date();
        user.emailVerified = true;
        await user.save();
      }

      const { accessToken, refreshToken } = await issueTokens(user);
      setCookies(res, accessToken, refreshToken);

      res.json({ user: user.toPublicJSON(), isNewUser });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

// ──────────────────────────────────────────
// Entra External ID (OAuth2) Routes
// ──────────────────────────────────────────

/**
 * GET /api/auth/entra
 * Redirect user to Microsoft Entra External ID login page.
 */
router.get('/entra', async (req, res) => {
  try {
    // Validate that Entra is actually configured before attempting the redirect
    if (
      !process.env.ENTRA_CLIENT_ID ||
      process.env.ENTRA_CLIENT_ID === '00000000-0000-0000-0000-000000000000'
    ) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/login?error=${encodeURIComponent(
          'Microsoft Entra is not configured yet. Fill in ENTRA_* values in backend/.env and follow ENTRA_SETUP.md.'
        )}`
      );
    }

    // Use a random state token to prevent CSRF on the callback
    const state = uuidv4();
    const authUrl = await getAuthCodeUrl(state);

    // Store state in a short-lived cookie for verification in callback
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });

    res.redirect(authUrl);
  } catch (err) {
    console.error('Entra redirect error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=entra_init_failed`);
  }
});

/**
 * GET /api/auth/entra/callback
 * Handle the OAuth2 authorization code callback from Entra ID.
 */
router.get('/entra/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      const msg = encodeURIComponent(error_description || error);
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=${msg}`);
    }

    // Validate state to prevent CSRF
    const storedState = req.cookies?.oauth_state;
    if (!state || state !== storedState) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
    }
    res.clearCookie('oauth_state');

    // Exchange code for tokens
    const tokenResponse = await acquireTokenByCode(code, state);
    const claims = tokenResponse.idTokenClaims;

    const entraId = claims.sub || claims.oid;
    const email   = (claims.email || claims.preferred_username || '').toLowerCase();

    if (!email) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_email_claim`);
    }

    // Upsert user
    let user = await User.findOne({ $or: [{ entraExternalId: entraId }, { email }] });
    const isNewUser = !user;

    if (!user) {
      user = await User.create({
        email,
        entraExternalId: entraId,
        displayName: claims.name || email.split('@')[0],
        givenName:   claims.given_name,
        surname:     claims.family_name,
        emailVerified: true,
      });
    } else {
      user.entraExternalId = user.entraExternalId || entraId;
      user.lastLoginAt     = new Date();
      if (!user.displayName && claims.name) user.displayName = claims.name;
      await user.save();
    }

    const { accessToken, refreshToken } = await issueTokens(user);
    setCookies(res, accessToken, refreshToken);

    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
  } catch (err) {
    console.error('Entra callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=entra_callback_failed`);
  }
});

// ──────────────────────────────────────────
// Session Routes
// ──────────────────────────────────────────

/**
 * GET /api/auth/session
 * Returns the current user if authenticated, or { user: null } with 200 if not.
 * Use this for the initial page-load session check to avoid a noisy 401 in the console.
 */
router.get('/session', async (req, res) => {
  const token = req.cookies?.access_token;
  if (!token) return res.json({ user: null });
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.sub);
    return res.json({ user: user ? user.toPublicJSON() : null });
  } catch {
    return res.json({ user: null });
  }
});

/**
 * GET /api/auth/me
 * Return the currently authenticated user's profile.
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user.toPublicJSON() });
});

/**
 * POST /api/auth/logout
 * Revoke the refresh token and clear cookies.
 */
router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token;
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  clearCookies(res);
  res.json({ message: 'Logged out.' });
});

/**
 * POST /api/auth/refresh
 * Rotate the refresh token and issue a new access token.
 */
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token.' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.sub);
    if (!user) return res.status(401).json({ error: 'User not found.' });

    const { accessToken, refreshToken: newRefresh } = await rotateRefreshToken(refreshToken, user);
    setCookies(res, accessToken, newRefresh);
    res.json({ message: 'Token refreshed.' });
  } catch (err) {
    clearCookies(res);
    res.status(401).json({ error: 'Invalid refresh token.' });
  }
});

// ──────────────────────────────────────────
// Profile Routes
// ──────────────────────────────────────────

/**
 * PUT /api/auth/profile
 * Update the current user's display name and preferences.
 */
router.put(
  '/profile',
  authenticate,
  [
    body('displayName').optional().trim().isLength({ min: 1, max: 100 }),
    body('givenName').optional().trim().isLength({ max: 100 }),
    body('surname').optional().trim().isLength({ max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { displayName, givenName, surname, preferences } = req.body;
      const user = req.user;

      if (displayName !== undefined) user.displayName = displayName;
      if (givenName   !== undefined) user.givenName   = givenName;
      if (surname     !== undefined) user.surname     = surname;
      if (preferences !== undefined) user.preferences = preferences;

      await user.save();
      res.json({ user: user.toPublicJSON() });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

// ──────────────────────────────────────────
// Password Reset Routes
// ──────────────────────────────────────────

/**
 * POST /api/auth/password/reset-request
 */
router.post(
  '/password/reset-request',
  authRateLimiter,
  [body('email').isEmail().normalizeEmail()],
  validate,
  async (req, res) => {
    await requestPasswordReset(req.body.email); // Always returns 200
    res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
  }
);

/**
 * POST /api/auth/password/reset
 */
router.post(
  '/password/reset',
  [
    body('token').notEmpty(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  ],
  validate,
  async (req, res) => {
    try {
      const user = await resetPassword(req.body.token, req.body.password);
      const { accessToken, refreshToken } = await issueTokens(user);
      setCookies(res, accessToken, refreshToken);
      res.json({ message: 'Password reset successful.', user: user.toPublicJSON() });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

module.exports = router;
