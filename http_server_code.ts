/// <reference path="./globals.d.ts" />
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;

// Import your existing classes
const { CSVParser } = require('./csv-parser');
const { ZipHandler } = require('./zip-handler');
const { GoogleDriveOAuthHandler } = require('./google_drive_oauth_handler');

class HTTPMCPServer {
  app: any;
  csvParser: any;
  zipHandler: any;
  driveHandler: any;
  loadedData: Map<string, any[]>;
  authToken: string;

  constructor() {
    console.log('=== MCP Server Starting ===');
    
    this.app = express();
    this.authToken = process.env.MCP_AUTH_TOKEN || 'default-dev-token';
    this.loadedData = new Map();
    
    // Initialize handlers
    this.csvParser = new CSVParser();
    this.zipHandler = new ZipHandler();
    this.driveHandler = new GoogleDriveOAuthHandler();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    this.app.use((req: any, res: any, next: any) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });

    this.app.use('/mcp', this.authenticateToken.bind(this));
  }

  authenticateToken(req: any, res: any, next: any) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token || token !== this.authToken) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    next();
  }

  setupRoutes() {
    this.app.get('/health', (req: any, res: any) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        loadedTables: Array.from(this.loadedData.keys())
      });
    });

    this.app.post('/mcp', async (req: any, res: any) => {
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
            return res.status(404).json({
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32601, message: `Method ${request.method} not found` }
            });
        }

        res.json({
          jsonrpc: "2.0",
          id: request.id,
          result: response
        });
        
      } catch (error: any) {
        console.error('MCP Error:', error.message);
        res.status(500).json({
          jsonrpc: "2.0", 
          id: req.body?.id || null,
          error: { code: -32000, message: error.message }
        });
      }
    });
  }

  async handleListTools() {
    return {
      tools: [
        {
          name: 'load_csv_from_drive',
          description: 'Load data files from Google Drive (supports CSV, Excel, etc)',
          inputSchema: {
            type: 'object',
            properties: {
              fileId: { type: 'string', description: 'Google Drive file ID' }
            },
            required: ['fileId']
          }
        },
        {
          name: 'list_drive_files',
          description: 'List available files in Google Drive',
          inputSchema: { type: 'object', properties: {} }
        }
      ]
    };
  }

  async handleCallTool(params: any) {
    const { name, arguments: args } = params;
    
    switch (name) {
      case 'load_csv_from_drive':
        return await this.handleLoadFromDrive(args.fileId);
      case 'list_drive_files':
        return await this.handleListFiles();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async handleLoadFromDrive(fileId: string) {
    try {
      console.log(`Loading file: ${fileId}`);
      
      if (!fileId) {
        throw new Error('File ID is required');
      }

      // Basic file loading logic
      const tempZipPath = `/tmp/download-${Date.now()}.zip`;
      const extractPath = `/tmp/extracted-${Date.now()}`;
      
      // Try downloading the file
      await this.driveHandler.downloadFile(fileId, tempZipPath);
      
      // Check file size
      const stats = await fs.stat(tempZipPath);
      console.log(`Downloaded file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      // Try extracting
      const extractedFiles = await this.zipHandler.extractZip(tempZipPath, extractPath);
      console.log(`Extracted ${extractedFiles.length} files`);
      
      if (extractedFiles.length === 0) {
        throw new Error('No files found in ZIP archive');
      }

      // Try loading files
      let loadedCount = 0;
      const results: string[] = [];
      
      for (const fileInfo of extractedFiles) {
        try {
          const filePath = typeof fileInfo === 'string' ? fileInfo : fileInfo.path;
          const fileName = path.basename(filePath);
          
          console.log(`Processing: ${fileName}`);
          
          // Try parsing as CSV first
          const data = await this.csvParser.parseCSV(filePath);
          this.loadedData.set(fileName, data);
          
          results.push(`✅ ${fileName}: ${data.length} rows`);
          loadedCount++;
          
        } catch (parseError: any) {
          console.log(`Failed to parse ${fileInfo}: ${parseError.message}`);
          results.push(`❌ ${fileInfo}: ${parseError.message}`);
        }
      }

      const summary = `Loaded ${loadedCount} files:\n${results.join('\n')}`;
      
      return {
        content: [{ type: 'text', text: summary }]
      };
      
    } catch (error: any) {
      console.error('Load error:', error);
      throw new Error(`Failed to load: ${error.message}`);
    }
  }

  async handleListFiles() {
    try {
      const files = await this.driveHandler.listFiles();
      const fileList = files.map((file: any) => 
        `${file.name} (ID: ${file.id})`
      ).join('\n');

      return {
        content: [{ type: 'text', text: `Files:\n${fileList}` }]
      };
    } catch (error: any) {
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  async start() {
    const port = process.env.PORT || 3000;
    this.app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  }
}

const server = new HTTPMCPServer();
server.start().catch(console.error);