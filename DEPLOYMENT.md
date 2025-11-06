# Prodit Deployment Guide

## Complete Railway Deployment Instructions

### Step 1: Prepare Your Code

1. **Update `.env.example`** with your values (this is just a template - don't commit real credentials)

2. **Build locally to test** (optional but recommended):
```bash
npm install
npm run build
```

### Step 2: Set Up Xero Developer App

1. Go to [https://developer.xero.com/app/manage](https://developer.xero.com/app/manage)
2. Click **New app** or select an existing app
3. Configure the app:
   - **App name**: Prodit
   - **Company or application URL**: Your Railway domain (you'll update this later)
   - **OAuth 2.0 redirect URI**: `http://localhost:3000/callback` (temporary, will update after Railway deployment)
4. Click **Create app** or **Save**
5. Copy your **Client ID** and **Client Secret** - you'll need these

### Step 3: Create Railway Project

1. Go to [https://railway.app](https://railway.app) and sign in
2. Click **New Project**
3. Select **Deploy from GitHub repo**
4. Authorize Railway to access your GitHub account
5. Select the **Prodit** repository

### Step 4: Add PostgreSQL Database

1. In your Railway project, click **New**
2. Select **Database** → **Add PostgreSQL**
3. Railway will automatically create a PostgreSQL database
4. The `DATABASE_URL` environment variable will be automatically provided to your app

### Step 5: Configure Environment Variables

1. In Railway, click on your service (not the database)
2. Go to **Variables** tab
3. Add the following environment variables:

```
XERO_CLIENT_ID=<your_xero_client_id>
XERO_CLIENT_SECRET=<your_xero_client_secret>
SESSION_SECRET=<generate_random_32_char_string>
PRODIT_TOKEN_KEY=<generate_with_openssl_see_below>
NODE_ENV=production
```

**To generate `SESSION_SECRET`**:
```bash
# Linux/Mac:
openssl rand -hex 32

# Windows PowerShell:
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

**To generate `PRODIT_TOKEN_KEY`**:
```bash
# Linux/Mac:
openssl rand -base64 32

# Windows PowerShell:
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### Step 6: Get Your Railway Domain

1. After deployment completes, Railway will provide a public domain
2. It will look like: `https://prodit-production.up.railway.app`
3. You can also set up a custom domain in Railway settings

### Step 7: Update Xero OAuth Redirect URI

1. Go back to [https://developer.xero.com/app/manage](https://developer.xero.com/app/manage)
2. Edit your Xero app
3. Update the **OAuth 2.0 redirect URI** to:
   ```
   https://your-railway-domain.up.railway.app/callback
   ```
4. Save the changes

### Step 8: Deploy and Test

1. Push your code to GitHub:
```bash
git add .
git commit -m "Initial Prodit deployment"
git push origin main
```

2. Railway will automatically deploy
3. Monitor the deployment in Railway dashboard
4. Once deployed, visit your Railway domain
5. You should see the Prodit login page

### Step 9: Create Your First Account

1. Visit your Railway domain
2. Click **Sign up**
3. Create an account
4. Click **Connect Xero Account**
5. Authorize with Xero
6. Start editing your products!

## Troubleshooting

### Database Migration Not Running

If the database tables aren't created:

1. Go to Railway dashboard
2. Click on your service
3. Open **Deployments** tab
4. Check the logs for migration errors
5. You can manually run migration:
   - Click **Settings** → **Deploy Trigger**
   - Or SSH into the service and run: `npm run migrate`

### OAuth Callback Error

If you get an error during Xero connection:

1. Verify the redirect URI in Xero matches exactly: `https://your-domain/callback`
2. Check that `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` are correct in Railway
3. Check Railway logs for detailed error messages

### "Invalid encryption key" Error

1. Verify `PRODIT_TOKEN_KEY` is exactly 44 characters (32-byte base64)
2. Regenerate the key using the command above
3. Update it in Railway environment variables
4. Redeploy

### Session/Cookie Issues

1. Make sure `NODE_ENV=production` is set in Railway
2. Railway automatically provides HTTPS, which is required for secure cookies
3. Check browser console for cookie errors

### Database Connection Errors

1. Verify PostgreSQL service is running in Railway
2. Check that `DATABASE_URL` is present in environment variables
3. Railway provides this automatically - don't override it

## Custom Domain Setup

1. In Railway, go to your service
2. Click **Settings** → **Domains**
3. Click **Custom Domain**
4. Add your domain (e.g., `app.yourdomain.com`)
5. Configure DNS:
   - Add CNAME record pointing to Railway's domain
6. Update Xero redirect URI to use your custom domain

## Monitoring and Logs

- **View Logs**: Railway dashboard → Service → **Deployments** → Click on deployment
- **Health Check**: Visit `https://your-domain/api/health`
- **Monitor Database**: Railway dashboard → PostgreSQL service → **Metrics**

## Scaling

Railway handles scaling automatically:
- **Auto-scaling**: Railway scales based on traffic
- **Database**: PostgreSQL automatically scales storage
- **Connection pooling**: Already configured in code (max 20 connections)

## Backups

### Database Backups

Railway provides automatic database backups on paid plans. To manually backup:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Backup database
railway run pg_dump $DATABASE_URL > backup.sql
```

## Security Checklist

- [x] HTTPS enabled (Railway provides this)
- [x] Environment variables secured
- [x] Passwords hashed with bcrypt
- [x] Tokens encrypted with AES-256-GCM
- [x] Rate limiting enabled
- [x] Secure cookies (httpOnly, secure, sameSite)
- [x] SQL injection protection
- [ ] Set up monitoring/alerting
- [ ] Regular security updates

## Cost Estimate

**Railway Pricing** (approximate):
- Hobby Plan: $5/month (500 hours of execution)
- PostgreSQL: $5-10/month (based on storage)
- **Total**: ~$10-15/month for small scale

## Support

For issues:
1. Check Railway logs
2. Review this deployment guide
3. Check Xero API status: [https://status.developer.xero.com](https://status.developer.xero.com)
4. Open an issue on GitHub

---

**You're ready to go!** 🚀
