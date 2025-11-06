import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import qs from 'qs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

// Import database and auth modules
import { initDatabase, getPool, getXeroConnection, saveXeroConnection, updateXeroTokens, deleteXeroConnection, getAllXeroConnections } from './database/db.js';
import { registerUser, loginUser, requireAuth, attachUser } from './auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database
initDatabase();

const app = express();
app.set('trust proxy', 1); // Trust Railway proxy

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Session configuration with PostgreSQL store
const PgStore = pgSession(session);
app.use(session({
  store: new PgStore({
    pool: getPool(),
    tableName: 'session',
    createTableIfMissing: false // We create it in migration
  }),
  secret: process.env.SESSION_SECRET || 'change_this_in_production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

app.use(attachUser);

// Helper to get public URL
function getPublicURL() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

// ===== AUTHENTICATION ENDPOINTS =====

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    const user = await registerUser({ email, password, fullName });

    req.session.userId = user.id;
    req.session.userEmail = user.email;

    res.json({
      success: true,
      user: { id: user.id, email: user.email, fullName: user.fullName }
    });
  } catch (error) {
    console.error('[Prodit] Registration failed:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await loginUser({ email, password });

    req.session.userId = user.id;
    req.session.userEmail = user.email;

    res.json({
      success: true,
      user: { id: user.id, email: user.email, fullName: user.fullName }
    });
  } catch (error) {
    console.error('[Prodit] Login failed:', error.message);
    res.status(401).json({ error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    id: req.userId,
    email: req.userEmail
  });
});

// ===== XERO OAUTH ENDPOINTS =====

const XERO_AUTH = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN = 'https://identity.xero.com/connect/token';
const XERO_CONN  = 'https://api.xero.com/connections';
const XERO_API   = 'https://api.xero.com/api.xro/2.0';

const scopes = [
  'openid', 'email', 'profile', 'offline_access',
  'accounting.settings.read',
  'accounting.settings',
  'accounting.transactions'
].join(' ');

app.get('/auth/xero', requireAuth, (req, res) => {
  const redirectUri = `${getPublicURL()}/callback`;
  const url = new URL(XERO_AUTH);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.XERO_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', req.userId.toString());

  console.log('[Prodit] Redirecting user to Xero auth...', { userId: req.userId, redirectUri });
  res.redirect(url.toString());
});

app.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  try {
    if (!state || !req.session.userId || state !== req.session.userId.toString()) {
      throw new Error('Invalid state parameter');
    }

    const redirectUri = `${getPublicURL()}/callback`;

    // Exchange code for tokens
    const tokenResp = await axios.post(XERO_TOKEN, qs.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: process.env.XERO_CLIENT_ID,
      client_secret: process.env.XERO_CLIENT_SECRET
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const tokens = tokenResp.data;

    // Get tenant connections
    const conns = await axios.get(XERO_CONN, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    }).then(r => r.data);

    if (!conns || conns.length === 0) {
      return res.status(400).send('<h1>No Xero Organizations Found</h1><p>Please ensure you have access to at least one Xero organization.</p>');
    }

    // Use most recently connected tenant
    const chosen = conns.sort((a, b) => new Date(b.createdDateUtc) - new Date(a.createdDateUtc))[0];

    // Save connection to database
    await saveXeroConnection({
      userId: req.userId,
      tenantId: chosen.tenantId,
      tenantName: chosen.tenantName,
      tokens
    });

    console.log('[Prodit] Connected Xero org:', { userId: req.userId, tenant: chosen.tenantName });

    res.redirect('/?connected=true');
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('[Prodit] OAuth callback failed:', detail);
    res.status(500).send(`<h1>Connection Failed</h1><p>${typeof detail === 'string' ? detail : JSON.stringify(detail)}</p><p><a href="/">Return to app</a></p>`);
  }
});

// ===== XERO API HELPER =====

async function ensureValidToken(userId, tenantId = null) {
  const connection = await getXeroConnection(userId, tenantId);
  if (!connection) {
    throw new Error('No Xero connection found. Please connect your Xero account.');
  }

  const tokens = connection.tokens;

  // Check if access token is still valid (we'll just try to use it and refresh if needed)
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tenantId: connection.tenantId
  };
}

async function refreshAccessToken(userId, tenantId, refreshToken) {
  const tokenResp = await axios.post(XERO_TOKEN, qs.stringify({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.XERO_CLIENT_ID,
    client_secret: process.env.XERO_CLIENT_SECRET
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  const newTokens = tokenResp.data;

  // Update tokens in database
  await updateXeroTokens(userId, tenantId, newTokens);

  return newTokens.access_token;
}

async function xeroRequest(userId, method, urlPath, config = {}) {
  let tokenInfo = await ensureValidToken(userId);

  const makeRequest = async (accessToken) => {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tokenInfo.tenantId,
      Accept: 'application/json',
      ...(config.headers || {})
    };
    return axios({ method, url: `${XERO_API}${urlPath}`, ...config, headers });
  };

  try {
    const resp = await makeRequest(tokenInfo.accessToken);
    return resp.data;
  } catch (err) {
    // If 401, try refreshing token
    if (err.response?.status === 401 && tokenInfo.refreshToken) {
      console.log('[Prodit] Access token expired, refreshing...');
      const newAccessToken = await refreshAccessToken(userId, tokenInfo.tenantId, tokenInfo.refreshToken);
      const retry = await makeRequest(newAccessToken);
      return retry.data;
    }
    throw err;
  }
}

// ===== CONNECTION MANAGEMENT ENDPOINTS =====

app.get('/api/connections', requireAuth, async (req, res) => {
  try {
    const connections = await getAllXeroConnections(req.userId);
    res.json({ connections });
  } catch (error) {
    console.error('[Prodit] Failed to fetch connections:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/connections/:tenantId', requireAuth, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const deleted = await deleteXeroConnection(req.userId, tenantId);
    res.json({ success: deleted });
  } catch (error) {
    console.error('[Prodit] Failed to delete connection:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/status', requireAuth, async (req, res) => {
  try {
    const connection = await getXeroConnection(req.userId);
    res.json({
      connected: Boolean(connection),
      tenantId: connection?.tenantId || null,
      tenantName: connection?.tenantName || null
    });
  } catch (error) {
    res.json({ connected: false, tenantId: null, tenantName: null });
  }
});

// ===== ITEMS/PRODUCTS ENDPOINTS =====

function buildWhere(q) {
  const safe = q.replace(/"/g, '\\"').toLowerCase();
  return [
    `(Code != null AND Code.ToLower().Contains("${safe}"))`,
    `(Name != null AND Name.ToLower().Contains("${safe}"))`,
    `(Description != null AND Description.ToLower().Contains("${safe}"))`
  ].join(' OR ');
}

app.get('/api/items/search', requireAuth, async (req, res) => {
  const q = (req.query.query || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));

  if (q.length < 2) {
    return res.json({ Items: [], Note: 'Type at least 2 characters to search' });
  }

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('order', 'Name');
  params.set('where', buildWhere(q));

  try {
    const data = await xeroRequest(req.userId, 'get', `/Items?${params.toString()}`);
    const list = Array.isArray(data?.Items) ? data.Items : [];
    const Items = list.slice(0, limit);
    res.json({ Items, page, pageSize: limit, returned: Items.length });
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('[Prodit] Items search failed:', detail);
    res.status(500).json({ error: 'items_search_failed', detail });
  }
});

app.post('/api/items/update', requireAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body.Items) ? req.body.Items : [];
    const payload = { Items: items };

    const data = await xeroRequest(req.userId, 'post', '/Items', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload)
    });

    res.json(data);
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('[Prodit] Items update failed:', detail);
    res.status(500).json({ error: 'items_update_failed', detail });
  }
});

app.get('/api/taxrates', requireAuth, async (req, res) => {
  try {
    const data = await xeroRequest(req.userId, 'get', '/TaxRates');
    res.json({
      TaxRates: (data?.TaxRates || []).map(t => ({
        Name: t.Name,
        TaxType: t.TaxType,
        Status: t.Status
      }))
    });
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('[Prodit] Tax rates failed:', detail);
    res.status(500).json({ error: 'taxrates_failed', detail });
  }
});

app.get('/api/accounts', requireAuth, async (req, res) => {
  try {
    const params = new URLSearchParams();
    params.set('where', 'Status=="ACTIVE"');
    params.set('order', 'Code');

    const data = await xeroRequest(req.userId, 'get', `/Accounts?${params.toString()}`);
    res.json({
      Accounts: (data?.Accounts || []).map(a => ({
        AccountID: a.AccountID,
        Code: a.Code,
        Name: a.Name,
        Type: a.Type,
        Status: a.Status
      }))
    });
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('[Prodit] Accounts failed:', detail);
    res.status(500).json({ error: 'accounts_failed', detail });
  }
});

// ===== HEALTH CHECK =====

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'Prodit v3.0',
    environment: process.env.NODE_ENV || 'development',
    publicURL: getPublicURL()
  });
});

// ===== SERVE FRONTEND =====

const distPath = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.log('[Prodit] UI not built yet. Run `npm run build` first or use dev mode with `npm run dev`');
}

// ===== START SERVER =====

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`[Prodit] Server running on ${getPublicURL()}`);
  console.log(`[Prodit] Environment: ${process.env.NODE_ENV || 'development'}`);
});
