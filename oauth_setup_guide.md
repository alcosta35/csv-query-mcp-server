# OAuth 2.0 Setup Guide for Google Drive

## 1. Create OAuth 2.0 Credentials

### Google Cloud Console Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Enable Google Drive API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Drive API"
   - Click "Enable"

### Create OAuth 2.0 Client
1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. If prompted, configure the OAuth consent screen:
   - Choose "External" for testing
   - Fill in app name, user support email, developer email
   - Add scopes: `../auth/drive.file` and `../auth/drive.readonly`
   - Add test users (your email addresses)
4. For Application type, choose "Web application"
5. Add authorized redirect URIs:
   - `http://localhost:3000/auth/callback` (for local testing)
   - `https://your-app.onrender.com/auth/callback` (for production)
6. Click "Create"
7. Download the JSON file with your client credentials

## 2. Environment Variables

Update your `.env` file:

```env
PORT=3000
MCP_AUTH_TOKEN=your_secret_token_here
GOOGLE_DRIVE_FOLDER_ID=your_google_drive_folder_id

# OAuth 2.0 credentials (from downloaded JSON)
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# This will be set after first OAuth flow
GOOGLE_REFRESH_TOKEN=
```

## 3. Updated HTTP Server with OAuth

Replace your `http-server.ts` with this OAuth-enabled version:

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { GoogleDriveOAuthHandler } from './google-drive-oauth-handler.js';
// ... other imports

class HTTPMCPServer {
  private app: express.Application;
  private driveHandler: GoogleDriveOAuthHandler;
  private authToken: string;
  // ... other properties

  constructor() {
    this.app = express();
    this.authToken = process.env.MCP_AUTH_TOKEN || 'default-dev-token';
    this.driveHandler = new GoogleDriveOAuthHandler();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupMCPHandlers();
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        authenticated: this.driveHandler.isAuthenticated(),
        timestamp: new Date().toISOString()
      });
    });

    // OAuth flow initiation
    this.app.get('/auth', (req, res) => {
      const authUrl = this.driveHandler.getAuthUrl();
      res.redirect(authUrl);
    });

    // OAuth callback
    this.app.get('/auth/callback', async (req, res) => {
      try {
        const { code } = req.query;
        
        if (!code || typeof code !== 'string') {
          return res.status(400).send('Authorization code not found');
        }

        const tokens = await this.driveHandler.getTokens(code);
        
        // Store refresh token for future use
        console.log('Refresh Token:', tokens.refresh_token);
        console.log('Add this to your environment variables: GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);

        res.send(`
          <h1>Authorization Successful!</h1>
          <p>Your refresh token is: <code>${tokens.refresh_token}</code></p>
          <p>Add this to your environment variables as GOOGLE_REFRESH_TOKEN</p>
          <p>You can now use the Google Drive features.</p>
        `);
      } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).send('Authorization failed: ' + (error instanceof Error ? error.message : String(error)));
      }
    });

    // Check authentication status
    this.app.get('/auth/status', this.authenticateToken.bind(this), (req, res) => {
      res.json({
        authenticated: this.driveHandler.isAuthenticated(),
        authUrl: this.driveHandler.isAuthenticated() ? null : this.driveHandler.getAuthUrl()
      });
    });

    // ... rest of your existing routes (upload, download, etc.)
    // Just replace this.driveHandler calls - the OAuth version has the same methods
  }

  // ... rest of your existing methods
}
```

## 4. First-Time Setup Process

### Local Development
1. Start your server: `npm run dev:http`
2. Visit: `http://localhost:3000/auth`
3. Complete Google OAuth flow
4. Copy the refresh token from the callback page
5. Add `GOOGLE_REFRESH_TOKEN=your_refresh_token` to your `.env` file
6. Restart your server

### Production Deployment
1. Set all environment variables in Render dashboard
2. Leave `GOOGLE_REFRESH_TOKEN` empty initially
3. Deploy to Render
4. Visit: `https://your-app.onrender.com/auth`
5. Complete OAuth flow
6. Copy refresh token and add it to Render environment variables
7. Restart the service

## 5. Alternative: Application Default Credentials (ADC)

If you have access to Google Cloud IAM, you can use Workload Identity:

### For Cloud Run/GKE
```typescript
import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });
```

Environment variables needed:
```env
GOOGLE_CLOUD_PROJECT=your-project-id
# No other credentials needed - uses workload identity
```

## 6. Security Considerations

- **OAuth 2.0** is more secure than service account keys
- Refresh tokens should be stored securely
- Consider implementing token rotation
- Use HTTPS in production
- Limit OAuth scopes to minimum required

## 7. Testing the Setup

After completing OAuth setup:

```bash
# Check authentication status
curl -H "Authorization: Bearer your_token" \
     https://your-app.onrender.com/auth/status

# List files (should work if authenticated)
curl -H "Authorization: Bearer your_token" \
     https://your-app.onrender.com/drive/files
```

## 8. Troubleshooting

**"Not authenticated" errors:**
- Complete OAuth flow first
- Check refresh token is set correctly
- Verify OAuth consent screen is configured

**Redirect URI mismatch:**
- Ensure redirect URIs match exactly in Google Cloud Console
- Check both local and production URLs

**Scope errors:**
- Verify Drive API is enabled
- Check OAuth consent screen has correct scopes

This OAuth approach is much more secure and doesn't require service account keys!