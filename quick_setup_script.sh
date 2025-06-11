#!/bin/bash
# Quick Setup Script for MCP Server with Google Drive OAuth

echo "🚀 Setting up MCP Server with Google Drive Integration"
echo "=================================================="

# 1. Install dependencies
echo "📦 Installing dependencies..."
npm install express cors helmet dotenv googleapis multer uuid
npm install --save-dev @types/express @types/cors @types/multer @types/uuid

# 2. Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOL
PORT=3000
MCP_AUTH_TOKEN=mcp_dev_token_$(openssl rand -hex 16)
GOOGLE_DRIVE_FOLDER_ID=

# OAuth 2.0 credentials (get these from Google Cloud Console)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# This will be set after first OAuth flow
GOOGLE_REFRESH_TOKEN=
NODE_ENV=development
EOL
    echo "✅ Created .env file with random auth token"
else
    echo "ℹ️  .env file already exists"
fi

# 3. Update package.json scripts
echo "📄 Updating package.json scripts..."
npm pkg set scripts.build="tsc"
npm pkg set scripts.start="node dist/index.js"
npm pkg set scripts.start:prod="NODE_ENV=production node dist/http-server.js"
npm pkg set scripts.dev="ts-node index.ts"
npm pkg set scripts.dev:http="ts-node http-server.ts"

# 4. Create tsconfig.json if it doesn't exist
if [ ! -f tsconfig.json ]; then
    echo "⚙️  Creating tsconfig.json..."
    cat > tsconfig.json << EOL
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "allowJs": true,
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
EOL
fi

# 5. Create .gitignore if it doesn't exist
if [ ! -f .gitignore ]; then
    echo "🙈 Creating .gitignore..."
    cat > .gitignore << EOL
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
service-account-key.json
EOL
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Go to Google Cloud Console and set up OAuth 2.0:"
echo "   https://console.cloud.google.com/"
echo ""
echo "2. Add your OAuth credentials to .env file:"
echo "   - GOOGLE_CLIENT_ID"
echo "   - GOOGLE_CLIENT_SECRET"
echo "   - GOOGLE_DRIVE_FOLDER_ID (optional)"
echo ""
echo "3. Test locally:"
echo "   npm run dev:http"
echo "   Visit: http://localhost:3000/auth"
echo ""
echo "4. Deploy to Render:"
echo "   - Push to GitHub"
echo "   - Connect to Render"
echo "   - Set environment variables"
echo "   - Complete OAuth flow on deployed URL"
echo ""
echo "🔐 Your MCP auth token: $(grep MCP_AUTH_TOKEN .env | cut -d'=' -f2)"