// Migration: Add Multi-Tenancy (Organizations & Xero Instances)
// This migration transforms Prodit from single-tenant to multi-tenant SaaS
import pg from 'pg';

const { Client } = pg;

const DATABASE_URL = 'postgresql://postgres:PbhArTnHeTuwTjgLeRpKWIeYtoMLqTqv@metro.proxy.rlwy.net:15748/railway';

async function migrate() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('[Migration] Connecting to database...');
    await client.connect();
    console.log('[Migration] Connected successfully!');

    // Start transaction
    await client.query('BEGIN');

    // ========================================
    // 1. Create organizations table
    // ========================================
    console.log('[Migration] Creating organizations table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL,
        owner_email VARCHAR(255) NOT NULL,
        account_type VARCHAR(50) DEFAULT 'company', -- 'company' or 'accountant'
        trial_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        trial_end_date TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '14 days'),
        subscription_status VARCHAR(50) DEFAULT 'trial', -- trial, active, expired, cancelled
        subscription_start_date TIMESTAMP,
        subscription_end_date TIMESTAMP,
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_owner_email ON organizations(owner_email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_subscription_status ON organizations(subscription_status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_deleted_at ON organizations(deleted_at)
    `);

    // ========================================
    // 2. Create xero_instances table
    // ========================================
    console.log('[Migration] Creating xero_instances table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS xero_instances (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        xero_tenant_id VARCHAR(255) UNIQUE NOT NULL,
        xero_tenant_name VARCHAR(255),
        connection_status VARCHAR(50) DEFAULT 'connected', -- connected, disconnected
        encrypted_tokens TEXT,
        encryption_iv VARCHAR(255),
        encryption_tag VARCHAR(255),
        connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        disconnected_at TIMESTAMP,
        last_accessed TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_xero_instances_organization_id ON xero_instances(organization_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_xero_instances_tenant_id ON xero_instances(xero_tenant_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_xero_instances_connection_status ON xero_instances(connection_status)
    `);

    // ========================================
    // 3. Add new columns to users table
    // ========================================
    console.log('[Migration] Updating users table...');

    // Add organization_id
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE
    `);

    // Add is_super_admin
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false
    `);

    // Add email verification fields
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255)
    `);
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP
    `);

    // Add field_permissions if not exists (from previous migration)
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS field_permissions JSONB DEFAULT '{
        "code": true,
        "name": true,
        "description": true,
        "salePrice": true,
        "salesAccount": true,
        "salesTax": true,
        "costPrice": true,
        "purchaseAccount": true,
        "purchaseTax": true,
        "status": true
      }'::jsonb
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_is_super_admin ON users(is_super_admin)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users(email_verified)
    `);

    // ========================================
    // 4. Create audit_logs table
    // ========================================
    console.log('[Migration] Creating audit_logs table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        super_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        super_admin_email VARCHAR(255) NOT NULL,
        action VARCHAR(100) NOT NULL, -- 'extend_trial', 'delete_org', 'impersonate', etc.
        target_type VARCHAR(50), -- 'organization', 'user', 'subscription'
        target_id INTEGER,
        details JSONB,
        ip_address VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_super_admin_id ON audit_logs(super_admin_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)
    `);

    // ========================================
    // 5. Migrate existing data
    // ========================================
    console.log('[Migration] Checking for existing data to migrate...');

    const existingUsers = await client.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(existingUsers.rows[0].count);

    if (userCount > 0) {
      console.log(`[Migration] Found ${userCount} existing users. Creating default organization...`);

      // Create a default organization for existing users
      const orgResult = await client.query(`
        INSERT INTO organizations (
          company_name,
          owner_email,
          account_type,
          subscription_status,
          subscription_start_date,
          subscription_end_date
        ) VALUES (
          'Legacy Organization',
          'admin@prodit.app',
          'company',
          'active',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP + INTERVAL '1 year'
        ) RETURNING id
      `);

      const defaultOrgId = orgResult.rows[0].id;
      console.log(`[Migration] Created default organization ID: ${defaultOrgId}`);

      // Assign all existing users to this organization
      await client.query(`
        UPDATE users
        SET organization_id = $1, email_verified = true
        WHERE organization_id IS NULL
      `, [defaultOrgId]);

      console.log('[Migration] Assigned all existing users to default organization');

      // Migrate existing Xero connections to xero_instances
      const existingConnections = await client.query(`
        SELECT * FROM xero_connections WHERE is_system_connection = true LIMIT 1
      `);

      if (existingConnections.rows.length > 0) {
        console.log('[Migration] Migrating existing Xero connection...');
        const conn = existingConnections.rows[0];

        await client.query(`
          INSERT INTO xero_instances (
            organization_id,
            xero_tenant_id,
            xero_tenant_name,
            encrypted_tokens,
            encryption_iv,
            encryption_tag,
            connected_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          defaultOrgId,
          conn.tenant_id,
          conn.tenant_name,
          conn.encrypted_tokens,
          conn.encryption_iv,
          conn.encryption_tag,
          conn.created_at
        ]);

        console.log('[Migration] Xero connection migrated to xero_instances');
      }
    } else {
      console.log('[Migration] No existing users found. Fresh installation.');
    }

    // ========================================
    // 6. Add triggers for updated_at
    // ========================================
    console.log('[Migration] Adding triggers...');

    await client.query(`
      CREATE TRIGGER update_organizations_updated_at
      BEFORE UPDATE ON organizations
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);

    await client.query(`
      CREATE TRIGGER update_xero_instances_updated_at
      BEFORE UPDATE ON xero_instances
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);

    // Commit transaction
    await client.query('COMMIT');

    console.log('[Migration] ✓ Multi-tenancy migration complete!');
    console.log('[Migration] New tables created:');
    console.log('  - organizations');
    console.log('  - xero_instances');
    console.log('  - audit_logs');
    console.log('[Migration] Users table updated with:');
    console.log('  - organization_id');
    console.log('  - is_super_admin');
    console.log('  - email_verified');
    console.log('  - email_verification_token');
    console.log('  - field_permissions');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Migration] ✗ Migration failed:', error.message);
    console.error(error);
    throw error;
  } finally {
    await client.end();
  }
}

migrate()
  .then(() => {
    console.log('\n[Migration] Database is now multi-tenant ready!');
    process.exit(0);
  })
  .catch(() => {
    process.exit(1);
  });
