const { ConfidentialClientApplication } = require('@azure/msal-node');
const crypto = require('crypto');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Separate MSAL instance for Graph API client-credentials flow.
// Uses the standard AAD authority (not the CIAM ciamlogin.com endpoint, which
// is only for interactive/user flows).
let _graphClient = null;

const getGraphClient = () => {
  if (_graphClient) return _graphClient;
  _graphClient = new ConfidentialClientApplication({
    auth: {
      clientId:     process.env.ENTRA_CLIENT_ID,
      authority:    `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}`,
      clientSecret: process.env.ENTRA_CLIENT_SECRET,
    },
  });
  return _graphClient;
};

const getGraphToken = async () => {
  const result = await getGraphClient().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  if (!result?.accessToken) throw new Error('Failed to acquire Microsoft Graph token.');
  return result.accessToken;
};

/**
 * Returns true only when real Entra credentials are present.
 * In dev mode (dummy values) all Graph calls are skipped.
 */
const isEntraConfigured = () =>
  !!(
    process.env.ENTRA_CLIENT_ID &&
    process.env.ENTRA_CLIENT_ID !== '00000000-0000-0000-0000-000000000000' &&
    process.env.ENTRA_TENANT_ID &&
    process.env.ENTRA_TENANT_ID !== '00000000-0000-0000-0000-000000000000' &&
    process.env.ENTRA_TENANT_SUBDOMAIN &&
    process.env.ENTRA_TENANT_SUBDOMAIN !== 'dummy'
  );

/**
 * Create a new user in Entra External ID via Microsoft Graph.
 *
 * The user is created with a random internal password — they will never use it
 * because they authenticate via Email OTP.  The account is immediately usable
 * for the OTP flow and for SSO via the "Sign in with Microsoft" button.
 *
 * Requires application permission: User.ReadWrite.All
 *
 * @returns {object|null} Entra user object (includes .id) or null in dev mode.
 */
const createEntraUser = async ({ email, displayName, givenName, surname }) => {
  if (!isEntraConfigured()) {
    console.log(`[DEV] Skipping Entra user creation for ${email} – configure ENTRA_* vars to enable.`);
    return null;
  }

  const token = await getGraphToken();
  const tenantDomain = `${process.env.ENTRA_TENANT_SUBDOMAIN}.onmicrosoft.com`;

  const body = {
    displayName: displayName || email.split('@')[0],
    ...(givenName && { givenName }),
    ...(surname   && { surname }),
    identities: [
      {
        signInType:        'emailAddress',
        issuer:            tenantDomain,
        issuerAssignedId:  email,
      },
    ],
    // A random password is required by Graph even for OTP-only accounts.
    // Users will never see or use this password.
    passwordProfile: {
      password:                        generateSecurePassword(),
      forceChangePasswordNextSignIn:   false,
    },
    passwordPolicies: 'DisablePasswordExpiration',
  };

  const response = await fetch(`${GRAPH_BASE}/users`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    // User with this email already exists in Entra – find & return them
    const code = data.error?.code;
    const msg  = data.error?.message || '';
    if (code === 'Request_BadRequest' && msg.toLowerCase().includes('already exists')) {
      console.log(`[Entra] User ${email} already exists in Entra, linking existing account.`);
      return findEntraUserByEmail(email);
    }
    throw new Error(`Microsoft Graph API error: ${msg || response.statusText}`);
  }

  console.log(`[Entra] Created user ${email} in Entra External ID (id: ${data.id})`);
  return data;
};

/**
 * Find an existing Entra user by their email address identity.
 * Returns the user object or null.
 */
const findEntraUserByEmail = async (email) => {
  if (!isEntraConfigured()) return null;

  const token  = await getGraphToken();
  const filter = encodeURIComponent(
    `identities/any(id:id/issuerAssignedId eq '${email}' and id/signInType eq 'emailAddress')`
  );

  const response = await fetch(
    `${GRAPH_BASE}/users?$filter=${filter}&$select=id,displayName,givenName,surname,mail`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data.value?.[0] ?? null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random 24-character password that satisfies
 * Azure AD complexity requirements (upper, lower, digit, special).
 */
const generateSecurePassword = () => {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghijkmnpqrstuvwxyz';
  const digits  = '23456789';
  const special = '!@#$%^&*';
  const all     = upper + lower + digits + special;
  const pick    = (set) => set[crypto.randomInt(set.length)];

  // Guarantee at least one character from each required category
  const chars = [
    pick(upper), pick(lower), pick(digits), pick(special),
    ...Array.from({ length: 20 }, () => pick(all)),
  ];

  // Fisher-Yates shuffle using cryptographically secure randomness
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
};

module.exports = { createEntraUser, findEntraUserByEmail, isEntraConfigured };
