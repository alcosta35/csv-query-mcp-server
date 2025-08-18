/// <reference path="./globals.d.ts" />
const Papa = require('papaparse');
const fs = require('fs').promises;

export class CSVParser {
  async parseCSV(filePath: string) {
    try {
      console.log(`📄 Reading CSV file: ${filePath}`);
      
      // Check if file exists and get stats
      const stats = await fs.stat(filePath);
      console.log(`📄 CSV file size: ${stats.size} bytes`);
      
      if (stats.size === 0) {
        throw new Error(`CSV file is empty: ${filePath}`);
      }
      
      const fileContent = await fs.readFile(filePath, 'utf-8');
      console.log(`📄 File content length: ${fileContent.length} characters`);
      
      if (!fileContent.trim()) {
        throw new Error(`CSV file contains no data: ${filePath}`);
      }
      
      const result = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        delimitersToGuess: [',', '\t', '|', ';'],
        // More permissive parsing
        transformHeader: (header: string) => {
          return header.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
        },
        transform: (value: any, header: string) => {
          if (typeof value === 'string') {
            value = value.trim();
            
            if (value === '' || value === 'null' || value === 'NULL') return null;
            
            // Try to parse numbers with better detection
            if (/^-?\d+\.?\d*$/.test(value.replace(/,/g, ''))) {
              const numValue = parseFloat(value.replace(/,/g, ''));
              if (!isNaN(numValue)) return numValue;
            }
            
            // Try to parse dates
            if (/^\d{4}-\d{2}-\d{2}/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) {
              const date = new Date(value);
              if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
            }
          }
          
          return value;
        }
      });

      // More lenient error handling
      if (result.errors && result.errors.length > 0) {
        console.warn(`📄 CSV parsing warnings for ${filePath}:`, result.errors.slice(0, 5)); // Only show first 5 errors
        
        // Only fail on critical errors
        const criticalErrors = result.errors.filter(error => 
          error.type === 'Delimiter' && error.code === 'UndetectableDelimiter'
        );
        
        if (criticalErrors.length > 0) {
          // Try with different settings
          console.log(`📄 Retrying with simpler parsing for ${filePath}`);
          const simpleResult = Papa.parse(fileContent, {
            header: true,
            skipEmptyLines: true,
            delimiter: ',', // Force comma delimiter
            transformHeader: (header: string) => {
              return header.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
            }
          });
          
          if (simpleResult.data && simpleResult.data.length > 0) {
            console.log(`📄 Successfully parsed ${simpleResult.data.length} rows with simple parsing`);
            return simpleResult.data;
          }
          
          throw new Error(`CSV parsing failed: ${criticalErrors[0].message}`);
        }
      }

      if (!result.data || result.data.length === 0) {
        throw new Error(`No data rows found in CSV file: ${filePath}`);
      }

      console.log(`📄 Successfully parsed ${result.data.length} rows from ${filePath}`);
      return result.data;
      
    } catch (error: any) {
      console.error(`📄 Error parsing CSV file ${filePath}:`, error.message);
      throw new Error(`Failed to parse CSV file ${filePath}: ${error.message}`);
    }
  }
}