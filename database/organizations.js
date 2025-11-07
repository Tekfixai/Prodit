// Organization and Multi-Tenancy Helper Functions
import { getPool } from './db.js';
import crypto from 'crypto';

// ===== ORGANIZATION MANAGEMENT =====

/**
 * Create a new organization (tenant)
 * @param {Object} data - Organization data
 * @param {string} data.companyName - Company name
 * @param {string} data.ownerEmail - Owner's email address
 * @param {string} data.accountType - 'company' or 'accountant'
 * @returns {Promise<Object>} Created organization
 */
export async function createOrganization({ companyName, ownerEmail, accountType = 'company' }) {
  const pool = getPool();

  const result = await pool.query(`
    INSERT INTO organizations (company_name, owner_email, account_type)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [companyName, ownerEmail, accountType]);

  return result.rows[0];
}

/**
 * Get organization by ID
 */
export async function getOrganizationById(orgId) {
  const pool = getPool();
  const result = await pool.query(
    'SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL',
    [orgId]
  );
  return result.rows[0];
}

/**
 * Get all organizations (for super admin)
 */
export async function getAllOrganizations() {
  const pool = getPool();
  const result = await pool.query(`
    SELECT
      o.*,
      COUNT(DISTINCT u.id) as user_count,
      COUNT(DISTINCT xi.id) as xero_instance_count
    FROM organizations o
    LEFT JOIN users u ON u.organization_id = o.id
    LEFT JOIN xero_instances xi ON xi.organization_id = o.id
    WHERE o.deleted_at IS NULL
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `);
  return result.rows;
}

/**
 * Get organizations where a user is an admin (for org switcher)
 */
export async function getUserOrganizations(userId) {
  const pool = getPool();
  const result = await pool.query(`
    SELECT o.*
    FROM organizations o
    INNER JOIN users u ON u.organization_id = o.id
    WHERE u.id = $1 AND u.is_admin = true AND o.deleted_at IS NULL
    ORDER BY o.company_name
  `, [userId]);
  return result.rows;
}

/**
 * Check if organization trial has expired
 */
export function isTrialExpired(organization) {
  if (!organization) return true;
  if (organization.subscription_status === 'active') return false;
  if (organization.subscription_status === 'trial') {
    const now = new Date();
    const trialEnd = new Date(organization.trial_end_date);
    return now > trialEnd;
  }
  return true; // expired or cancelled
}

/**
 * Check if organization can access the system
 */
export function canAccessSystem(organization) {
  if (!organization) return false;
  if (organization.subscription_status === 'active') return true;
  if (organization.subscription_status === 'trial') {
    return !isTrialExpired(organization);
  }
  return false;
}

/**
 * Extend organization trial
 */
export async function extendTrial(orgId, additionalDays) {
  const pool = getPool();

  const result = await pool.query(`
    UPDATE organizations
    SET trial_end_date = GREATEST(trial_end_date, CURRENT_TIMESTAMP) + INTERVAL '${additionalDays} days'
    WHERE id = $1
    RETURNING *
  `, [orgId]);

  return result.rows[0];
}

/**
 * Activate organization subscription
 */
export async function activateSubscription(orgId, stripeCustomerId, stripeSubscriptionId) {
  const pool = getPool();

  const result = await pool.query(`
    UPDATE organizations
    SET
      subscription_status = 'active',
      subscription_start_date = CURRENT_TIMESTAMP,
      subscription_end_date = CURRENT_TIMESTAMP + INTERVAL '1 year',
      stripe_customer_id = $2,
      stripe_subscription_id = $3
    WHERE id = $1
    RETURNING *
  `, [orgId, stripeCustomerId, stripeSubscriptionId]);

  return result.rows[0];
}

/**
 * Cancel organization subscription
 */
export async function cancelSubscription(orgId) {
  const pool = getPool();

  const result = await pool.query(`
    UPDATE organizations
    SET subscription_status = 'cancelled'
    WHERE id = $1
    RETURNING *
  `, [orgId]);

  return result.rows[0];
}

/**
 * Delete organization (soft delete)
 */
export async function deleteOrganization(orgId) {
  const pool = getPool();

  const result = await pool.query(`
    UPDATE organizations
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [orgId]);

  return result.rows[0];
}

// ===== XERO INSTANCE MANAGEMENT =====

/**
 * Create or update Xero instance for organization
 */
export async function saveXeroInstance({ organizationId, tenantId, tenantName, encryptedTokens, iv, tag }) {
  const pool = getPool();

  // Check if instance exists
  const existing = await pool.query(
    'SELECT id FROM xero_instances WHERE organization_id = $1 AND xero_tenant_id = $2',
    [organizationId, tenantId]
  );

  if (existing.rows.length > 0) {
    // Update existing
    const result = await pool.query(`
      UPDATE xero_instances
      SET
        xero_tenant_name = $1,
        encrypted_tokens = $2,
        encryption_iv = $3,
        encryption_tag = $4,
        connection_status = 'connected',
        last_accessed = CURRENT_TIMESTAMP
      WHERE organization_id = $5 AND xero_tenant_id = $6
      RETURNING *
    `, [tenantName, encryptedTokens, iv, tag, organizationId, tenantId]);
    return result.rows[0];
  } else {
    // Create new
    const result = await pool.query(`
      INSERT INTO xero_instances (
        organization_id, xero_tenant_id, xero_tenant_name,
        encrypted_tokens, encryption_iv, encryption_tag
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [organizationId, tenantId, tenantName, encryptedTokens, iv, tag]);
    return result.rows[0];
  }
}

/**
 * Get Xero instance for organization
 */
export async function getXeroInstance(organizationId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM xero_instances
     WHERE organization_id = $1 AND connection_status = 'connected'
     ORDER BY connected_at DESC
     LIMIT 1`,
    [organizationId]
  );
  return result.rows[0];
}

/**
 * Get all Xero instances for organization
 */
export async function getAllXeroInstances(organizationId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM xero_instances
     WHERE organization_id = $1
     ORDER BY connected_at DESC`,
    [organizationId]
  );
  return result.rows;
}

/**
 * Update Xero instance tokens
 */
export async function updateXeroInstanceTokens(xeroInstanceId, encryptedTokens, iv, tag) {
  const pool = getPool();
  const result = await pool.query(`
    UPDATE xero_instances
    SET
      encrypted_tokens = $1,
      encryption_iv = $2,
      encryption_tag = $3,
      last_accessed = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING *
  `, [encryptedTokens, iv, tag, xeroInstanceId]);
  return result.rows[0];
}

/**
 * Disconnect Xero instance
 */
export async function disconnectXeroInstance(xeroInstanceId) {
  const pool = getPool();
  const result = await pool.query(`
    UPDATE xero_instances
    SET
      connection_status = 'disconnected',
      disconnected_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [xeroInstanceId]);
  return result.rows[0];
}

// ===== EMAIL VERIFICATION =====

/**
 * Generate email verification token
 */
export function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Set email verification token for user
 */
export async function setEmailVerificationToken(userId) {
  const pool = getPool();
  const token = generateVerificationToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await pool.query(`
    UPDATE users
    SET
      email_verification_token = $1,
      email_verification_expires = $2
    WHERE id = $3
  `, [token, expires, userId]);

  return token;
}

/**
 * Verify email with token
 */
export async function verifyEmail(token) {
  const pool = getPool();

  const result = await pool.query(`
    UPDATE users
    SET
      email_verified = true,
      email_verification_token = NULL,
      email_verification_expires = NULL
    WHERE
      email_verification_token = $1
      AND email_verification_expires > CURRENT_TIMESTAMP
    RETURNING id, email
  `, [token]);

  return result.rows[0];
}

// ===== AUDIT LOGGING =====

/**
 * Log super admin action
 */
export async function logAuditAction({ superAdminId, superAdminEmail, action, targetType, targetId, details, ipAddress }) {
  const pool = getPool();

  await pool.query(`
    INSERT INTO audit_logs (
      super_admin_id, super_admin_email, action, target_type, target_id, details, ip_address
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [superAdminId, superAdminEmail, action, targetType, targetId, JSON.stringify(details), ipAddress]);
}

/**
 * Get audit logs
 */
export async function getAuditLogs(limit = 100, offset = 0) {
  const pool = getPool();
  const result = await pool.query(`
    SELECT * FROM audit_logs
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return result.rows;
}
