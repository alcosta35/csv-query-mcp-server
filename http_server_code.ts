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
  app: any;
  csvParser: any;
  zipHandler: any;
  driveHandler: any;
  loadedData: Map<string, any[]>;
  authToken: string;
  excelParser: any; // Added for Excel support

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
        ? ['https://claude.ai', /\.n8n\.cloud$/, /localhost:\d+/] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000', /localhost:\d+/]
    }));
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Global request logging
    this.app.use((req: any, res: any, next: any) => {
      console.log(`🌐 ${req.method} ${req.path} - ${new Date().toISOString()}`);
      if (req.path === '/mcp') {
        console.log('📨 MCP request body:', JSON.stringify(req.body, null, 2));
      }
      next();
    });

    this.app.use('/mcp', this.authenticateToken.bind(this));
    this.app.use('/upload', this.authenticateToken.bind(this));
    this.app.use('/download', this.authenticateToken.bind(this));
    // Novo endpoint para upload público (será usado pelo N8N)
    this.app.use('/public-upload', this.authenticateTokenOptional.bind(this));
  }

  authenticateToken(req: any, res: any, next: any) {
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

  // Autenticação opcional para upload público
  authenticateTokenOptional(req: any, res: any, next: any) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const queryToken = req.query.token;

    // Aceita token no header ou query string
    if (token === this.authToken || queryToken === this.authToken) {
      req.authenticated = true;
    } else {
      req.authenticated = false;
    }

    next();
  }

  setupRoutes() {
    this.app.get('/health', (req: any, res: any) => {
      res.json({ 
        status: 'healthy', 
        authenticated: this.driveHandler.isAuthenticated(),
        timestamp: new Date().toISOString(),
        service: 'csv-query-mcp-server',
        loadedTables: Array.from(this.loadedData.keys())
      });
    });

    // Página de upload web
    this.app.get('/upload-form', (req: any, res: any) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Upload para Google Drive</title>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 5px; font-weight: bold; }
                input, textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
                button { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; }
                button:hover { background: #0056b3; }
                .result { margin-top: 20px; padding: 15px; border-radius: 4px; }
                .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
                .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
                .loading { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
            </style>
        </head>
        <body>
            <h1>📁 Upload para Google Drive e Análise</h1>
            
            <form id="uploadForm" enctype="multipart/form-data">
                <div class="form-group">
                    <label for="file">Arquivo ZIP com dados:</label>
                    <input type="file" id="file" name="file" accept=".zip" required>
                </div>
                
                <div class="form-group">
                    <label for="prompt">Pergunta para análise:</label>
                    <textarea id="prompt" name="prompt" rows="4" placeholder="Ex: Qual estado teve maior valor total de notas fiscais?" required></textarea>
                </div>
                
                <button type="submit">📤 Upload e Analisar</button>
            </form>
            
            <div id="result"></div>

            <script>
                document.getElementById('uploadForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    
                    const resultDiv = document.getElementById('result');
                    resultDiv.innerHTML = '<div class="result loading">🔄 Fazendo upload e processando...</div>';
                    
                    const formData = new FormData();
                    const fileInput = document.getElementById('file');
                    const promptInput = document.getElementById('prompt');
                    
                    formData.append('file', fileInput.files[0]);
                    formData.append('prompt', promptInput.value);
                    
                    try {
                        const response = await fetch('/public-upload?token=${this.authToken}', {
                            method: 'POST',
                            body: formData
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            resultDiv.innerHTML = \`
                                <div class="result success">
                                    <h3>✅ Upload realizado com sucesso!</h3>
                                    <p><strong>Arquivo no Google Drive:</strong> \${result.fileName}</p>
                                    <p><strong>ID do arquivo:</strong> \${result.fileId}</p>
                                    <p><strong>Pergunta:</strong> \${result.prompt}</p>
                                    <hr>
                                    <h4>🔗 Links para N8N:</h4>
                                    <p><strong>URL do Webhook:</strong></p>
                                    <textarea readonly style="font-family: monospace; font-size: 12px;">\${result.n8nWebhookUrl}</textarea>
                                    <p><strong>Payload JSON:</strong></p>
                                    <textarea readonly style="font-family: monospace; font-size: 12px; height: 100px;">\${JSON.stringify(result.n8nPayload, null, 2)}</textarea>
                                </div>
                            \`;
                        } else {
                            resultDiv.innerHTML = \`<div class="result error">❌ Erro: \${result.error}</div>\`;
                        }
                    } catch (error) {
                        resultDiv.innerHTML = \`<div class="result error">❌ Erro de conexão: \${error.message}</div>\`;
                    }
                });
            </script>
        </body>
        </html>
      `);
    });

    this.app.get('/auth', (req: any, res: any) => {
      const authUrl = this.driveHandler.getAuthUrl();
      res.redirect(authUrl);
    });

    this.app.get('/auth/callback', async (req: any, res: any) => {
      try {
        const { code } = req.query;
        
        if (!code || typeof code !== 'string') {
          return res.status(400).send('Authorization code not found');
        }

        const tokens = await this.driveHandler.getTokens(code);
        
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
          <p><a href="/health">Check server status</a> | <a href="/upload-form">Upload Form</a></p>
        `);
      } catch (error: any) {
        console.error('OAuth callback error:', error);
        res.status(500).send('Authorization failed: ' + error.message);
      }
    });

    this.app.get('/auth/status', this.authenticateToken.bind(this), (req: any, res: any) => {
      res.json({
        authenticated: this.driveHandler.isAuthenticated(),
        authUrl: this.driveHandler.isAuthenticated() ? null : this.driveHandler.getAuthUrl()
      });
    });

    const upload = multer({ 
      dest: '/tmp/uploads/',
      limits: { fileSize: 100 * 1024 * 1024 }
    });

    // Upload original (protegido)
    this.app.post('/upload', upload.single('file'), async (req: any, res: any) => {
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
      } catch (error: any) {
        console.error('Upload error:', error);
        res.status(500).json({ 
          error: 'Failed to upload file',
          details: error.message
        });
      }
    });

    // Novo endpoint de upload público para o formulário web
    this.app.post('/public-upload', upload.single('file'), async (req: any, res: any) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        if (!req.authenticated) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        const prompt = req.body.prompt || 'Analise os dados';
        const fileName = req.file.originalname || `upload-${uuidv4()}.zip`;

        console.log(`📤 Public upload: ${fileName}, prompt: ${prompt}`);

        const fileId = await this.driveHandler.uploadFile(req.file.path, fileName);

        await fs.unlink(req.file.path).catch(() => {});

        // Preparar dados para o N8N
        const n8nPayload = {
          fileId: fileId,
          fileName: fileName,
          prompt: prompt,
          timestamp: new Date().toISOString()
        };

        // URL do webhook N8N (você precisará configurar isso)
        const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'https://seu-n8n.n8n.cloud/webhook/analyze-csv';

        res.json({ 
          success: true, 
          fileId,
          fileName,
          prompt,
          message: 'File uploaded to Google Drive successfully',
          n8nWebhookUrl,
          n8nPayload
        });

      } catch (error: any) {
        console.error('Public upload error:', error);
        res.status(500).json({ 
          error: 'Failed to upload file',
          details: error.message
        });
      }
    });

    this.app.get('/download/:fileId', async (req: any, res: any) => {
      try {
        const { fileId } = req.params;
        const tempPath = `/tmp/download-${uuidv4()}`;
        
        const filePath = await this.driveHandler.downloadFile(fileId, tempPath);
        
        res.download(filePath, (err: any) => {
          fs.unlink(filePath).catch(() => {});
          if (err) {
            console.error('Download error:', err);
          }
        });
      } catch (error: any) {
        console.error('Download error:', error);
        res.status(500).json({ 
          error: 'Failed to download file',
          details: error.message
        });
      }
    });

    this.app.get('/drive/files', async (req: any, res: any) => {
      try {
        const files = await this.driveHandler.listFiles();
        res.json({ files });
      } catch (error: any) {
        console.error('List files error:', error);
        res.status(500).json({ 
          error: 'Failed to list files',
          details: error.message
        });
      }
    });

    // MCP endpoint com detailed logging
    this.app.post('/mcp', async (req: any, res: any) => {
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
          case 'notifications/initialized':
            console.log('✅ Handling notifications/initialized');
            return res.status(200).end();
          case 'notifications/cancelled':
            console.log('✅ Handling notifications/cancelled for request:', request.params?.requestId);
            return res.status(200).end();
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
        
      } catch (error: any) {
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
          description: 'Load data files from a Google Drive zip file (supports CSV, Excel, TSV, TXT)',
          inputSchema: {
            type: 'object',
            properties: {
              fileId: {
                type: 'string',
                description: 'Google Drive file ID of the zip file containing data files',
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
          name: 'query_loaded_csv',
          description: 'Query data from previously loaded files',
          inputSchema: {
            type: 'object',
            properties: {
              table: {
                type: 'string',
                description: 'Name of the data table to query',
              },
              operation: {
                type: 'string',
                enum: ['count', 'sum', 'group_by', 'filter', 'get_columns', 'sample', 'all'],
                description: 'Type of operation to perform',
              },
              column: {
                type: 'string',
                description: 'Column name for operations that need it (sum, group_by, filter)',
              },
              value: {
                type: 'string',
                description: 'Value for filter operations',
              },
              limit: {
                type: 'number',
                description: 'Limit number of results (default: 100)',
              }
            },
            required: ['table', 'operation'],
          },
        },
        {
          name: 'analyze_nf_data',
          description: 'Perform specific analysis on Brazilian NF (Nota Fiscal) data',
          inputSchema: {
            type: 'object',
            properties: {
              analysis_type: {
                type: 'string',
                enum: ['total_nfs', 'uf_values', 'internet_cities', 'category_values'],
                description: 'Type of analysis to perform',
              },
              category: {
                type: 'string',
                description: 'Category name for category_values analysis (e.g., "Livros")',
              }
            },
            required: ['analysis_type'],
          },
        }
      ]
    };
  }

  async handleCallTool(params: any) {
    const { name, arguments: args } = params;
    console.log(`🔧 Executing tool: ${name} with args:`, args);

    switch (name) {
      case 'load_csv_from_drive':
        return await this.handleLoadCSVFromDrive(args.fileId);
      case 'list_drive_files':
        return await this.handleListDriveFiles();
      case 'query_loaded_csv':
        return await this.handleQueryLoadedCSV(args);
      case 'analyze_nf_data':
        return await this.handleAnalyzeNFData(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // Enhanced handleLoadCSVFromDrive method that supports multiple file types
  async handleLoadCSVFromDrive(fileId: string) {
    const tempZipPath = `/tmp/download-${uuidv4()}.zip`;
    const extractPath = `/tmp/extracted-${uuidv4()}`;
    
    try {
      console.log(`📥 Starting data load from Drive for file ID: ${fileId}`);
      
      if (!fileId || typeof fileId !== 'string') {
        throw new Error('File ID is required and must be a string');
      }
      
      if (!this.driveHandler.isAuthenticated()) {
        throw new Error('Google Drive not authenticated. Please complete OAuth flow first.');
      }
      
      // Download file
      await this.driveHandler.downloadFile(fileId, tempZipPath);
      const stats = await fs.stat(tempZipPath);
      console.log(`📦 Downloaded file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty. Please check the file ID and permissions.');
      }
      
      if (stats.size > 100 * 1024 * 1024) { // 100MB limit
        throw new Error('File is too large (>100MB). Please use a smaller file.');
      }

      // Extract all files from ZIP
      const extractedFiles = await this.zipHandler.extractZip(tempZipPath, extractPath);
      console.log(`📂 Extracted ${extractedFiles.length} files`);

      if (extractedFiles.length === 0) {
        throw new Error('No supported files found in the zip archive. Supported formats: CSV, XLSX, XLS, TSV, TXT');
      }

      // Initialize Excel parser if not exists
      if (!this.excelParser) {
        const { ExcelParser } = require('./excel-parser');
        this.excelParser = new ExcelParser();
      }

      const loadResults: string[] = [];
      let totalRows = 0;
      let successCount = 0;
      
      for (const fileInfo of extractedFiles) {
        try {
          const { path: filePath, name: fileName, type: fileType } = fileInfo;
          console.log(`📊 Processing ${fileName} (${fileType})`);
          
          let data;
          let tableName = fileName;
          
          if (fileType === '.csv' || fileType === '.tsv' || fileType === '.txt') {
            // Parse as CSV/TSV
            data = await this.csvParser.parseCSV(filePath);
            this.loadedData.set(tableName, data);
            
            console.log(`✅ Loaded ${data.length} rows from ${fileName}`);
            loadResults.push(`✅ ${fileName}: ${data.length} rows loaded (CSV format)`);
            totalRows += data.length;
            successCount++;
            
          } else if (fileType === '.xlsx' || fileType === '.xls') {
            // Parse as Excel
            const excelData = await this.excelParser.parseExcel(filePath);
            
            // Handle multiple sheets
            const sheetNames = Object.keys(excelData);
            console.log(`📋 Excel file has ${sheetNames.length} sheets: ${sheetNames.join(', ')}`);
            
            for (const sheetName of sheetNames) {
              const sheetData = excelData[sheetName];
              if (sheetData && sheetData.length > 0) {
                // Create table name: filename_sheetname
                const baseFileName = fileName.replace(/\.(xlsx|xls)$/i, '');
                const sheetTableName = sheetNames.length > 1 
                  ? `${baseFileName}_${sheetName.replace(/[^\w]/g, '_')}.csv`
                  : `${baseFileName}.csv`;
                
                this.loadedData.set(sheetTableName, sheetData);
                
                console.log(`✅ Loaded ${sheetData.length} rows from ${fileName}:${sheetName}`);
                loadResults.push(`✅ ${sheetTableName}: ${sheetData.length} rows loaded (Excel sheet: ${sheetName})`);
                totalRows += sheetData.length;
                successCount++;
              }
            }
          }
          
        } catch (parseError: any) {
          console.error(`❌ Error parsing ${fileInfo.name}:`, parseError.message);
          loadResults.push(`❌ ${fileInfo.name}: Error - ${parseError.message}`);
        }
      }

      if (successCount === 0) {
        throw new Error('No files could be processed successfully. Check file formats and content.');
      }

      const summary = `
📊 Data Loading Complete!
========================

📁 Files processed: ${extractedFiles.length}
✅ Successfully loaded: ${successCount}
❌ Failed to load: ${extractedFiles.length - successCount}
📊 Total rows loaded: ${totalRows}

📋 Available Tables:
${Array.from(this.loadedData.keys()).map(table => `  • ${table}`).join('\n')}

📝 Processing Details:
${loadResults.join('\n')}

🔧 Next Steps:
- Use "query_loaded_csv" to explore the data
- Specify table name from the list above
- Use operations: count, sample, get_columns, filter, etc.

💡 Example: Query the first table with operation "sample" to see the data structure
`;

      return {
        content: [
          {
            type: 'text',
            text: summary,
          },
        ],
      };

    } catch (error: any) {
      console.error('❌ Error in handleLoadCSVFromDrive:', error.message);
      
      let errorMessage = `Failed to load data from Google Drive\n\n`;
      errorMessage += `Error: ${error.message}\n\n`;
      
      if (error.message.includes('No supported files')) {
        errorMessage += `📋 Supported file formats:\n`;
        errorMessage += `• CSV files (.csv)\n`;
        errorMessage += `• Excel files (.xlsx, .xls)\n`;
        errorMessage += `• Tab-separated files (.tsv)\n`;
        errorMessage += `• Text files (.txt)\n\n`;
      }
      
      errorMessage += `🔍 Troubleshooting:\n`;
      errorMessage += `1. Verify the ZIP contains data files\n`;
      errorMessage += `2. Check file formats are supported\n`;
      errorMessage += `3. Ensure files are not corrupted\n`;
      errorMessage += `4. Try with a smaller file if size is the issue\n`;
      
      throw new Error(errorMessage);
    } finally {
      try {
        await fs.unlink(tempZipPath).catch(() => {});
        await fs.rmdir(extractPath, { recursive: true }).catch(() => {});
      } catch (cleanupError: any) {
        console.warn('⚠️ Cleanup error:', cleanupError.message);
      }
    }
  }

  async handleListDriveFiles() {
    try {
      const files = await this.driveHandler.listFiles();
      const fileList = files.map((file: any) => 
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
    } catch (error: any) {
      throw new Error(`Failed to list Drive files: ${error.message}`);
    }
  }

  async handleQueryLoadedCSV(args: any) {
    const { table, operation, column, value, limit = 100 } = args;
    
    if (!this.loadedData.has(table)) {
      throw new Error(`Table ${table} not found. Available tables: ${Array.from(this.loadedData.keys()).join(', ')}`);
    }
    
    const data = this.loadedData.get(table);
    let result: any;
    
    switch (operation) {
      case 'count':
        result = data?.length || 0;
        break;
        
      case 'get_columns':
        result = (data && data.length > 0) ? Object.keys(data[0]) : [];
        break;
        
      case 'sample':
        result = data?.slice(0, Math.min(limit, 10)) || [];
        break;
        
      case 'sum':
        if (!column) throw new Error('Column is required for sum operation');
        result = (data || []).reduce((sum: number, row: any) => {
          const val = parseFloat(String(row[column] || 0));
          return sum + (isNaN(val) ? 0 : val);
        }, 0);
        break;
        
      case 'group_by':
        if (!column) throw new Error('Column is required for group_by operation');
        const groups: any = {};
        (data || []).forEach((row: any) => {
          const key = row[column];
          if (!groups[key]) groups[key] = [];
          groups[key].push(row);
        });
        result = Object.keys(groups).map(key => {
          const totalValue = groups[key].reduce((sum: number, item: any) => {
            const val = parseFloat(String(item.valor_total || item.valor || 0));
            return sum + (isNaN(val) ? 0 : val);
          }, 0);
          return {
            [column]: key,
            count: groups[key].length,
            total_value: totalValue,
            items: groups[key].slice(0, 3)
          };
        }).sort((a: any, b: any) => (b.total_value || 0) - (a.total_value || 0));
        break;
        
      case 'filter':
        if (!column || value === undefined) throw new Error('Column and value are required for filter operation');
        result = (data ||