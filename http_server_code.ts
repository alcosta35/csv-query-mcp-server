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
const { ExcelParser } = require('./excel_parser');
const { ZipHandler } = require('./zip-handler');
const { GoogleDriveOAuthHandler } = require('./google_drive_oauth_handler');

class HTTPMCPServer {
  app: any;
  csvParser: any;
  excelParser: any;
  zipHandler: any;
  driveHandler: any;
  loadedData: Map<string, any>;
  authToken: string;

  constructor() {
    console.log('=== MCP Server Starting ===');
    
    this.app = express();
    this.authToken = process.env.MCP_AUTH_TOKEN || 'default-dev-token';
    this.loadedData = new Map();
    
    // Initialize handlers
    this.csvParser = new CSVParser();
    this.excelParser = new ExcelParser();
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
    this.app.get('/', (req: any, res: any) => {
      res.json({ 
        status: 'CSV Query MCP Server is running',
        timestamp: new Date().toISOString()
      });
    });

    this.app.get('/health', (req: any, res: any) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        loadedTables: Array.from(this.loadedData.keys()),
        totalRecords: Array.from(this.loadedData.values()).reduce((sum, data) => {
          if (Array.isArray(data)) return sum + data.length;
          if (typeof data === 'object' && data !== null) {
            return sum + Object.values(data).reduce((sheetSum: number, sheet: any) => {
              return sheetSum + (Array.isArray(sheet) ? sheet.length : 0);
            }, 0);
          }
          return sum;
        }, 0)
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
        },
        {
          name: 'query_data',
          description: 'Query loaded data with SQL-like syntax',
          inputSchema: {
            type: 'object',
            properties: {
              table: { type: 'string', description: 'Table/file name to query' },
              query: { type: 'string', description: 'Query description in natural language' }
            },
            required: ['table', 'query']
          }
        },
        {
          name: 'list_loaded_data',
          description: 'List all currently loaded data tables and their schemas',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'write_csv_to_drive',
          description: 'Write data as CSV file to Google Drive',
          inputSchema: {
            type: 'object',
            properties: {
              data: { 
                type: 'array', 
                description: 'Array of objects to write as CSV' 
              },
              filename: { 
                type: 'string', 
                description: 'Name for the CSV file (without .csv extension)' 
              },
              tableName: {
                type: 'string',
                description: 'Optional: name of loaded table to export'
              }
            },
            required: ['filename']
          }
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
      case 'query_data':
        return await this.handleQueryData(args.table, args.query);
      case 'write_csv_to_drive':
        return await this.handleWriteCSVToDrive(args.data, args.filename, args.tableName);
      case 'list_loaded_data':
        return await this.handleListLoadedData();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // Fixed file parsing logic
  async parseFileByType(filePath: string, fileName: string): Promise<any> {
    const fileExtension = path.extname(fileName).toLowerCase();
    
    console.log(`🔍 Parsing ${fileName} (${fileExtension})`);
    
    try {
      switch (fileExtension) {
        case '.xlsx':
        case '.xls':
          console.log(`📊 Using Excel parser for ${fileName}`);
          return await this.excelParser.parseExcel(filePath);
          
        case '.csv':
        case '.tsv':
        case '.txt':
          console.log(`📄 Using CSV parser for ${fileName}`);
          return await this.csvParser.parseCSV(filePath);
          
        default:
          throw new Error(`Unsupported file type: ${fileExtension}`);
      }
    } catch (error: any) {
      console.error(`❌ Failed to parse ${fileName}:`, error.message);
      throw error;
    }
  }

  async handleLoadFromDrive(fileId: string) {
    try {
      console.log(`Loading file: ${fileId}`);
      
      if (!fileId) {
        throw new Error('File ID is required');
      }

      const tempZipPath = `/tmp/download-${Date.now()}.zip`;
      const extractPath = `/tmp/extracted-${Date.now()}`;
      
      // Download the file
      await this.driveHandler.downloadFile(fileId, tempZipPath);
      
      // Check file size
      const stats = await fs.stat(tempZipPath);
      console.log(`Downloaded file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      // Extract files
      const extractedFiles = await this.zipHandler.extractZip(tempZipPath, extractPath);
      console.log(`Extracted ${extractedFiles.length} files`);
      
      if (extractedFiles.length === 0) {
        throw new Error('No files found in ZIP archive');
      }

      // Parse files with correct parser
      let loadedCount = 0;
      const results: string[] = [];
      
      for (const fileInfo of extractedFiles) {
        try {
          const filePath = typeof fileInfo === 'string' ? fileInfo : fileInfo.path;
          const fileName = typeof fileInfo === 'string' 
            ? path.basename(fileInfo) 
            : fileInfo.name || path.basename(fileInfo.path);
          
          console.log(`Processing: ${fileName}`);
          
          // Parse with appropriate parser
          const data = await this.parseFileByType(filePath, fileName);
          
          // Handle different data structures
          if (typeof data === 'object' && !Array.isArray(data)) {
            // Excel file with multiple sheets
            let totalRecords = 0;
            const sheetNames = Object.keys(data);
            
            // Store each sheet individually for querying
            for (const [sheetName, sheetData] of Object.entries(data)) {
              if (Array.isArray(sheetData)) {
                totalRecords += sheetData.length;
                const key = `${fileName}_${sheetName}`;
                this.loadedData.set(key, sheetData);
                console.log(`📊 Stored sheet: ${key} with ${sheetData.length} records`);
              }
            }
            
            // Also store the full Excel object
            this.loadedData.set(fileName, data);
            
            // If there's a main sheet with most data, also store it with the filename
            if (sheetNames.length > 0) {
              const mainSheet = sheetNames.find(name => 
                name.toLowerCase().includes(fileName.toLowerCase().replace('.xlsx', '').replace('.xls', ''))
              ) || sheetNames[0];
              
              if (data[mainSheet] && Array.isArray(data[mainSheet])) {
                this.loadedData.set(fileName.replace('.xlsx', '').replace('.xls', ''), data[mainSheet]);
                console.log(`📊 Main sheet "${mainSheet}" also stored as: ${fileName.replace('.xlsx', '').replace('.xls', '')}`);
              }
            }
            
            results.push(`✅ ${fileName}: ${totalRecords} records (${sheetNames.length} sheets: ${sheetNames.join(', ')})`);
          } else if (Array.isArray(data)) {
            // CSV file or single sheet Excel
            this.loadedData.set(fileName, data);
            results.push(`✅ ${fileName}: ${data.length} records`);
          } else {
            results.push(`⚠️ ${fileName}: Unknown data format`);
          }
          
          loadedCount++;
          
        } catch (parseError: any) {
          console.error(`Failed to parse ${fileInfo}:`, parseError.message);
          results.push(`❌ ${fileInfo}: ${parseError.message}`);
        }
      }

      // Cleanup temp files
      try {
        await fs.unlink(tempZipPath);
        await fs.rmdir(extractPath, { recursive: true });
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError);
      }

      const summary = `Loaded ${loadedCount}/${extractedFiles.length} files:\n${results.join('\n')}`;
      
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
        `${file.name} (ID: ${file.id}, Size: ${file.size} bytes)`
      ).join('\n');

      return {
        content: [{ type: 'text', text: `Files:\n${fileList}` }]
      };
    } catch (error: any) {
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  async handleWriteCSVToDrive(data: any[] | undefined, filename: string, tableName?: string) {
    try {
      let csvData: any[] = [];
      let sourceDescription = '';
      
      // Determine data source
      if (tableName) {
        console.log(`📊 Looking for table: ${tableName}`);
        
        // Try exact match first
        let tableData = this.loadedData.get(tableName);
        let actualTableName = tableName;
        
        if (!tableData) {
          // Try to find by partial match or sheet name
          const availableKeys = Array.from(this.loadedData.keys());
          console.log(`📊 Available tables: ${availableKeys.join(', ')}`);
          
          // Look for sheet-specific match (filename_sheetname)
          const sheetMatch = availableKeys.find(key => 
            key.includes(tableName) || tableName.includes(key.split('_')[0])
          );
          
          if (sheetMatch) {
            tableData = this.loadedData.get(sheetMatch);
            actualTableName = sheetMatch;
            console.log(`📊 Found sheet match: ${sheetMatch}`);
          } else {
            // Look for base filename without extension
            const baseName = tableName.replace('.xlsx', '').replace('.xls', '');
            const baseMatch = availableKeys.find(key => {
              return key === baseName || key.includes(baseName);
            });
            
            if (baseMatch) {
              tableData = this.loadedData.get(baseMatch);
              actualTableName = baseMatch;
              console.log(`📊 Found base match: ${baseMatch}`);
            }
          }
        }
        
        if (tableData) {
          if (Array.isArray(tableData)) {
            csvData = tableData;
            sourceDescription = `from table: ${actualTableName}`;
          } else if (typeof tableData === 'object' && tableData !== null) {
            // Excel file with multiple sheets - use first sheet or largest sheet
            const sheets = Object.keys(tableData);
            console.log(`📊 Excel file has sheets: ${sheets.join(', ')}`);
            
            if (sheets.length === 1) {
              csvData = tableData[sheets[0]];
              sourceDescription = `from sheet: ${actualTableName}_${sheets[0]}`;
            } else {
              // Find the largest sheet
              let largestSheet = sheets[0];
              let maxRecords = 0;
              
              sheets.forEach(sheetName => {
                const sheetData = tableData[sheetName];
                if (Array.isArray(sheetData) && sheetData.length > maxRecords) {
                  maxRecords = sheetData.length;
                  largestSheet = sheetName;
                }
              });
              
              csvData = tableData[largestSheet];
              sourceDescription = `from largest sheet: ${actualTableName}_${largestSheet}`;
              console.log(`📊 Using largest sheet: ${largestSheet} with ${maxRecords} records`);
            }
          }
        } else {
          const availableTables = Array.from(this.loadedData.keys());
          throw new Error(`Table '${tableName}' not found. Available: ${availableTables.join(', ')}`);
        }
      } else if (data && Array.isArray(data)) {
        console.log(`📊 Using provided data array`);
        csvData = data;
        sourceDescription = 'from provided data array';
      } else {
        throw new Error('No valid data provided. Either provide data array or specify a loaded tableName.');
      }

      if (!csvData || csvData.length === 0) {
        throw new Error(`No data to write ${sourceDescription}`);
      }

      console.log(`📊 Preparing to write ${csvData.length} records to CSV ${sourceDescription}`);

      // Convert data to CSV format
      const csvContent = this.convertToCSV(csvData);
      
      // Create temporary file
      const tempDir = '/tmp';
      const tempFilePath = `${tempDir}/${filename.replace(/\.csv$/, '')}.csv`;
      
      await fs.writeFile(tempFilePath, csvContent, 'utf8');
      console.log(`📄 Created temporary CSV file: ${tempFilePath}`);

      // Upload to Google Drive
      const fileId = await this.driveHandler.uploadFile(tempFilePath, `${filename.replace(/\.csv$/, '')}.csv`);
      
      // Cleanup temp file
      try {
        await fs.unlink(tempFilePath);
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError);
      }

      const summary = `✅ Successfully wrote ${csvData.length} records to Google Drive\n` +
                     `📄 File: ${filename.replace(/\.csv$/, '')}.csv\n` +
                     `📊 Source: ${sourceDescription}\n` +
                     `🆔 File ID: ${fileId}\n` +
                     `📊 Columns: ${csvData.length > 0 ? Object.keys(csvData[0]).length : 0}`;

      return {
        content: [{ 
          type: 'text', 
          text: summary 
        }]
      };

    } catch (error: any) {
      console.error('Write CSV error:', error);
      throw new Error(`Failed to write CSV: ${error.message}`);
    }
  }

  private convertToCSV(data: any[]): string {
    if (!data || data.length === 0) {
      return '';
    }

    // Get all unique headers from all objects
    const allHeaders = new Set<string>();
    data.forEach(row => {
      if (row && typeof row === 'object') {
        Object.keys(row).forEach(key => allHeaders.add(key));
      }
    });

    const headers = Array.from(allHeaders);
    
    // Create CSV content
    const csvRows: string[] = [];
    
    // Add header row
    csvRows.push(headers.map(header => this.escapeCSVField(header)).join(','));
    
    // Add data rows
    data.forEach(row => {
      if (row && typeof row === 'object') {
        const csvRow = headers.map(header => {
          const value = row[header];
          return this.escapeCSVField(value);
        });
        csvRows.push(csvRow.join(','));
      }
    });

    return csvRows.join('\n');
  }

  private escapeCSVField(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    const stringValue = String(value);
    
    // If the value contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }

  async handleListLoadedData() {
    try {
      if (this.loadedData.size === 0) {
        return {
          content: [{ type: 'text', text: 'No data loaded yet. Use load_csv_from_drive first.' }]
        };
      }

      const tables = Array.from(this.loadedData.entries()).map(([name, data]) => {
        if (Array.isArray(data)) {
          const sampleKeys = data.length > 0 ? Object.keys(data[0]).slice(0, 5) : [];
          return `📊 ${name}: ${data.length} records, columns: ${sampleKeys.join(', ')}${sampleKeys.length < Object.keys(data[0] || {}).length ? '...' : ''}`;
        } else if (typeof data === 'object' && data !== null) {
          const sheets = Object.keys(data);
          const sheetInfo = sheets.map(sheet => {
            const sheetData = data[sheet];
            return `${sheet} (${Array.isArray(sheetData) ? sheetData.length : 0} records)`;
          });
          return `📁 ${name}: Excel file with sheets: ${sheetInfo.join(', ')}`;
        }
        return `❓ ${name}: Unknown format`;
      });

      return {
        content: [{ type: 'text', text: `Loaded data:\n${tables.join('\n')}` }]
      };
    } catch (error: any) {
      throw new Error(`Failed to list data: ${error.message}`);
    }
  }

  async handleQueryData(tableName: string, query: string) {
    try {
      // First, try exact match
      let data = this.loadedData.get(tableName);
      let actualTableName = tableName;
      
      if (!data) {
        // Try to find by partial match or sheet name
        const availableKeys = Array.from(this.loadedData.keys());
        
        // Look for sheet-specific match (filename_sheetname)
        const sheetMatch = availableKeys.find(key => 
          key.includes(tableName) || tableName.includes(key.split('_')[0])
        );
        
        if (sheetMatch) {
          data = this.loadedData.get(sheetMatch);
          actualTableName = sheetMatch;
        } else {
          // Look for base filename without extension
          const baseMatch = availableKeys.find(key => {
            const baseName = tableName.replace('.xlsx', '').replace('.xls', '');
            return key === baseName || key.includes(baseName);
          });
          
          if (baseMatch) {
            data = this.loadedData.get(baseMatch);
            actualTableName = baseMatch;
          }
        }
        
        if (!data) {
          const availableTables = availableKeys.filter(key => 
            this.loadedData.get(key) && Array.isArray(this.loadedData.get(key))
          );
          throw new Error(`Table '${tableName}' not found. Available queryable tables: ${availableTables.join(', ')}`);
        }
      }
      
      // If data is an Excel object with multiple sheets, try to get the main sheet
      if (typeof data === 'object' && !Array.isArray(data)) {
        const sheets = Object.keys(data);
        if (sheets.length === 1) {
          data = data[sheets[0]];
          actualTableName = `${actualTableName}_${sheets[0]}`;
        } else {
          // Multiple sheets - suggest specific sheet names
          const sheetOptions = sheets.map(sheet => `${tableName}_${sheet}`);
          throw new Error(`Table '${tableName}' has multiple sheets. Please specify: ${sheetOptions.join(', ')}`);
        }
      }
      
      if (!Array.isArray(data)) {
        throw new Error(`Table '${actualTableName}' is not queryable. Data type: ${typeof data}`);
      }

      // Simple query processing
      let result = data;
      const lowerQuery = query.toLowerCase();

      // Basic filtering examples
      if (lowerQuery.includes('count') || lowerQuery.includes('total')) {
        return {
          content: [{ type: 'text', text: `Total records in ${actualTableName}: ${data.length}` }]
        };
      }

      if (lowerQuery.includes('columns') || lowerQuery.includes('fields')) {
        const columns = data.length > 0 ? Object.keys(data[0]) : [];
        return {
          content: [{ type: 'text', text: `Columns in ${actualTableName}: ${columns.join(', ')}` }]
        };
      }

      if (lowerQuery.includes('sample') || lowerQuery.includes('first')) {
        const sample = data.slice(0, 5);
        return {
          content: [{ type: 'text', text: `Sample data from ${actualTableName}:\n${JSON.stringify(sample, null, 2)}` }]
        };
      }

      // Advanced queries
      if (lowerQuery.includes('summary') || lowerQuery.includes('describe')) {
        const summary = this.generateDataSummary(data, actualTableName);
        return {
          content: [{ type: 'text', text: summary }]
        };
      }

      return {
        content: [{ type: 'text', text: `Query processed for ${actualTableName} (${data.length} records). Use queries like 'count', 'columns', 'sample', or 'summary' for more specific results.` }]
      };
      
    } catch (error: any) {
      throw new Error(`Query failed: ${error.message}`);
    }
  }

  private generateDataSummary(data: any[], tableName: string): string {
    if (!data || data.length === 0) {
      return `Table ${tableName} is empty.`;
    }

    const columns = Object.keys(data[0]);
    const summary = [`📊 Summary for ${tableName}:`, `Records: ${data.length}`, `Columns: ${columns.length}`];
    
    // Analyze each column
    columns.slice(0, 10).forEach(col => { // Limit to first 10 columns
      const values = data.map(row => row[col]).filter(val => val !== null && val !== undefined && val !== '');
      const uniqueCount = new Set(values).size;
      const nullCount = data.length - values.length;
      
      summary.push(`  • ${col}: ${uniqueCount} unique values, ${nullCount} nulls`);
    });

    if (columns.length > 10) {
      summary.push(`  ... and ${columns.length - 10} more columns`);
    }

    return summary.join('\n');
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