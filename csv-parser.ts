/// <reference types="node" />
import * as Papa from 'papaparse';
import { promises as fs } from 'fs';

declare const console: any;

export class CSVParser {
  async parseCSV(filePath: string): Promise<any[]> {
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      
      const result = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        transformHeader: (header: string) => {
          return header.trim().toLowerCase().replace(/\s+/g, '_');
        },
        transform: (value: string, header: string) => {
          if (typeof value === 'string') {
            value = value.trim();
            
            if (value === '') return null;
            
            if (/^[\d,]+\.?\d*$/.test(value)) {
              const numValue = parseFloat(value.replace(/,/g, ''));
              if (!isNaN(numValue)) return numValue;
            }
            
            if (/^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
              const date = new Date(value);
              if (!isNaN(date.getTime())) return date;
            }
          }
          
          return value;
        }
      });

      if (result.errors.length > 0) {
        console.error('CSV parsing errors:', result.errors);
      }

      return result.data as any[];
    } catch (error) {
      throw new Error(`Failed to parse CSV file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}