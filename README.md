# Prodit

**Multi-tenant Xero Products & Services Editor (SaaS)**

Prodit is a web application that allows users to easily manage and edit their Xero Products & Services catalog. Built as a multi-tenant SaaS platform, each user can sign up, connect their Xero organization, and manage their product catalog with an intuitive interface.

## Features

- **User Authentication**: Secure signup/login system with bcrypt password hashing
- **Multi-tenant Architecture**: Each user manages their own Xero connection
- **Xero OAuth Integration**: Secure OAuth 2.0 connection to Xero
- **Encrypted Token Storage**: AES-256-GCM encryption for Xero tokens
- **Product Catalog Editor**: Search, edit, and bulk-update Xero Items
- **Dark Mode**: Toggle between light and dark themes
- **Responsive Design**: Works on desktop and mobile
- **PostgreSQL Database**: Persistent storage for users and connections

## Tech Stack

- **Backend**: Node.js, Express, PostgreSQL
- **Frontend**: React, Vite
- **Authentication**: bcrypt, express-session
- **Database**: PostgreSQL with pg driver
- **Encryption**: Native Node.js crypto (AES-256-GCM)
- **Deployment**: Railway

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Xero Developer Account

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/Tekfixai/Prodit.git
cd Prodit
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your values
```

4. Generate encryption key:
```bash
# Linux/Mac:
openssl rand -base64 32

# Windows PowerShell:
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

5. Create PostgreSQL database and run migrations:
```bash
npm run migrate
```

6. Start development server:
```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Production Deployment on Railway

1. **Create Railway Project**:
   - Visit [railway.app](https://railway.app)
   - Create new project
   - Add PostgreSQL database service

2. **Configure Environment Variables** in Railway:
   ```
   DATABASE_URL=(automatically provided by Railway)
   XERO_CLIENT_ID=your_xero_client_id
   XERO_CLIENT_SECRET=your_xero_client_secret
   SESSION_SECRET=generate_random_string
   PRODIT_TOKEN_KEY=generate_with_openssl
   NODE_ENV=production
   ```

3. **Update Xero OAuth Settings**:
   - Go to [https://developer.xero.com](https://developer.xero.com)
   - Edit your Xero app
   - Add redirect URI: `https://your-railway-domain.up.railway.app/callback`

4. **Deploy**:
   ```bash
   # Connect to Railway and deploy
   railway link
   railway up
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `XERO_CLIENT_ID` | Xero OAuth Client ID | Yes |
| `XERO_CLIENT_SECRET` | Xero OAuth Client Secret | Yes |
| `SESSION_SECRET` | Session encryption key | Yes |
| `PRODIT_TOKEN_KEY` | Token encryption key (32-byte base64) | Yes |
| `NODE_ENV` | Environment (development/production) | No |
| `PORT` | Server port (default: 3000) | No |
| `PUBLIC_URL` | Custom domain URL | No |

## Xero Setup

1. Go to [https://developer.xero.com/app/manage](https://developer.xero.com/app/manage)
2. Create a new app or use existing
3. Set OAuth 2.0 redirect URI to your deployment URL + `/callback`
4. Required scopes:
   - `openid`
   - `email`
   - `profile`
   - `offline_access`
   - `accounting.settings`
   - `accounting.settings.read`
   - `accounting.transactions`

## Security

- Passwords hashed with bcrypt (10 rounds)
- Xero tokens encrypted with AES-256-GCM
- HTTP-only secure session cookies
- Rate limiting on all endpoints
- SQL injection protection via parameterized queries
- CSRF protection via sameSite cookies

## License

Proprietary - All Rights Reserved

## Support

For issues or questions, please open an issue on GitHub.

---

**Prodit** - Making Xero product management simple.
