# Xero Developer App Setup Guide

This guide walks you through setting up a Xero OAuth app for Prodit.

## Step 1: Create Xero Developer Account

1. Go to [https://developer.xero.com](https://developer.xero.com)
2. Sign in with your Xero account or create one
3. Accept the Developer Terms of Service

## Step 2: Create a New App

1. Go to [My Apps](https://developer.xero.com/app/manage)
2. Click **New app** button
3. Fill in the app details:

### App Details

**App name**: `Prodit` (or your preferred name)

**Company or application URL**:
- Development: `http://localhost:3000`
- Production: `https://your-railway-domain.up.railway.app`

**OAuth 2.0 redirect URI**:
- Development: `http://localhost:3000/callback`
- Production: `https://your-railway-domain.up.railway.app/callback`

**Note**: You can add multiple redirect URIs by clicking **Add another URL**. Add both development and production URLs.

### Integration Type

Select: **Web app**

## Step 3: Configure OAuth Scopes

Prodit requires the following scopes:

- ✅ `openid` - Required for OAuth
- ✅ `profile` - User profile information
- ✅ `email` - User email address
- ✅ `offline_access` - Refresh tokens for long-term access
- ✅ `accounting.settings` - Read and write account settings
- ✅ `accounting.settings.read` - Read-only access to account settings
- ✅ `accounting.transactions` - Access to create and read transactions (for Items/Products)

**These scopes are already configured in the code**. Xero will automatically request them during OAuth.

## Step 4: Get Your Credentials

After creating the app:

1. You'll see your app in the My Apps list
2. Click on your app name to view details
3. Copy the following:
   - **Client ID** - A long alphanumeric string
   - **Client Secret** - Click **Generate a secret** if needed, then copy it

⚠️ **Important**: Keep your Client Secret secure! Never commit it to Git or share it publicly.

## Step 5: Add Credentials to Prodit

### For Development (.env file):
```env
XERO_CLIENT_ID=your_client_id_here
XERO_CLIENT_SECRET=your_client_secret_here
```

### For Production (Railway environment variables):
Add these as environment variables in Railway dashboard:
- `XERO_CLIENT_ID` = your client ID
- `XERO_CLIENT_SECRET` = your client secret

## Step 6: Update Redirect URIs After Deployment

After deploying to Railway:

1. Get your Railway public domain (e.g., `prodit-production.up.railway.app`)
2. Go back to [My Apps](https://developer.xero.com/app/manage)
3. Click on your Prodit app
4. Update the **OAuth 2.0 redirect URI** to:
   ```
   https://prodit-production.up.railway.app/callback
   ```
5. Keep the localhost URI for local development if needed
6. Click **Save**

## Testing the Connection

### Development Testing:

1. Start your local server: `npm run dev`
2. Visit `http://localhost:3000`
3. Sign up for an account
4. Click **Connect Xero Account**
5. You should be redirected to Xero login
6. After authorization, you'll be redirected back to Prodit

### Production Testing:

1. Visit your Railway domain
2. Sign up for an account
3. Click **Connect Xero Account**
4. Authorize with Xero
5. You should be redirected back to Prodit

## Troubleshooting

### Error: "redirect_uri_mismatch"

**Cause**: The redirect URI in your code doesn't match what's configured in Xero.

**Solution**:
1. Check the error message for the exact redirect URI Prodit is sending
2. Add that exact URL to your Xero app's redirect URIs
3. Make sure there are no trailing slashes or differences in protocol (http vs https)

### Error: "invalid_client"

**Cause**: Client ID or Client Secret is incorrect.

**Solution**:
1. Double-check your `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` in environment variables
2. Regenerate the client secret in Xero if needed
3. Make sure there are no spaces or line breaks in the credentials

### Error: "consent_required"

**Cause**: The Xero user hasn't authorized the app yet.

**Solution**:
- This is normal for first-time connections
- Click through the OAuth flow to authorize
- User must have admin access to the Xero organization

### Error: "insufficient_scope"

**Cause**: The app is trying to access data without the required scopes.

**Solution**:
1. Check that all required scopes are enabled in your Xero app
2. The user may need to disconnect and reconnect to grant new scopes
3. Scopes are defined in `server.js` - verify they match Xero's requirements

## Managing Connected Organizations

Users can:
- Connect multiple Xero organizations (multi-tenant support)
- Disconnect organizations from within Prodit
- Also disconnect from Xero's [Connected Apps](https://my.xero.com/Settings/ConnectedApps) page

## Rate Limits

Xero API has rate limits:
- **5,000 API calls per day per organization**
- **60 API calls per minute**

Prodit handles rate limiting gracefully, but be aware of these limits for high-volume use.

## Security Best Practices

1. **Never share your Client Secret**
2. **Rotate secrets periodically** (every 6-12 months)
3. **Use environment variables** - never hardcode credentials
4. **Monitor connected apps** in Xero dashboard
5. **Revoke access** for unused organizations

## Additional Resources

- [Xero OAuth 2.0 Documentation](https://developer.xero.com/documentation/oauth2/overview)
- [Xero API Explorer](https://developer.xero.com/documentation/api/api-overview)
- [Xero API Status](https://status.developer.xero.com)
- [Xero Developer Community](https://community.developer.xero.com)

## Need Help?

- Check [Xero Developer Forums](https://community.developer.xero.com)
- Review [Xero API Documentation](https://developer.xero.com/documentation)
- Open an issue on the Prodit GitHub repository

---

You're all set! 🎉
