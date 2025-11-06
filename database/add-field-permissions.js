// Migration to add field permissions to users
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function addFieldPermissions() {
  const DATABASE_URL = "postgresql://postgres:PbhArTnHeTuwTjgLeRpKWIeYtoMLqTqv@metro.proxy.rlwy.net:15748/railway";

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  try {
    console.log('[Prodit] Connecting to database...');
    const client = await pool.connect();
    console.log('[Prodit] ✓ Connected');

    // Add field_permissions column (JSONB for flexibility)
    console.log('[Prodit] Adding field_permissions column...');
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

    console.log('[Prodit] ✓ Migration complete!');
    client.release();
  } catch (error) {
    console.error('[Prodit] Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

addFieldPermissions()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
