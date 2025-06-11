// http-server.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  McpError,
  ErrorCode 
} from '@modelcontextprotocol/sdk/types.js';
import { CSVParser } from './csv-parser.js';
import { ZipHandler } from './zip-handler.js';
import { GoogleDriveOAuthHandler } from './google-drive-oauth-handler.js';

class HTTPMCPServer {
  private app: express.Application;
  private server: Server;
  private csvParser: CSVParser;
  private zipHandler: ZipHandler;
  private driveHandler: GoogleDriveOAuthHandler;
  private loadedData: Map<string, any[]> = new Map();
  private authToken: string;

  constructor() {
    this.app = express();
    this.authToken = process.env.MCP_AUTH_TOKEN || 'default-dev-token';
    
    this.server = new Server(
      {
        name: 'csv-query-mcp-http',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.csvParser = new CSVParser();
    this.zipHandler = new ZipHandler();
    this.driveHandler = new GoogleDriveOAuthHandler();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupMCPHandlers();
  }

  private setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' 
        ? ['https://claude.ai'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000']
    }));
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Authentication middleware
    this.app.use('/mcp', this.authenticateToken.bind(this));
    this.app.use('/upload', this.authenticateToken.bind(this));
    this.app.use('/download', this.authenticateToken.bind(this));
  }

  private authenticateToken(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    if (token !== this.authToken) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    next();
  }

  private setupRoutes() {
    // Health check endpoint (public)
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        authenticated: this.driveHandler.isAuthenticated(),
        timestamp: new Date().toISOString(),
        service: 'csv-query-mcp-server'
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
          <h1>✅ Authorization Successful!</h1>
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

    // File upload to Google Drive
    const upload = multer({ 
      dest: '/tmp/uploads/',
      limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
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

        // Clean up temp file
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
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Download file from Google Drive
    this.app.get('/download/:fileId', async (req, res) => {
      try {
        const { fileId } = req.params;
        const tempPath = `/tmp/download-${uuidv4()}`;
        
        const filePath = await this.driveHandler.downloadFile(fileId, tempPath);
        
        res.download(filePath, (err) => {
          // Clean up temp file after download
          fs.unlink(filePath).catch(() => {});
          if (err) {
            console.error('Download error:', err);
          }
        });
      } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ 
          error: 'Failed to download file',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // List files in Google Drive
    this.app.get('/drive/files', async (req, res) => {
      try {
        const files = await this.driveHandler.listFiles();
        res.json({ files });
      } catch (error) {
        console.error('List files error:', error);
        res.status(500).json({ 
          error: 'Failed to list files',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // MCP protocol endpoint
    this.app.post('/mcp', async (req, res) => {
      try {
        const request = req.body;
        let response;

        switch (request.method) {
          case 'tools/list':
            response = await this.handleListTools();
            break;
          case 'tools/call':
            response = await this.handleCallTool(request.params);
            break;
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Method ${request.method} not found`
            );
        }

        res.json(response);
      } catch (error) {
        console.error('MCP error:', error);
        res.status(500).json({ 
          error: 'MCP request failed',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  private setupMCPHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
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
        },
        {
          name: 'upload_to_drive',
          description: 'Upload a file to Google Drive (use /upload endpoint)',
          inputSchema: {
            type: 'object',
            properties: {
              info: {
                type: 'string',
                description: 'Use POST /upload endpoint with multipart form data',
              },
            },
            required: ['info'],
          },
        },
        {
          name: 'get_data',
          description: 'Get CSV data for Claude to analyze directly',
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Name of the CSV file to retrieve data from',
              },
              sample_size: {
                type: 'number',
                description: 'Number of rows to return (default: all data)',
              },
            },
            required: ['filename'],
          },
        },
        {
          name: 'list_loaded_data',
          description: 'Show information about currently loaded CSV files',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'preview_data',
          description: 'Show a preview of loaded CSV data',
          inputSchema: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Name of CSV file to preview',
              },
              rows: {
                type: 'number',
                description: 'Number of rows to show (default: 5)',
                default: 5,
              },
            },
            required: ['filename'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new Error('Missing arguments');
      }

      try {
        switch (name) {
          case 'load_csv_from_drive':
            return await this.handleLoadCSVFromDrive(args.fileId as string);

          case 'list_drive_files':
            return await this.handleListDriveFiles();

          case 'upload_to_drive':
            return {
              content: [{
                type: 'text',
                text: 'To upload files to Google Drive, use the POST /upload endpoint with multipart form data. Example: curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -F "file=@yourfile.zip" https://your-server.onrender.com/upload'
              }]
            };

          case 'get_data':
            return await this.handleGetData(
              args.filename as string,
              args.sample_size as number | undefined
            );

          case 'list_loaded_data':
            return await this.handleListLoadedData();

          case 'preview_data':
            return await this.handlePreviewData(
              args.filename as string,
              args.rows as number || 5
            );

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private async handleListTools() {
    const handler = this.server.getRequestHandler(ListToolsRequestSchema);
    return await handler({
      method: 'tools/list',
      params: {}
    } as any);
  }

  private async handleCallTool(params: any) {
    const handler = this.server.getRequestHandler(CallToolRequestSchema);
    return await handler({
      method: 'tools/call',
      params
    } as any);
  }

  private async handleLoadCSVFromDrive(fileId: string) {
    try {
      // Download zip file from Google Drive
      const tempZipPath = `/tmp/download-${uuidv4()}.zip`;
      await this.driveHandler.downloadFile(fileId, tempZipPath);

      // Extract and load CSV files
      const extractPath = `/tmp/extracted-${uuidv4()}`;
      const csvFiles = await this.zipHandler.extractZip(tempZipPath, extractPath);

      // Load all CSV files
      const loadResults = [];
      for (const csvPath of csvFiles) {
        const data = await this.csvParser.parseCSV(csvPath);
        const filename = path.basename(csvPath);
        this.loadedData.set(filename, data);
        loadResults.push(`${filename}: ${data.length} rows loaded`);
      }

      // Clean up temp files
      await fs.unlink(tempZipPath).catch(() => {});
      await fs.rm(extractPath, { recursive: true, force: true }).catch(() => {});

      return {
        content: [
          {
            type: 'text',
            text: `Successfully loaded ${csvFiles.length} CSV files from Google Drive:\n${loadResults.join('\n')}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to load CSV files from Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListDriveFiles() {
    try {
      const files = await this.driveHandler.listFiles();
      const fileList = files.map(file => 
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
      throw new Error(`Failed to list Drive files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleGetData(filename: string, sampleSize?: number) {
    const data = this.loadedData.get(filename);
    if (!data) {
      throw new Error(`File '${filename}' not found in loaded data`);
    }

    const returnData = sampleSize ? data.slice(0, sampleSize) : data;
    
    return {
      content: [
        {
          type: 'text',
          text: `Data from ${filename} (${returnData.length} rows):\n\n${JSON.stringify(returnData, null, 2)}`,
        },
      ],
    };
  }

  private async handleListLoadedData() {
    if (this.loadedData.size === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No CSV files currently loaded. Use load_csv_from_drive to load files.',
          },
        ],
      };
    }

    const info = Array.from(this.loadedData.entries()).map(([filename, data]) => {
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      return `${filename}: ${data.length} rows, ${columns.length} columns [${columns.slice(0, 5).join(', ')}${columns.length > 5 ? '...' : ''}]`;
    });

    return {
      content: [
        {
          type: 'text',
          text: `Loaded CSV files:\n${info.join('\n')}`,
        },
      ],
    };
  }

  private async handlePreviewData(filename: string, rows: number) {
    const data = this.loadedData.get(filename);
    if (!data) {
      throw new Error(`File '${filename}' not found in loaded data`);
    }

    const preview = data.slice(0, rows);
    const columns = data.length > 0 ? Object.keys(data[0]) : [];

    return {
      content: [
        {
          type: 'text',
          text: `Preview of ${filename} (first ${rows} rows):\n\nColumns: ${columns.join(', ')}\n\n${JSON.stringify(preview, null, 2)}`,
        },
      ],
    };
  }

  async start() {
    const port = process.env.PORT || 3000;
    
    this.app.listen(port, () => {
      console.log(`🚀 CSV Query MCP Server running on port ${port}`);
      console.log(`🔒 Authentication required with token: ${this.authToken.substring(0, 10)}...`);
      console.log(`📁 Google Drive integration enabled`);
      console.log(`🏥 Health check: http://localhost:${port}/health`);
    });
  }
}

// Start the server
const server = new HTTPMCPServer();
server.start().catch(console.error);