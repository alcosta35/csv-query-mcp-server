/// <reference path="./globals.d.ts" />
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const { CSVParser } = require('./csv-parser');
const { ZipHandler } = require('./zip-handler');
const { GoogleDriveOAuthHandler } = require('./google_drive_oauth_handler');

class HTTPMCPServer {
  app;
  csvParser;
  zipHandler;
  driveHandler;
  loadedData;
  authToken;

  constructor() {
    console.log('=== MCP Server Starting ===');
    console.log('Environment:', process.env.NODE_ENV);
    
    this.app = express();
    this.authToken = process.env.MCP_AUTH_TOKEN || 'default-dev-token';
    this.loadedData = new Map();
    
    // Initialize handlers
    this.csvParser = new CSVParser();
    this.zipHandler = new ZipHandler();
    this.driveHandler = new GoogleDriveOAuthHandler();
    
    console.log('Google Drive Auth Status:', this.driveHandler.isAuthenticated());
    console.log('MCP Server configured for HTTP-only mode');

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' 
        ? ['https://claude.ai'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000']
    }));
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Global request logging
    this.app.use((req, res, next) => {
      console.log(`🌐 ${req.method} ${req.path} - ${new Date().toISOString()}`);
      if (req.path === '/mcp') {
        console.log('📨 MCP request body:', JSON.stringify(req.body, null, 2));
      }
      next();
    });

    this.app.use('/mcp', this.authenticateToken.bind(this));
    this.app.use('/upload', this.authenticateToken.bind(this));
    this.app.use('/download', this.authenticateToken.bind(this));
  }

  authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    if (token !== this.authToken) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    next();
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        authenticated: this.driveHandler.isAuthenticated(),
        timestamp: new Date().toISOString(),
        service: 'csv-query-mcp-server'
      });
    });

    this.app.get('/auth', (req, res) => {
      const authUrl = this.driveHandler.getAuthUrl();
      res.redirect(authUrl);
    });

    this.app.get('/auth/callback', async (req, res) => {
      try {
        const { code } = req.query;
        
        if (!code || typeof code !== 'string') {
          return res.status(400).send('Authorization code not found');
        }

        const tokens = await this.driveHandler.getTokens(code);
        
        console.log('Refresh Token:', tokens.refresh_token);
        console.log('Add this to your environment variables: GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);

        res.send(`
          <h1> Authorization Successful!</h1>
          <p><strong>Your refresh token is:</strong><br>
          <code style="background: #f4f4f4; padding: 10px; display: block; margin: 10px 0; word-break: break-all;">
          ${tokens.refresh_token}
          </code></p>
          <p><strong>Next steps:</strong></p>
          <ol>
            <li>Add this to your environment variables as <code>GOOGLE_REFRESH_TOKEN</code></li>
            <li>Restart your server</li>
            <li>You can now use the Google Drive features!</li>
          </ol>
          <p><a href="/health">Check server status</a></p>
        `);
      } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).send('Authorization failed: ' + error.message);
      }
    });

    this.app.get('/auth/status', this.authenticateToken.bind(this), (req, res) => {
      res.json({
        authenticated: this.driveHandler.isAuthenticated(),
        authUrl: this.driveHandler.isAuthenticated() ? null : this.driveHandler.getAuthUrl()
      });
    });

    const upload = multer({ 
      dest: '/tmp/uploads/',
      limits: { fileSize: 100 * 1024 * 1024 }
    });

    this.app.post('/upload', upload.single('file'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileId = await this.driveHandler.uploadFile(
          req.file.path,
          req.file.originalname || `upload-${uuidv4()}.zip`
        );

        await fs.unlink(req.file.path).catch(() => {});

        res.json({ 
          success: true, 
          fileId,
          message: 'File uploaded to Google Drive successfully'
        });
      } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ 
          error: 'Failed to upload file',
          details: error.message
        });
      }
    });

    this.app.get('/download/:fileId', async (req, res) => {
      try {
        const { fileId } = req.params;
        const tempPath = `/tmp/download-${uuidv4()}`;
        
        const filePath = await this.driveHandler.downloadFile(fileId, tempPath);
        
        res.download(filePath, (err) => {
          fs.unlink(filePath).catch(() => {});
          if (err) {
            console.error('Download error:', err);
          }
        });
      } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ 
          error: 'Failed to download file',
          details: error.message
        });
      }
    });

    this.app.get('/drive/files', async (req, res) => {
      try {
        const files = await this.driveHandler.listFiles();
        res.json({ files });
      } catch (error) {
        console.error('List files error:', error);
        res.status(500).json({ 
          error: 'Failed to list files',
          details: error.message
        });
      }
    });

    // MCP endpoint with detailed logging
    this.app.post('/mcp', async (req, res) => {
      console.log('=== MCP Request Received ===');
      console.log('Method:', req.body?.method);
      console.log('Request ID:', req.body?.id);
      
      try {
        const request = req.body;
        let response;

        switch (request.method) {
          case 'tools/list':
            console.log('✅ Handling tools/list');
            response = await this.handleListTools();
            break;
          case 'tools/call':
            console.log('✅ Handling tools/call with tool:', request.params?.name);
            response = await this.handleCallTool(request.params);
            break;
          case 'resources/list':
            console.log('✅ Handling resources/list');
            response = { resources: [] };
            break;
          case 'prompts/list':
            console.log('✅ Handling prompts/list');
            response = { prompts: [] };
            break;
          default:
            console.log(`❌ Unknown method: ${request.method}`);
            return res.status(404).json({
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: -32601,
                message: `Method ${request.method} not found`
              }
            });
        }

        const finalResponse = {
          jsonrpc: "2.0",
          id: request.id,
          result: response
        };
        
        console.log('📤 Sending response for', request.method);
        res.json(finalResponse);
        
      } catch (error) {
        console.error('=== MCP ERROR ===');
        console.error('Error:', error.message);
        
        const errorResponse = {
          jsonrpc: "2.0", 
          id: req.body?.id || null,
          error: {
            code: -32000,
            message: 'MCP request failed',
            data: error.message
          }
        };
        
        res.status(500).json(errorResponse);
      }
    });
  }

  async handleListTools() {
    return {
      tools: [
        {
          name: 'load_csv_from_drive',
          description: 'Load CSV files from a Google Drive zip file',
          inputSchema: {
            type: 'object',
            properties: {
              fileId: {
                type: 'string',
                description: 'Google Drive file ID of the zip file containing CSVs',
              },
            },
            required: ['fileId'],
          },
        },
        {
          name: 'list_drive_files',
          description: 'List available files in Google Drive',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        }
      ]
    };
  }

  async handleCallTool(params) {
    const { name, arguments: args } = params;
    console.log(`🔧 Executing tool: ${name} with args:`, args);

    switch (name) {
      case 'load_csv_from_drive':
        return await this.handleLoadCSVFromDrive(args.fileId);
      case 'list_drive_files':
        return await this.handleListDriveFiles();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async handleLoadCSVFromDrive(fileId) {
    const tempZipPath = `/tmp/download-${uuidv4()}.zip`;
    const extractPath = `/tmp/extracted-${uuidv4()}`;
    
    try {
      console.log(`📥 Starting CSV load from Drive for file ID: ${fileId}`);
      
      await this.driveHandler.downloadFile(fileId, tempZipPath);
      const stats = await fs.stat(tempZipPath);
      console.log(`📦 Downloaded file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      const csvFiles = await this.zipHandler.extractZip(tempZipPath, extractPath);
      console.log(`📂 Extracted ${csvFiles.length} CSV files`);

      if (csvFiles.length === 0) {
        throw new Error('No CSV files found in the zip archive');
      }

      const loadResults = [];
      let totalRows = 0;
      
      for (const csvPath of csvFiles) {
        try {
          const data = await this.csvParser.parseCSV(csvPath);
          const filename = path.basename(csvPath);
          
          this.loadedData.set(filename, data);
          
          console.log(`✅ Loaded ${data.length} rows from ${filename}`);
          loadResults.push(`${filename}: ${data.length} rows loaded`);
          totalRows += data.length;
          
        } catch (parseError) {
          console.error(`❌ Error parsing ${csvPath}:`, parseError.message);
          loadResults.push(`${path.basename(csvPath)}: Error parsing - ${parseError.message}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully processed ${csvFiles.length} CSV files from Google Drive (Total: ${totalRows} rows):\n\n${loadResults.join('\n')}\n\nData is now available for analysis.`,
          },
        ],
      };

    } catch (error) {
      console.error('❌ Error in handleLoadCSVFromDrive:', error.message);
      throw new Error(`Failed to load CSV files from Drive: ${error.message}`);
    } finally {
      try {
        await fs.unlink(tempZipPath).catch(() => {});
        await fs.rmdir(extractPath, { recursive: true }).catch(() => {});
      } catch (cleanupError) {
        console.warn('⚠️ Cleanup error:', cleanupError.message);
      }
    }
  }

  async handleListDriveFiles() {
    try {
      const files = await this.driveHandler.listFiles();
      const fileList = files.map((file) => 
        `${file.name} (ID: ${file.id}) - ${file.size || 'Unknown size'} - Modified: ${file.modifiedTime || 'Unknown'}`
      ).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Files in Google Drive:\n${fileList || 'No files found'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list Drive files: ${error.message}`);
    }
  }

  async start() {
    const port = process.env.PORT || 3000;
    
    this.app.listen(port, () => {
      console.log(`🚀 CSV Query MCP Server running on port ${port}`);
      console.log(`🔐 Authentication required with token: ${this.authToken.substring(0, 10)}...`);
      console.log(`📁 Google Drive integration enabled`);
      console.log(`💚 Health check: http://localhost:${port}/health`);
    });
  }
}

const server = new HTTPMCPServer();
server.start().catch(console.error);