/// <reference path="./globals.d.ts" />
const XLSX = require('xlsx');
const fs = require('fs').promises;

export class ExcelParser {
  async parseExcel(filePath: string) {
    try {
      console.log(`📊 Reading Excel file: ${filePath}`);
      
      const stats = await fs.stat(filePath);
      console.log(`📊 Excel file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error(`Excel file is empty: ${filePath}`);
      }
      
      const fileBuffer = await fs.readFile(filePath);
      
      const workbook = XLSX.read(fileBuffer, {
        type: 'buffer',
        cellText: false,
        cellDates: true,
        dateNF: 'yyyy-mm-dd',
        cellNF: false,
        cellStyles: false
      });
      
      console.log(`📋 Found ${workbook.SheetNames.length} sheets: ${workbook.SheetNames.join(', ')}`);
      
      const allSheets: any = {};
      let totalRows = 0;
      
      for (const sheetName of workbook.SheetNames) {
        console.log(`📄 Processing sheet: ${sheetName}`);
        
        const worksheet = workbook.Sheets[sheetName];
        
        // Get the range of the worksheet
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
        console.log(`📊 Sheet range: ${worksheet['!ref'] || 'A1:A1'}`);
        
        // Convert to JSON with proper options
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: null,
          blankrows: false,
          raw: false,
          dateNF: 'yyyy-mm-dd'
        });
        
        if (jsonData.length === 0) {
          console.log(`⚠️ Sheet ${sheetName} is empty, skipping`);
          continue;
        }
        
        // Get headers from first row
        const headers = jsonData[0] as any[];
        const dataRows = jsonData.slice(1);
        
        console.log(`📊 Sheet ${sheetName}: ${headers.length} columns, ${dataRows.length} data rows`);
        
        // Convert to objects with clean headers
        const processedData = dataRows
          .filter(row => {
            // Filter out completely empty rows
            if (!row || !Array.isArray(row)) return false;
            return row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
          })
          .map((row: any[], index: number) => {
            const obj: any = {};
            headers.forEach((header, colIndex) => {
              const cleanHeader = String(header || `column_${colIndex}`)
                .trim()
                .toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^\w_]/g, '')
                .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
                .replace(/_+/g, '_'); // Replace multiple underscores with single
              
              let cellValue = (row as any[])[colIndex];
              
              // Handle different data types
              if (cellValue === null || cellValue === undefined) {
                cellValue = null;
              } else if (typeof cellValue === 'string') {
                cellValue = cellValue.trim();
                if (cellValue === '' || cellValue.toLowerCase() === 'null') {
                  cellValue = null;
                }
              } else if (typeof cellValue === 'number') {
                // Keep as number
              } else if (cellValue instanceof Date) {
                cellValue = cellValue.toISOString().split('T')[0];
              }
              
              obj[cleanHeader || `column_${colIndex}`] = cellValue;
            });
            return obj;
          });
        
        allSheets[sheetName] = processedData;
        totalRows += processedData.length;
        
        console.log(`✅ Processed sheet ${sheetName}: ${processedData.length} rows, ${headers.length} columns`);
        
        // Log sample data
        if (processedData.length > 0) {
          console.log(`📋 Sample columns: ${Object.keys(processedData[0]).slice(0, 5).join(', ')}`);
        }
      }
      
      console.log(`📊 Successfully processed ${Object.keys(allSheets).length} sheets with ${totalRows} total rows`);
      
      // If only one sheet, return the data directly as an array for easier querying
      const sheetNames = Object.keys(allSheets);
      if (sheetNames.length === 1) {
        console.log(`📊 Single sheet detected, returning data as array`);
        return allSheets[sheetNames[0]];
      }
      
      return allSheets;
      
    } catch (error: any) {
      console.error(`❌ Error parsing Excel file ${filePath}:`, error);
      throw new Error(`Failed to parse Excel file ${filePath}: ${error.message}`);
    }
  }
}