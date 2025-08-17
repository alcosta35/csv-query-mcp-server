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
  excelParser: any;

  constructor() {
    console.log('=== MCP Server Starting ===');
    console.log('Environment:', process.env.NODE_ENV);
    
    this.app = express();
    this.authToken = process.env.MCP_AUTH_TOKEN || 'default-dev-token';
    this.loadedData = new Map();
    
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
          <p><a href="/health">Check server status</a></p>
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
      
      await this.driveHandler.downloadFile(fileId, tempZipPath);
      const stats = await fs.stat(tempZipPath);
      console.log(`📦 Downloaded file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty. Please check the file ID and permissions.');
      }
      
      if (stats.size > 100 * 1024 * 1024) {
        throw new Error('File is too large (>100MB). Please use a smaller file.');
      }

      const extractedFiles = await this.zipHandler.extractZip(tempZipPath, extractPath);
      console.log(`📂 Extracted ${extractedFiles.length} files`);

      if (extractedFiles.length === 0) {
        throw new Error('No supported files found in the zip archive. Supported formats: CSV, XLSX, XLS, TSV, TXT');
      }

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
          
          if (fileType === '.csv' || fileType === '.tsv' || fileType === '.txt') {
            const data = await this.csvParser.parseCSV(filePath);
            this.loadedData.set(fileName, data);
            
            console.log(`✅ Loaded ${data.length} rows from ${fileName}`);
            loadResults.push(`✅ ${fileName}: ${data.length} rows loaded (CSV format)`);
            totalRows += data.length;
            successCount++;
            
          } else if (fileType === '.xlsx' || fileType === '.xls') {
            const excelData = await this.excelParser.parseExcel(filePath);
            const sheetNames = Object.keys(excelData);
            console.log(`📋 Excel file has ${sheetNames.length} sheets: ${sheetNames.join(', ')}`);
            
            for (const sheetName of sheetNames) {
              const sheetData = excelData[sheetName];
              if (sheetData && sheetData.length > 0) {
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
        result = (data || []).filter((row: any) => {
          const rowValue = String(row[column] || '').toLowerCase();
          const searchValue = String(value).toLowerCase();
          return rowValue.includes(searchValue);
        }).slice(0, limit);
        break;
        
      case 'all':
        result = (data || []).slice(0, limit);
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `Query result for ${table} (${operation}):\n\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  }

  async handleAnalyzeNFData(args: any) {
    const { analysis_type, category } = args;
    
    const cabecalho = this.loadedData.get('202401_NFs_Cabecalho.csv');
    const itens = this.loadedData.get('202401_NFs_Itens.csv');
    
    if (!cabecalho) {
      throw new Error('202401_NFs_Cabecalho.csv not loaded. Please load the data first using load_csv_from_drive.');
    }
    
    let result: any;
    
    switch (analysis_type) {
      case 'total_nfs':
        result = {
          total_notas_fiscais: cabecalho.length,
          periodo: 'Janeiro 2024'
        };
        break;
        
      case 'uf_values':
        const ufColumn = this.findColumn(cabecalho[0], ['uf_emitente', 'uf', 'uf emitente', 'estado']);
        const valorColumn = this.findColumn(cabecalho[0], ['valor_total', 'valor', 'valor total', 'total']);
        
        if (!ufColumn || !valorColumn) {
          throw new Error(`Required columns not found. Available columns: ${Object.keys(cabecalho[0]).join(', ')}`);
        }
        
        const ufGroups: any = {};
        cabecalho.forEach((nf: any) => {
          const uf = nf[ufColumn];
          const valor = parseFloat(String(nf[valorColumn] || 0));
          
          if (uf && !ufGroups[uf]) ufGroups[uf] = 0;
          if (uf && !isNaN(valor)) ufGroups[uf] = (ufGroups[uf] || 0) + valor;
        });
        
        const sortedUFs = Object.entries(ufGroups)
          .map(([uf, total]) => ({ uf, valor_total: total as number }))
          .sort((a, b) => (b.valor_total || 0) - (a.valor_total || 0));
          
        result = {
          uf_com_maior_valor: sortedUFs[0],
          ranking_completo: sortedUFs,
          colunas_usadas: { uf: ufColumn, valor: valorColumn }
        };
        break;
        
      case 'internet_cities':
        const internetColumn = this.findColumn(cabecalho[0], ['internet', 'operacao_internet', 'operação internet', 'via_internet']);
        const cidadeColumn = this.findColumn(cabecalho[0], ['cidade_emitente', 'cidade', 'cidade emitente', 'municipio']);
        
        if (!internetColumn || !cidadeColumn) {
          throw new Error(`Required columns not found. Available columns: ${Object.keys(cabecalho[0]).join(', ')}`);
        }
        
        const internetOps = cabecalho.filter((nf: any) => {
          const internet = String(nf[internetColumn] || '').toLowerCase();
          return internet === 's' || internet === 'sim' || internet === 'true' || internet === '1';
        });
        
        const cityGroups: any = {};
        internetOps.forEach((nf: any) => {
          const cidade = nf[cidadeColumn];
          if (cidade && !cityGroups[cidade]) cityGroups[cidade] = 0;
          if (cidade) cityGroups[cidade] = (cityGroups[cidade] || 0) + 1;
        });
        
        const sortedCities = Object.entries(cityGroups)
          .map(([cidade, operacoes]) => ({ cidade, operacoes_internet: operacoes as number }))
          .sort((a, b) => (b.operacoes_internet || 0) - (a.operacoes_internet || 0))
          .slice(0, 2);
          
        result = {
          duas_cidades_mais_operacoes_internet: sortedCities,
          total_operacoes_internet: internetOps.length,
          total_notas_fiscais: cabecalho.length,
          colunas_usadas: { internet: internetColumn, cidade: cidadeColumn }
        };
        break;
        
      case 'category_values':
        if (!itens) {
          throw new Error('202401_NFs_Itens.csv not loaded. Cannot analyze category values.');
        }
        
        const categoryFilter = category || 'Livros';
        const descColumn = this.findColumn(itens[0], ['descricao', 'produto', 'item', 'categoria']);
        const valorItemColumn = this.findColumn(itens[0], ['valor', 'valor_item', 'valor item', 'preco']);
        
        if (!descColumn || !valorItemColumn) {
          throw new Error(`Required columns not found. Available columns: ${Object.keys(itens[0]).join(', ')}`);
        }
        
        const categoryItems = itens.filter((item: any) => {
          const desc = String(item[descColumn] || '').toLowerCase();
          return desc.includes(categoryFilter.toLowerCase());
        });
        
        const totalValue = categoryItems.reduce((sum: number, item: any) => {
          const valor = parseFloat(String(item[valorItemColumn] || 0));
          return sum + (isNaN(valor) ? 0 : valor);
        }, 0);
        
        result = {
          categoria: categoryFilter,
          total_valor: totalValue,
          quantidade_itens: categoryItems.length,
          itens_encontrados: categoryItems.slice(0, 5).map((item: any) => ({
            descricao: item[descColumn],
            valor: item[valorItemColumn]
          })),
          colunas_usadas: { descricao: descColumn, valor: valorItemColumn }
        };
        break;
        
      default:
        throw new Error(`Unknown analysis type: ${analysis_type}`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `Análise NF (${analysis_type}):\n\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  }

  findColumn(row: any, possibleNames: string[]): string | null {
    if (!row) return null;
    
    const keys = Object.keys(row);
    for (const name of possibleNames) {
      if (keys.includes(name)) return name;
      
      const found = keys.find(key => key.toLowerCase() === name.toLowerCase());
      if (found) return found;
      
      const partial = keys.find(key => key.toLowerCase().includes(name.toLowerCase()));
      if (partial) return partial;
    }
    return null;
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