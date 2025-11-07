# How Prodit Maintains Permanent Xero OAuth Connection

**Problem:** Xero OAuth access tokens expire after 30 minutes, causing "connection timeout" errors.

**Solution:** Prodit implements automatic token refresh using Xero's refresh tokens, maintaining a permanent connection without requiring users to re-authenticate.

---

## The Problem with 30-Minute Token Expiration

Xero OAuth returns two types of tokens:

1. **Access Token** - Expires after **30 minutes**
2. **Refresh Token** - Valid for **60 days**, used to get new access tokens

Many implementations fail because they:
- Only store the access token
- Don't handle 401 errors (expired token)
- Don't implement refresh token logic
- Require users to reconnect every 30 minutes ❌

---

## How Prodit Solves This

Prodit implements a **3-layer automatic token refresh system**:

### 1️⃣ Store BOTH Tokens (with encryption)
### 2️⃣ Automatic Token Refresh on 401 Errors
### 3️⃣ Centralized API Request Handler

---

## Implementation Details

### Step 1: Initial OAuth Flow (One-Time Setup)

When user connects to Xero, store **BOTH** access_token AND refresh_token:

```javascript
// /callback endpoint - after OAuth authorization
app.get('/callback', async (req, res) => {
  const { code } = req.query;

  // Exchange authorization code for tokens
  const tokenResp = await axios.post('https://identity.xero.com/connect/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: YOUR_CALLBACK_URL,
    client_id: process.env.XERO_CLIENT_ID,
    client_secret: process.env.XERO_CLIENT_SECRET
  });

  const tokens = tokenResp.data;
  // tokens = {
  //   access_token: "...",      // Expires in 30 minutes
  //   refresh_token: "...",     // Valid for 60 days
  //   expires_in: 1800,
  //   token_type: "Bearer"
  // }

  // Get Xero tenant ID
  const connections = await axios.get('https://api.xero.com/connections', {
    headers: { Authorization: \`Bearer \${tokens.access_token}\` }
  });

  const tenantId = connections.data[0].tenantId;

  // ⚠️ CRITICAL: Save BOTH tokens to database
  await saveXeroConnection({
    userId: req.session.userId,
    tenantId,
    tokens  // Contains BOTH access_token and refresh_token
  });
});
```

---

### Step 2: Secure Token Storage (Encrypted in Database)

**Database Schema:**
```sql
CREATE TABLE xero_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  tenant_id VARCHAR(255) NOT NULL,
  tenant_name VARCHAR(255),
  encrypted_tokens TEXT NOT NULL,        -- ✅ Encrypted JSON with both tokens
  encryption_iv VARCHAR(255) NOT NULL,   -- For AES-256-GCM
  encryption_tag VARCHAR(255) NOT NULL,  -- For AES-256-GCM
  is_system_connection BOOLEAN DEFAULT false,
  last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, tenant_id)
);
```

**Encryption (AES-256-GCM):**
```javascript
import crypto from 'crypto';

function encryptTokens(tokens) {
  // tokens = { access_token: "...", refresh_token: "...", expires_in: 1800 }

  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64'); // 32 bytes
  const iv = crypto.randomBytes(12);  // Initialization vector
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const json = JSON.stringify(tokens);
  const encrypted = Buffer.concat([
    cipher.update(json, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64')
  };
}

function decryptTokens(encrypted, iv, tag) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

async function saveXeroConnection({ userId, tenantId, tokens }) {
  const { encrypted, iv, tag } = encryptTokens(tokens);

  await pool.query(`
    INSERT INTO xero_connections (user_id, tenant_id, encrypted_tokens, encryption_iv, encryption_tag)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, tenant_id)
    DO UPDATE SET
      encrypted_tokens = EXCLUDED.encrypted_tokens,
      encryption_iv = EXCLUDED.encryption_iv,
      encryption_tag = EXCLUDED.encryption_tag,
      last_synced = CURRENT_TIMESTAMP
  `, [userId, tenantId, encrypted, iv, tag]);
}
```

**Generate encryption key (run once):**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Output: e.g., "XyZ123...=" (44 characters)
# Store in .env as ENCRYPTION_KEY=XyZ123...=
```

---

### Step 3: Token Refresh Function

When access token expires (30 min), use refresh token to get new access token:

```javascript
async function refreshAccessToken(userId, tenantId, refreshToken) {
  console.log('[OAuth] Refreshing access token...');

  // Call Xero's token endpoint with refresh_token grant
  const tokenResp = await axios.post('https://identity.xero.com/connect/token',
    new URLSearchParams({
      grant_type: 'refresh_token',      // ⚠️ Use refresh_token grant type
      refresh_token: refreshToken,       // ⚠️ Pass the refresh token
      client_id: process.env.XERO_CLIENT_ID,
      client_secret: process.env.XERO_CLIENT_SECRET
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const newTokens = tokenResp.data;
  // newTokens = {
  //   access_token: "NEW_ACCESS_TOKEN",      // Fresh 30-minute token
  //   refresh_token: "NEW_REFRESH_TOKEN",    // Also gets refreshed!
  //   expires_in: 1800
  // }

  // ⚠️ CRITICAL: Save the NEW tokens (both get refreshed!)
  await updateXeroTokens(userId, tenantId, newTokens);

  return newTokens.access_token;
}

async function updateXeroTokens(userId, tenantId, tokens) {
  const { encrypted, iv, tag } = encryptTokens(tokens);

  await pool.query(`
    UPDATE xero_connections
    SET encrypted_tokens = $1,
        encryption_iv = $2,
        encryption_tag = $3,
        last_synced = CURRENT_TIMESTAMP
    WHERE user_id = $4 AND tenant_id = $5
  `, [encrypted, iv, tag, userId, tenantId]);

  console.log('[OAuth] Tokens refreshed and saved');
}
```

---

### Step 4: Centralized API Request Handler (THE KEY!)

**This is the magic that makes it permanent!** Every Xero API call goes through this handler:

```javascript
async function xeroRequest(userId, method, urlPath, config = {}) {
  // 1. Get current tokens from database
  const connection = await getXeroConnection(userId);

  if (!connection) {
    throw new Error('No Xero connection found. Please connect to Xero.');
  }

  // Decrypt tokens
  const tokens = decryptTokens(
    connection.encrypted_tokens,
    connection.encryption_iv,
    connection.encryption_tag
  );

  const tenantId = connection.tenant_id;
  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token;

  // 2. Create request function
  const makeRequest = async (token) => {
    return axios({
      method,
      url: \`https://api.xero.com/api.xro/2.0\${urlPath}\`,
      headers: {
        'Authorization': \`Bearer \${token}\`,
        'xero-tenant-id': tenantId,
        'Accept': 'application/json',
        ...config.headers
      },
      ...config
    });
  };

  // 3. Try request with current access token
  try {
    const response = await makeRequest(accessToken);
    return response.data;
  } catch (error) {
    // 4. If 401 Unauthorized → access token expired
    if (error.response?.status === 401 && refreshToken) {
      console.log('[OAuth] Access token expired (30 min). Auto-refreshing...');

      // 5. Refresh the token automatically
      const newAccessToken = await refreshAccessToken(userId, tenantId, refreshToken);

      // 6. Retry the request with new token
      const retryResponse = await makeRequest(newAccessToken);
      console.log('[OAuth] Request succeeded with refreshed token');

      return retryResponse.data;
    }

    // Other errors (not 401) - rethrow
    throw error;
  }
}
```

**How it works:**

1. **Every API call** uses this function
2. **First attempt** uses stored access token
3. **If 401 error** (token expired after 30 min):
   - Automatically refreshes using refresh token
   - Saves new tokens to database
   - Retries the request with new access token
4. **User never knows** it happened! ✨

---

### Step 5: Use Centralized Handler for All Xero Calls

Instead of calling Xero API directly, **always** use `xeroRequest()`:

```javascript
// ❌ BAD - Direct call (will fail after 30 minutes)
app.get('/api/items', async (req, res) => {
  const accessToken = getStoredAccessToken(); // ❌ Will expire!
  const response = await axios.get('https://api.xero.com/api.xro/2.0/Items', {
    headers: {
      'Authorization': \`Bearer \${accessToken}\`,
      'xero-tenant-id': tenantId
    }
  });
  res.json(response.data);
});

// ✅ GOOD - Use centralized handler (automatic refresh)
app.get('/api/items', async (req, res) => {
  const data = await xeroRequest(req.userId, 'GET', '/Items');
  res.json(data);
});

// ✅ GOOD - POST request with body
app.post('/api/items/update', async (req, res) => {
  const data = await xeroRequest(req.userId, 'POST', '/Items', {
    data: { Items: req.body.Items }
  });
  res.json(data);
});
```

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER CONNECTS TO XERO (ONE TIME)                        │
│    OAuth → Get access_token + refresh_token                │
│    Store BOTH in database (encrypted)                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. USER MAKES API REQUEST (e.g., get products)             │
│    Frontend → Backend → xeroRequest()                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. BACKEND LOADS TOKENS FROM DATABASE                      │
│    Decrypt → access_token, refresh_token                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. TRY API CALL WITH ACCESS TOKEN                          │
│    axios.get(xero_api, { auth: access_token })            │
└─────────────────────────────────────────────────────────────┘
                          ↓
                   ┌─────────────┐
                   │ Success?    │
                   └─────────────┘
                    ↙           ↘
            ✅ YES              ❌ NO (401 Error)
              ↓                      ↓
    Return data to user    ┌──────────────────────┐
                           │ 5. AUTO-REFRESH      │
                           │    Use refresh_token │
                           │    to get NEW tokens │
                           └──────────────────────┘
                                     ↓
                           ┌──────────────────────┐
                           │ 6. SAVE NEW TOKENS   │
                           │    to database       │
                           └──────────────────────┘
                                     ↓
                           ┌──────────────────────┐
                           │ 7. RETRY API CALL    │
                           │    with NEW token    │
                           └──────────────────────┘
                                     ↓
                           Return data to user ✅
```

---

## Key Points for Implementation

### ✅ DO:
1. **Store BOTH tokens** (access + refresh) in database
2. **Encrypt tokens** at rest (AES-256-GCM)
3. **Create centralized API handler** that catches 401 errors
4. **Auto-refresh on 401** using refresh token
5. **Save new tokens** after refresh (BOTH get refreshed!)
6. **Retry failed request** with new access token
7. **Use handler for ALL** Xero API calls

### ❌ DON'T:
1. Only store access token (will expire in 30 min)
2. Store tokens in plain text (security risk)
3. Make direct Xero API calls (bypass refresh logic)
4. Ignore 401 errors (means token expired)
5. Forget to save new tokens after refresh
6. Ask user to reconnect (bad UX)

---

## Testing the Implementation

### Test 1: Normal Operation
```javascript
// Should work immediately
const items = await xeroRequest(userId, 'GET', '/Items');
console.log('Items:', items.length); // ✅ Works
```

### Test 2: After 30 Minutes
```javascript
// Wait 31 minutes, then make request
setTimeout(async () => {
  const items = await xeroRequest(userId, 'GET', '/Items');
  console.log('Items after 30 min:', items.length); // ✅ Still works!
  // Check logs: should see "Access token expired, refreshing..."
}, 31 * 60 * 1000);
```

### Test 3: Multiple Requests
```javascript
// Rapid-fire requests (all should work)
await Promise.all([
  xeroRequest(userId, 'GET', '/Items'),
  xeroRequest(userId, 'GET', '/Accounts'),
  xeroRequest(userId, 'GET', '/TaxRates')
]);
// ✅ All succeed, even if token expired mid-batch
```

---

## Common Mistakes to Avoid

### Mistake 1: Not Saving Refresh Token
```javascript
// ❌ WRONG
const tokens = await getTokensFromXero();
await db.save({ access_token: tokens.access_token }); // Missing refresh_token!

// ✅ CORRECT
await db.save(tokens); // Save entire object (includes refresh_token)
```

### Mistake 2: Not Handling 401 Errors
```javascript
// ❌ WRONG - No error handling
const response = await axios.get(xero_url, { headers });
return response.data; // Will fail after 30 min

// ✅ CORRECT - Catch 401 and refresh
try {
  const response = await axios.get(xero_url, { headers });
  return response.data;
} catch (err) {
  if (err.response?.status === 401) {
    const newToken = await refreshAccessToken();
    // Retry with new token
  }
}
```

### Mistake 3: Not Updating Tokens After Refresh
```javascript
// ❌ WRONG
const newTokens = await refreshAccessToken();
// Forgot to save! Next request will use old expired token

// ✅ CORRECT
const newTokens = await refreshAccessToken();
await updateXeroTokens(userId, tenantId, newTokens); // Save to DB
```

---

## Environment Variables Required

```env
# Xero OAuth App Credentials
XERO_CLIENT_ID=YOUR_XERO_CLIENT_ID
XERO_CLIENT_SECRET=YOUR_XERO_CLIENT_SECRET

# Encryption Key (32 bytes, base64 encoded)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY=your_32_byte_base64_key_here

# Public URL (for OAuth redirect)
PUBLIC_URL=https://your-app.com
```

---

## File Locations in Prodit

For reference, here's where the code lives in Prodit:

- **OAuth Flow**: `server.js` lines 167-232
- **Token Refresh**: `server.js` lines 264-278
- **Centralized Handler**: `server.js` lines 280-307
- **Token Encryption**: `database/db.js` lines 87-122
- **Token Storage**: `database/db.js` lines 124-187

---

## Summary

The secret to **permanent Xero connection**:

1. **Store refresh token** (not just access token)
2. **Centralize all API calls** through one handler
3. **Auto-refresh on 401 errors** (transparent to user)
4. **Save new tokens** after every refresh
5. **Encrypt tokens at rest** for security

Users connect **once** and never have to reconnect! 🎉

---

**Built by Prodit - Powered by Claude Code**
