/// <reference path="./globals.d.ts" />
const XLSX = require('xlsx');
const fs = require('fs').promises;

export class ExcelParser {
  async parseExcel(filePath) {
    try {
      console.log(`📊 Reading Excel file: ${filePath}`);
      
      // Check if file exists and get stats
      const stats = await fs.stat(filePath);
      console.log(`📊 Excel file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error(`Excel file is empty: ${filePath}`);
      }
      
      // Read the file
      const fileBuffer = await fs.readFile(filePath);
      
      // Parse the Excel file
      const workbook = XLSX.read(fileBuffer, {
        type: 'buffer',
        cellText: false,
        cellDates: true,
        dateNF: 'yyyy-mm-dd'
      });
      
      console.log(`📋 Found ${workbook.SheetNames.length} sheets: ${workbook.SheetNames.join(', ')}`);
      
      // Convert all sheets to JSON
      const allSheets = {};
      let totalRows = 0;
      
      for (const sheetName of workbook.SheetNames) {
        console.log(`📄 Processing sheet: ${sheetName}`);
        
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1, // Use first row as header
          defval: null, // Default value for empty cells
          blankrows: false // Skip blank rows
        });
        
        if (jsonData.length === 0) {
          console.log(`⚠️ Sheet ${sheetName} is empty, skipping`);
          continue;
        }
        
        // Convert to object format with headers
        const headers = jsonData[0];
        const rows = jsonData.slice(1);
        
        const processedData = rows.map(row => {
          const obj = {};
          headers.forEach((header, index) => {
            // Clean header names
            const cleanHeader = String(header || `column_${index}`)
              .trim()
              .toLowerCase()
              .replace(/\s+/g, '_')
              .replace(/[^\w_]/g, '');
            
            obj[cleanHeader] = row[index] || null;
          });
          return obj;
        });
        
        allSheets[sheetName] = processedData;
        totalRows += processedData.length;
        
        console.log(`✅ Processed sheet ${sheetName}: ${processedData.length} rows, ${headers.length} columns`);
      }
      
      console.log(`📊 Successfully processed ${Object.keys(allSheets).length} sheets with ${totalRows} total rows`);
      
      return allSheets;
      
    } catch (error) {
      console.error(`❌ Error parsing Excel file ${filePath}:`, error);
      throw new Error(`Failed to parse Excel file ${filePath}: ${error.message}`);
    }
  }
  
  // Helper method to convert Excel data to CSV-like format
  convertToCSVFormat(excelData, sheetName = null) {
    if (sheetName && excelData[sheetName]) {
      return excelData[sheetName];
    }
    
    // If no sheet specified, return the first sheet or combine all sheets
    const sheetNames = Object.keys(excelData);
    if (sheetNames.length === 1) {
      return excelData[sheetNames[0]];
    }
    
    // If multiple sheets, return them as separate entities
    return excelData;
  }
}