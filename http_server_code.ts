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
      console.warn(⚠️ Cleanup error:', cleanupError.message);
    }
  }
}