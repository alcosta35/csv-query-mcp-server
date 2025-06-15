/// <reference path="./globals.d.ts" />
const Papa = require('papaparse');
const fs = require('fs').promises;

export class CSVParser {
  async parseCSV(filePath) {
    try {
      console.log(`Reading CSV file: ${filePath}`);
      
      // Check if file exists and get stats
      const stats = await fs.stat(filePath);
      console.log(`CSV file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error(`CSV file is empty: ${filePath}`);
      }
      
      const fileContent = await fs.readFile(filePath, 'utf-8');
      console.log(`File content length: ${fileContent.length} characters`);
      
      if (!fileContent.trim()) {
        throw new Error(`CSV file contains no data: ${filePath}`);
      }
      
      const result = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        delimitersToGuess: [',', '\t', '|', ';'],
        transformHeader: (header) => {
          return header.trim().toLowerCase().replace(/\s+/g, '_');
        },
        transform: (value, header) => {
          if (typeof value === 'string') {
            value = value.trim();
            
            if (value === '') return null;
            
            // Try to parse numbers
            if (/^[\d,]+\.?\d*$/.test(value)) {
              const numValue = parseFloat(value.replace(/,/g, ''));
              if (!isNaN(numValue)) return numValue;
            }
            
            // Try to parse dates
            if (/^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
              const date = new Date(value);
              if (!isNaN(date.getTime())) return date;
            }
          }
          
          return value;
        }
      });

      if (result.errors && result.errors.length > 0) {
        console.warn(`CSV parsing warnings for ${filePath}:`, result.errors);
        
        // Check for fatal errors
        const fatalErrors = result.errors.filter(error => error.type === 'Delimiter');
        if (fatalErrors.length > 0) {
          throw new Error(`CSV parsing failed: ${fatalErrors[0].message}`);
        }
      }

      if (!result.data || result.data.length === 0) {
        throw new Error(`No data rows found in CSV file: ${filePath}`);
      }

      console.log(`Successfully parsed ${result.data.length} rows from ${filePath}`);
      return result.data;
      
    } catch (error) {
      console.error(`Error parsing CSV file ${filePath}:`, error);
      throw new Error(`Failed to parse CSV file ${filePath}: ${error.message}`);
    }
  }
}