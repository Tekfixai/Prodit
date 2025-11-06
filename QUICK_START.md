# Prodit Quick Start Guide

## 🚀 Get Running in 5 Minutes

### Option 1: Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Edit .env with your values
notepad .env  # Windows
nano .env     # Linux/Mac

# 4. Generate encryption key
# PowerShell (Windows):
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))

# Bash (Linux/Mac):
openssl rand -base64 32

# 5. Set up PostgreSQL database
# Install PostgreSQL locally or use a cloud service
# Update DATABASE_URL in .env

# 6. Run database migrations
npm run migrate

# 7. Start development server
npm run dev
```

Visit `http://localhost:3000`

---

### Option 2: Deploy to Railway (Production)

```bash
# 1. Push code to GitHub (already done!)
# Repository: https://github.com/Tekfixai/Prodit.git

# 2. Create Railway account
# Visit: https://railway.app

# 3. Create new project from GitHub
# Select: Tekfixai/Prodit

# 4. Add PostgreSQL database
# Railway Dashboard → New → Database → PostgreSQL

# 5. Set environment variables in Railway:
XERO_CLIENT_ID=your_xero_client_id
XERO_CLIENT_SECRET=your_xero_client_secret
SESSION_SECRET=generate_random_string
PRODIT_TOKEN_KEY=generate_with_openssl
NODE_ENV=production

# 6. Deploy automatically happens!

# 7. Get your Railway domain
# Example: prodit-production.up.railway.app

# 8. Update Xero redirect URI
# https://developer.xero.com/app/manage
# Add: https://your-domain.railway.app/callback
```

---

## 📋 Command Reference

### Development
```bash
npm run dev          # Start dev server (client + server)
npm run server       # Start server only
npm run client       # Start client only (Vite)
npm run build        # Build client for production
```

### Database
```bash
npm run migrate      # Run database migrations
```

### Production
```bash
npm start            # Build and start production server
npm run railway:build    # Railway build command
npm run railway:start    # Railway start command (includes migration)
```

---

## 🔑 Environment Variables Explained

| Variable | Purpose | How to Generate |
|----------|---------|----------------|
| `DATABASE_URL` | PostgreSQL connection | Railway provides automatically |
| `XERO_CLIENT_ID` | Xero OAuth app ID | From Xero developer portal |
| `XERO_CLIENT_SECRET` | Xero OAuth secret | From Xero developer portal |
| `SESSION_SECRET` | Session encryption | `openssl rand -hex 32` |
| `PRODIT_TOKEN_KEY` | Token encryption (32-byte) | `openssl rand -base64 32` |
| `NODE_ENV` | Environment mode | `development` or `production` |
| `PORT` | Server port | Default: 3000 |
| `PUBLIC_URL` | Custom domain (optional) | Your domain URL |

---

## 🧪 Quick Test

After setup, test that everything works:

1. **Visit the app** - You should see the login page
2. **Sign up** - Create a new account
3. **Login** - Sign in with your credentials
4. **Connect Xero** - Click "Connect Xero Account"
5. **Authorize** - Approve access in Xero
6. **Search** - Try searching for a product
7. **Edit** - Make a change and save

---

## 🐛 Quick Troubleshooting

### "Cannot connect to database"
- Check `DATABASE_URL` is set correctly
- Verify PostgreSQL is running
- Run `npm run migrate` to create tables

### "Invalid Xero credentials"
- Verify `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET`
- Check Xero developer portal for correct values
- No spaces or line breaks in credentials

### "Redirect URI mismatch"
- Update Xero app redirect URI
- Must match exactly: `http://localhost:3000/callback` (dev) or `https://your-domain/callback` (prod)

### "Invalid encryption key"
- `PRODIT_TOKEN_KEY` must be exactly 44 characters
- Generate with: `openssl rand -base64 32`
- Check for no spaces or line breaks

### Build errors
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## 📚 Full Documentation

- `README.md` - Project overview
- `DEPLOYMENT.md` - Complete deployment guide
- `XERO_SETUP.md` - Xero app configuration
- `MIGRATION_SUMMARY.md` - What changed from v2 to v3

---

## 🆘 Need Help?

1. Check the full documentation above
2. Review Railway logs (if deployed)
3. Check Xero API status: https://status.developer.xero.com
4. Open an issue on GitHub

---

## ✅ You're Ready!

That's it! You now have a fully functional multi-tenant Xero product editor.

**Happy editing!** 🎉
