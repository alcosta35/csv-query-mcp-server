/// <reference path="./globals.d.ts" />
const yauzl = require('yauzl');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const path = require('path');

export class ZipHandler {
  async extractZip(zipPath: string, extractPath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const extractedFiles: any[] = [];
      
      yauzl.open(zipPath, { lazyEntries: true }, async (err: any, zipfile: any) => {
        if (err) {
          reject(new Error(`Failed to open zip file: ${err.message}`));
          return;
        }

        if (!zipfile) {
          reject(new Error('Zip file is null'));
          return;
        }

        try {
          await fs.mkdir(extractPath, { recursive: true });
          zipfile.readEntry();
        } catch (error) {
          reject(error);
          return;
        }

        zipfile.on('entry', (entry: any) => {
          console.log(`📄 Found entry: ${entry.fileName}`);
          
          // Skip directories
          if (entry.fileName.endsWith('/')) {
            console.log(`⏭️ Skipping directory: ${entry.fileName}`);
            zipfile.readEntry();
            return;
          }

          // Skip hidden files and system files
          const fileName = path.basename(entry.fileName);
          if (fileName.startsWith('.') || fileName.startsWith('__MACOSX')) {
            console.log(`⏭️ Skipping system file: ${entry.fileName}`);
            zipfile.readEntry();
            return;
          }

          // Accept multiple file types
          const supportedExtensions = ['.csv', '.xlsx', '.xls', '.tsv', '.txt'];
          const fileExtension = path.extname(entry.fileName).toLowerCase();
          
          if (!supportedExtensions.includes(fileExtension)) {
            console.log(`⏭️ Skipping unsupported file: ${entry.fileName} (${fileExtension})`);
            zipfile.readEntry();
            return;
          }

          console.log(`✅ Processing: ${entry.fileName}`);

          const safeFileName = path.basename(entry.fileName);
          const outputPath = path.join(extractPath, safeFileName);

          zipfile.openReadStream(entry, (err: any, readStream: any) => {
            if (err) {
              reject(new Error(`Failed to open read stream for ${entry.fileName}: ${err.message}`));
              return;
            }

            if (!readStream) {
              reject(new Error('Read stream is null'));
              return;
            }

            const writeStream = createWriteStream(outputPath);
            
            readStream.on('end', () => {
              writeStream.end();
            });

            writeStream.on('finish', () => {
              console.log(`✅ Extracted: ${safeFileName}`);
              extractedFiles.push({
                path: outputPath,
                name: safeFileName,
                type: fileExtension,
                originalName: entry.fileName
              });
              zipfile.readEntry();
            });

            readStream.on('error', (error: any) => {
              writeStream.destroy();
              reject(new Error(`Read stream error for ${entry.fileName}: ${error.message}`));
            });

            writeStream.on('error', (error: any) => {
              readStream.destroy();
              reject(new Error(`Write stream error for ${outputPath}: ${error.message}`));
            });

            readStream.pipe(writeStream);
          });
        });

        zipfile.on('end', () => {
          console.log(`📁 ZIP extraction complete. Found ${extractedFiles.length} files.`);
          resolve(extractedFiles);
        });

        zipfile.on('error', (error: any) => {
          reject(new Error(`Zip file error: ${error.message}`));
        });
      });
    });
  }
}