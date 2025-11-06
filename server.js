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
import { initDatabase, getPool, getXeroConnection, saveXeroConnection, updateXeroTokens, deleteXeroConnection, getAllXeroConnections, getSystemXeroConnection, deleteSystemXeroConnection, getAllUsers, updateUserActiveStatus, deleteUser, createUser } from './database/db.js';
import { registerUser, loginUser, requireAuth, requireAdmin, attachUser, hashPassword } from './auth.js';

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
    req.session.isAdmin = user.isAdmin;

    res.json({
      success: true,
      user: { id: user.id, email: user.email, fullName: user.fullName, isAdmin: user.isAdmin }
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
    req.session.isAdmin = user.isAdmin;

    res.json({
      success: true,
      user: { id: user.id, email: user.email, fullName: user.fullName, isAdmin: user.isAdmin }
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
    email: req.userEmail,
    isAdmin: req.isAdmin || false
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
    // If user is admin, mark as system connection
    await saveXeroConnection({
      userId: req.userId,
      tenantId: chosen.tenantId,
      tenantName: chosen.tenantName,
      tokens,
      isSystemConnection: req.isAdmin || false
    });

    console.log('[Prodit] Connected Xero org:', { userId: req.userId, tenant: chosen.tenantName, isSystemConnection: req.isAdmin });

    // Redirect to admin dashboard if admin, otherwise to main app
    const redirectPath = req.isAdmin ? '/admin?connected=true' : '/?connected=true';
    res.redirect(redirectPath);
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('[Prodit] OAuth callback failed:', detail);
    res.status(500).send(`<h1>Connection Failed</h1><p>${typeof detail === 'string' ? detail : JSON.stringify(detail)}</p><p><a href="/">Return to app</a></p>`);
  }
});

// ===== XERO API HELPER =====

async function ensureValidToken(userId, isAdmin, tenantId = null) {
  // If not admin, use system-wide connection
  let connection;
  if (isAdmin) {
    connection = await getXeroConnection(userId, tenantId);
  } else {
    connection = await getSystemXeroConnection();
  }

  if (!connection) {
    const message = isAdmin
      ? 'No Xero connection found. Please connect your Xero account.'
      : 'System Xero connection not configured. Please contact your administrator.';
    throw new Error(message);
  }

  const tokens = connection.tokens;

  // Check if access token is still valid (we'll just try to use it and refresh if needed)
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tenantId: connection.tenantId,
    connectionUserId: connection.userId
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

async function xeroRequest(userId, isAdmin, method, urlPath, config = {}) {
  let tokenInfo = await ensureValidToken(userId, isAdmin);

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
      // Use the connection owner's userId for token refresh
      const newAccessToken = await refreshAccessToken(tokenInfo.connectionUserId, tokenInfo.tenantId, tokenInfo.refreshToken);
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
    // Admin checks their own connection, regular users check system connection
    const connection = req.isAdmin
      ? await getXeroConnection(req.userId)
      : await getSystemXeroConnection();

    res.json({
      connected: Boolean(connection),
      tenantId: connection?.tenantId || null,
      tenantName: connection?.tenantName || null,
      isSystemConnection: !req.isAdmin
    });
  } catch (error) {
    res.json({ connected: false, tenantId: null, tenantName: null, isSystemConnection: !req.isAdmin });
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
    const data = await xeroRequest(req.userId, req.isAdmin, 'get', `/Items?${params.toString()}`);
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

    const data = await xeroRequest(req.userId, req.isAdmin, 'post', '/Items', {
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
    const data = await xeroRequest(req.userId, req.isAdmin, 'get', '/TaxRates');
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

    const data = await xeroRequest(req.userId, req.isAdmin, 'get', `/Accounts?${params.toString()}`);
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

// ===== ADMIN API ENDPOINTS =====

// Get all users (admin only)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (error) {
    console.error('[Prodit] Failed to fetch users:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Create a new user (admin only)
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { email, password, fullName, isAdmin } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const user = await createUser({
      email: email.toLowerCase(),
      passwordHash,
      fullName: fullName || null,
      isAdmin: Boolean(isAdmin) // Allow admins to create other admin users
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        isAdmin: user.is_admin,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('[Prodit] Failed to create user:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Update user details (admin only)
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { email, fullName, password, isAdmin } = req.body;

    // Validate input
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    if (password && password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const pool = getPool();

    // Build update query dynamically based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (email) {
      updates.push(`email = $${paramCount++}`);
      values.push(email.toLowerCase());
    }

    if (fullName !== undefined) {
      updates.push(`full_name = $${paramCount++}`);
      values.push(fullName || null);
    }

    if (password) {
      const passwordHash = await hashPassword(password);
      updates.push(`password_hash = $${paramCount++}`);
      values.push(passwordHash);
    }

    if (typeof isAdmin === 'boolean') {
      updates.push(`is_admin = $${paramCount++}`);
      values.push(isAdmin);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    const query = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, email, full_name, is_admin, created_at
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: result.rows[0].id,
        email: result.rows[0].email,
        fullName: result.rows[0].full_name,
        isAdmin: result.rows[0].is_admin,
        createdAt: result.rows[0].created_at
      }
    });
  } catch (error) {
    console.error('[Prodit] Failed to update user:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Update user active status (admin only)
app.put('/api/admin/users/:id/status', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    // Prevent admin from deactivating themselves
    if (userId === req.userId && !isActive) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    await updateUserActiveStatus(userId, isActive);
    res.json({ success: true });
  } catch (error) {
    console.error('[Prodit] Failed to update user status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent admin from deleting themselves
    if (userId === req.userId) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const deleted = await deleteUser(userId);
    res.json({ success: deleted });
  } catch (error) {
    console.error('[Prodit] Failed to delete user:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get system Xero connection status (admin only)
app.get('/api/admin/xero/status', requireAdmin, async (req, res) => {
  try {
    const connection = await getSystemXeroConnection();
    res.json({
      connected: Boolean(connection),
      tenantId: connection?.tenantId || null,
      tenantName: connection?.tenantName || null,
      lastSynced: connection?.lastSynced || null
    });
  } catch (error) {
    res.json({ connected: false, tenantId: null, tenantName: null, lastSynced: null });
  }
});

// Disconnect system Xero connection (admin only)
app.delete('/api/admin/xero/disconnect', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteSystemXeroConnection();
    res.json({ success: deleted });
  } catch (error) {
    console.error('[Prodit] Failed to disconnect Xero:', error.message);
    res.status(500).json({ error: error.message });
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
