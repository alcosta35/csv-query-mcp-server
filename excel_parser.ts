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
        dateNF: 'yyyy-mm-dd'
      });
      
      console.log(`📋 Found ${workbook.SheetNames.length} sheets: ${workbook.SheetNames.join(', ')}`);
      
      const allSheets: any = {};
      let totalRows = 0;
      
      for (const sheetName of workbook.SheetNames) {
        console.log(`📄 Processing sheet: ${sheetName}`);
        
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: null,
          blankrows: false
        });
        
        if (jsonData.length === 0) {
          console.log(`⚠️ Sheet ${sheetName} is empty, skipping`);
          continue;
        }
        
        const headers = jsonData[0] as any[];
        const rows = jsonData.slice(1);
        
        const processedData = rows.map(row => {
          const obj: any = {};
          headers.forEach((header, index) => {
            const cleanHeader = String(header || `column_${index}`)
              .trim()
              .toLowerCase()
              .replace(/\s+/g, '_')
              .replace(/[^\w_]/g, '');
            
            obj[cleanHeader] = (row as any[])[index] || null;
          });
          return obj;
        });
        
        allSheets[sheetName] = processedData;
        totalRows += processedData.length;
        
        console.log(`✅ Processed sheet ${sheetName}: ${processedData.length} rows, ${headers.length} columns`);
      }
      
      console.log(`📊 Successfully processed ${Object.keys(allSheets).length} sheets with ${totalRows} total rows`);
      
      return allSheets;
      
    } catch (error: any) {
      console.error(`❌ Error parsing Excel file ${filePath}:`, error);
      throw new Error(`Failed to parse Excel file ${filePath}: ${error.message}`);
    }
  }
}