-- Prodit Database Schema
-- Multi-tenant SaaS architecture for Xero Product & Services Editor

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_users_email ON users(email);

-- Xero connections table (one per user)
CREATE TABLE IF NOT EXISTS xero_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id VARCHAR(255) NOT NULL,
    tenant_name VARCHAR(255),
    encrypted_tokens TEXT NOT NULL,
    encryption_iv VARCHAR(255) NOT NULL,
    encryption_tag VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_synced TIMESTAMP,
    UNIQUE(user_id, tenant_id)
);

CREATE INDEX idx_xero_connections_user_id ON xero_connections(user_id);
CREATE INDEX idx_xero_connections_tenant_id ON xero_connections(tenant_id);

-- Sessions table (for connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (sid) NOT CONSTRAINT session_pkey
);

CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_xero_connections_updated_at BEFORE UPDATE ON xero_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
