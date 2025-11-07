// Database layer for Prodit
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

let pool;

export function initDatabase() {
  if (pool) return pool;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    console.error('[Prodit] Unexpected database error:', err);
  });

  return pool;
}

export function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initDatabase() first.');
  }
  return pool;
}

// ===== USER OPERATIONS =====

export async function createUser({ email, passwordHash, fullName, organizationId, isAdmin = false }) {
  const query = `
    INSERT INTO users (email, password_hash, full_name, organization_id, is_admin, email_verified)
    VALUES ($1, $2, $3, $4, $5, false)
    RETURNING id, email, full_name, organization_id, is_admin, created_at
  `;
  const result = await pool.query(query, [email, passwordHash, fullName, organizationId, isAdmin]);
  return result.rows[0];
}

export async function findUserByEmail(email) {
  const query = 'SELECT * FROM users WHERE email = $1 AND is_active = true';
  const result = await pool.query(query, [email]);
  return result.rows[0] || null;
}

export async function findUserById(id) {
  const query = 'SELECT id, email, full_name, organization_id, is_admin, is_super_admin, email_verified, created_at, last_login FROM users WHERE id = $1 AND is_active = true';
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

export async function getAllUsers() {
  const query = 'SELECT id, email, full_name, is_admin, created_at, last_login, is_active FROM users ORDER BY created_at DESC';
  const result = await pool.query(query);
  return result.rows;
}

export async function updateUserActiveStatus(userId, isActive) {
  const query = 'UPDATE users SET is_active = $1 WHERE id = $2';
  await pool.query(query, [isActive, userId]);
}

export async function deleteUser(userId) {
  const query = 'DELETE FROM users WHERE id = $1';
  const result = await pool.query(query, [userId]);
  return result.rowCount > 0;
}

export async function updateUserLastLogin(userId) {
  const query = 'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1';
  await pool.query(query, [userId]);
}

// ===== XERO CONNECTION OPERATIONS =====

export function encryptTokens(tokens) {
  const ENC_KEY_B64 = process.env.PREDITOR_TOKEN_KEY || process.env.PRODIT_TOKEN_KEY;
  if (!ENC_KEY_B64) {
    throw new Error('Encryption key not configured (PRODIT_TOKEN_KEY)');
  }

  const key = Buffer.from(ENC_KEY_B64, 'base64');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length. Must be 32 bytes (base64 encoded).');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = Buffer.from(JSON.stringify(tokens), 'utf8');
  const encrypted = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64')
  };
}

export function decryptTokens(encrypted, iv, tag) {
  const ENC_KEY_B64 = process.env.PREDITOR_TOKEN_KEY || process.env.PRODIT_TOKEN_KEY;
  if (!ENC_KEY_B64) {
    throw new Error('Encryption key not configured (PRODIT_TOKEN_KEY)');
  }

  const key = Buffer.from(ENC_KEY_B64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

export async function saveXeroConnection({ userId, tenantId, tenantName, tokens, isSystemConnection = false }) {
  const { encrypted, iv, tag } = encryptTokens(tokens);

  const query = `
    INSERT INTO xero_connections (user_id, tenant_id, tenant_name, encrypted_tokens, encryption_iv, encryption_tag, is_system_connection, last_synced)
    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, tenant_id)
    DO UPDATE SET
      tenant_name = EXCLUDED.tenant_name,
      encrypted_tokens = EXCLUDED.encrypted_tokens,
      encryption_iv = EXCLUDED.encryption_iv,
      encryption_tag = EXCLUDED.encryption_tag,
      is_system_connection = EXCLUDED.is_system_connection,
      last_synced = CURRENT_TIMESTAMP
    RETURNING id, tenant_id, tenant_name
  `;

  const result = await pool.query(query, [userId, tenantId, tenantName, encrypted, iv, tag, isSystemConnection]);
  return result.rows[0];
}

export async function getXeroConnection(userId, tenantId = null) {
  let query, params;

  if (tenantId) {
    query = `
      SELECT * FROM xero_connections
      WHERE user_id = $1 AND tenant_id = $2
      ORDER BY last_synced DESC
      LIMIT 1
    `;
    params = [userId, tenantId];
  } else {
    // Get most recently synced connection for user
    query = `
      SELECT * FROM xero_connections
      WHERE user_id = $1
      ORDER BY last_synced DESC
      LIMIT 1
    `;
    params = [userId];
  }

  const result = await pool.query(query, params);
  if (!result.rows[0]) return null;

  const row = result.rows[0];
  const tokens = decryptTokens(row.encrypted_tokens, row.encryption_iv, row.encryption_tag);

  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tokens,
    lastSynced: row.last_synced
  };
}

export async function getAllXeroConnections(userId) {
  const query = `
    SELECT id, tenant_id, tenant_name, last_synced, created_at
    FROM xero_connections
    WHERE user_id = $1
    ORDER BY last_synced DESC
  `;

  const result = await pool.query(query, [userId]);
  return result.rows;
}

export async function deleteXeroConnection(userId, tenantId) {
  const query = 'DELETE FROM xero_connections WHERE user_id = $1 AND tenant_id = $2';
  const result = await pool.query(query, [userId, tenantId]);
  return result.rowCount > 0;
}

export async function updateXeroTokens(userId, tenantId, tokens) {
  const { encrypted, iv, tag } = encryptTokens(tokens);

  const query = `
    UPDATE xero_connections
    SET encrypted_tokens = $1, encryption_iv = $2, encryption_tag = $3, last_synced = CURRENT_TIMESTAMP
    WHERE user_id = $4 AND tenant_id = $5
  `;

  await pool.query(query, [encrypted, iv, tag, userId, tenantId]);
}

// ===== SYSTEM-WIDE XERO CONNECTION (for admin) =====

export async function getSystemXeroConnection() {
  const query = `
    SELECT * FROM xero_connections
    WHERE is_system_connection = true
    ORDER BY last_synced DESC
    LIMIT 1
  `;

  const result = await pool.query(query);
  if (!result.rows[0]) return null;

  const row = result.rows[0];
  const tokens = decryptTokens(row.encrypted_tokens, row.encryption_iv, row.encryption_tag);

  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tokens,
    lastSynced: row.last_synced
  };
}

export async function deleteSystemXeroConnection() {
  const query = 'DELETE FROM xero_connections WHERE is_system_connection = true';
  const result = await pool.query(query);
  return result.rowCount > 0;
}
