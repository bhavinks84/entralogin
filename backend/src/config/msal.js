const { ConfidentialClientApplication } = require('@azure/msal-node');

// Lazy singleton – only build the MSAL client when env vars are available.
// This avoids crashing during module load in dev environments that haven't
// yet configured the .env file.
let _msalClient = null;

const getMsalClient = () => {
  if (_msalClient) return _msalClient;

  if (!process.env.ENTRA_CLIENT_ID || !process.env.ENTRA_CLIENT_SECRET) {
    throw new Error(
      'Entra External ID is not configured. Set ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ' +
      'ENTRA_TENANT_ID, and ENTRA_TENANT_SUBDOMAIN in your .env file.'
    );
  }

  _msalClient = new ConfidentialClientApplication({
    auth: {
      clientId:     process.env.ENTRA_CLIENT_ID,
      authority:    `https://${process.env.ENTRA_TENANT_SUBDOMAIN}.ciamlogin.com/${process.env.ENTRA_TENANT_ID}`,
      clientSecret: process.env.ENTRA_CLIENT_SECRET,
    },
    system: {
      loggerOptions: {
        loggerCallback(_loglevel, message) {
          if (process.env.NODE_ENV === 'development') {
            console.log(`[MSAL] ${message}`);
          }
        },
        piiLoggingEnabled: false,
        logLevel: 3, // Warning
      },
    },
  });

  return _msalClient;
};

const ENTRA_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

const getAuthCodeUrl = async (state) => {
  return getMsalClient().getAuthCodeUrl({
    scopes: ENTRA_SCOPES,
    redirectUri: process.env.ENTRA_REDIRECT_URI,
    state,
    responseMode: 'query',
  });
};

const acquireTokenByCode = async (code) => {
  return getMsalClient().acquireTokenByCode({
    code,
    scopes: ENTRA_SCOPES,
    redirectUri: process.env.ENTRA_REDIRECT_URI,
  });
};

module.exports = { getMsalClient, getAuthCodeUrl, acquireTokenByCode, ENTRA_SCOPES };
