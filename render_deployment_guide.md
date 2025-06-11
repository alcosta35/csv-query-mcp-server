# Complete Render Deployment Guide for MCP Server

## 1. Set Up Google Drive OAuth 2.0 (Recommended - No Service Account Keys!)

### Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google Drive API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Drive API"
   - Click "Enable"

### Create OAuth 2.0 Client
1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client IDs"
3. Configure the OAuth consent screen (if not done):
   - Choose "External" for testing
   - Fill in app name, user support email, developer email
   - Under "Scopes", add:
     - `../auth/drive.file`
     - `../auth/drive.readonly`
   - Add test users (your email addresses)
4. For Application type, choose "Web application"
5. Add authorized redirect URIs:
   - `http://localhost:3000/auth/callback` (for local testing)
   - `https://your-app-name.onrender.com/auth/callback` (replace with your actual Render URL)
6. Click "Create"
7. Note down the Client ID and Client Secret

## 2. Prepare Your Code for Deployment

### Install Additional Dependencies
```bash
npm install express cors helmet dotenv googleapis multer uuid
npm install --save-dev @types/express @types/cors @types/multer @types/uuid
```

### Create Required Files

Create these new files in your project root:

#### `.env.example`
```
PORT=3000
MCP_AUTH_TOKEN=your_secret_token_here
GOOGLE_DRIVE_FOLDER_ID=your_google_drive_folder_id

# OAuth 2.0 credentials
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# This will be set after first OAuth flow
GOOGLE_REFRESH_TOKEN=
NODE_ENV=development
```

#### `render.yaml`
```yaml
services:
  - type: web
    name: csv-query-mcp
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm run start:prod
    envVars:
      - key: NODE_ENV
        value: production
```

#### `Dockerfile` (optional, for containerized deployment)
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
```

## 3. Update package.json Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "start:prod": "NODE_ENV=production node dist/http-server.js",
    "dev": "ts-node index.ts",
    "dev:http": "ts-node http-server.ts"
  }
}
```

## 4. GitHub Repository Setup

### Initialize Git Repository
```bash
# In your project directory
git init
git add .
git commit -m "Initial commit: MCP server with Google Drive integration"
```

### Create GitHub Repository
1. Go to [GitHub](https://github.com)
2. Click "New repository"
3. Name it `csv-query-mcp-server`
4. Don't initialize with README (you already have code)
5. Click "Create repository"

### Push to GitHub
```bash
# Replace YOUR_USERNAME with your GitHub username
git remote add origin https://github.com/YOUR_USERNAME/csv-query-mcp-server.git
git branch -M main
git push -u origin main
```

## 5. Render Deployment

### Sign Up for Render
1. Go to [Render.com](https://render.com)
2. Sign up with your GitHub account (easiest)
3. Authorize Render to access your repositories

### Create Web Service
1. Click "New +" > "Web Service"
2. Connect your GitHub repository
3. Select `csv-query-mcp-server`
4. Configure settings:
   - **Name**: `csv-query-mcp`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start:prod`

### Configure Environment Variables
In Render dashboard, go to your service > Environment:

1. `PORT` = `3000`
2. `MCP_AUTH_TOKEN` = `your_strong_secret_token_123`
3. `GOOGLE_DRIVE_FOLDER_ID` = `your_actual_folder_id_from_drive_url`
4. `GOOGLE_CLIENT_ID` = `your_client_id.apps.googleusercontent.com`
5. `GOOGLE_CLIENT_SECRET` = `your_client_secret`
6. `GOOGLE_REDIRECT_URI` = `https://your-app-name.onrender.com/auth/callback`
7. `NODE_ENV` = `production`
8. `GOOGLE_REFRESH_TOKEN` = (leave empty for now - will be set after OAuth flow)

### Deploy
1. Click "Create Web Service"
2. Render will automatically build and deploy
3. Wait for deployment to complete (5-10 minutes)
4. Note your service URL: `https://your-service-name.onrender.com`

### Complete OAuth Setup
1. Visit: `https://your-service-name.onrender.com/auth`
2. Complete Google OAuth flow
3. Copy the refresh token from the success page
4. Go back to Render dashboard > Environment variables
5. Set `GOOGLE_REFRESH_TOKEN` = `your_copied_refresh_token`
6. Restart the service

## 6. Test Your Deployment

### Test Authentication
```bash
curl -H "Authorization: Bearer your_strong_secret_token_123" \
     https://your-service-name.onrender.com/health
```

### Test Google Drive Upload
```bash
curl -X POST \
     -H "Authorization: Bearer your_strong_secret_token_123" \
     -F "file=@your-local-file.zip" \
     https://your-service-name.onrender.com/upload
```

### Test MCP Tools
```bash
curl -X POST \
     -H "Authorization: Bearer your_strong_secret_token_123" \
     -H "Content-Type: application/json" \
     -d '{"method": "tools/list"}' \
     https://your-service-name.onrender.com/mcp
```

## 7. Configure Claude Desktop

Update your Claude Desktop configuration to use the deployed server:

#### `claude_desktop_config.json`
```json
{
  "mcpServers": {
    "csv-query": {
      "command": "node",
      "args": ["-e", "
        const https = require('https');
        const readline = require('readline');
        
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        rl.on('line', (line) => {
          const options = {
            hostname: 'your-service-name.onrender.com',
            port: 443,
            path: '/mcp',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer your_strong_secret_token_123'
            }
          };
          
          const req = https.request(options, (res) => {
            res.on('data', (chunk) => {
              process.stdout.write(chunk);
            });
          });
          
          req.write(line);
          req.end();
        });
      "]
    }
  }
}
```

## 8. Troubleshooting

### Common Issues

**Build Fails**: Check build logs in Render dashboard
- Ensure all dependencies are in `package.json`
- Check TypeScript compilation errors

**Service Won't Start**: Check service logs
- Verify environment variables are set
- Check port binding (use `process.env.PORT`)

**Google Drive Access**: 
- Verify service account JSON is correctly set
- Check folder permissions
- Ensure Drive API is enabled

**Authentication Errors**:
- Verify `MCP_AUTH_TOKEN` matches in requests
- Check header format: `Authorization: Bearer TOKEN`

### View Logs
- Go to Render dashboard > Your service > Logs
- Use `console.log()` for debugging (visible in logs)

## 9. Free Tier Limitations

Render's free tier includes:
- 750 hours/month (enough for continuous running)
- Service spins down after 15 minutes of inactivity
- Takes ~30 seconds to spin back up
- 512MB RAM limit
- No custom domains on free tier

## 10. Next Steps

1. Test all functionality thoroughly
2. Add error handling and logging
3. Consider adding rate limiting
4. Monitor usage and performance
5. Set up monitoring/alerts if needed

Your MCP server will be accessible at: `https://your-service-name.onrender.com`