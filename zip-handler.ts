/// <reference path="./globals.d.ts" />
const yauzl = require('yauzl');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const path = require('path');

export class ZipHandler {
  async extractZip(zipPath, extractPath) {
    return new Promise((resolve, reject) => {
      const extractedFiles = [];
      
      yauzl.open(zipPath, { lazyEntries: true }, async (err, zipfile) => {
        if (err) {
          reject(new Error(`Failed to open zip file: ${err.message}`));
          return;
        }

        if (!zipfile) {
          reject(new Error('Zip file is null'));
          return;
        }

        try {
          // Ensure extract directory exists
          await fs.mkdir(extractPath, { recursive: true });
          zipfile.readEntry();
        } catch (error) {
          reject(error);
          return;
        }

        zipfile.on('entry', (entry) => {
          // Skip directories
          if (entry.fileName.endsWith('/')) {
            zipfile.readEntry();
            return;
          }

          // Only process CSV files
          if (!entry.fileName.toLowerCase().endsWith('.csv')) {
            zipfile.readEntry();
            return;
          }

          // Get just the filename without path to avoid directory traversal
          const safeFileName = path.basename(entry.fileName);
          const outputPath = path.join(extractPath, safeFileName);

          zipfile.openReadStream(entry, (err, readStream) => {
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
              extractedFiles.push(outputPath);
              zipfile.readEntry();
            });

            readStream.on('error', (error) => {
              writeStream.destroy();
              reject(new Error(`Read stream error for ${entry.fileName}: ${error.message}`));
            });

            writeStream.on('error', (error) => {
              readStream.destroy();
              reject(new Error(`Write stream error for ${outputPath}: ${error.message}`));
            });

            readStream.pipe(writeStream);
          });
        });

        zipfile.on('end', () => {
          resolve(extractedFiles);
        });

        zipfile.on('error', (error) => {
          reject(new Error(`Zip file error: ${error.message}`));
        });
      });
    });
  }
}