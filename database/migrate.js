// Database migration script for Prodit
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000
  });

  try {
    console.log('[Prodit] Connecting to database...');
    console.log('[Prodit] DATABASE_URL:', process.env.DATABASE_URL ? 'Set ✓' : 'MISSING ✗');

    const client = await pool.connect();
    console.log('[Prodit] ✓ Database connected');

    console.log('[Prodit] Running database migration...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    await client.query(schema);

    console.log('[Prodit] ✓ Database migration completed successfully');
    client.release();
  } catch (error) {
    console.error('[Prodit] ✗ Migration failed:', error.message);
    console.error('[Prodit] Error code:', error.code);

    // Don't fail if tables already exist
    if (error.message && error.message.includes('already exists')) {
      console.log('[Prodit] Tables already exist - continuing...');
      return;
    }

    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default runMigration;
