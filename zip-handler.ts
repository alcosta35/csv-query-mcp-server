cat > zip-handler.ts << 'EOF'
import * as yauzl from 'yauzl';
import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import * as path from 'path';

export class ZipHandler {
  async extractZip(zipPath: string, extractPath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const extractedFiles: string[] = [];
      
      yauzl.open(zipPath, { lazyEntries: true }, (err: any, zipfile: any) => {
        if (err) {
          reject(new Error(`Failed to open zip file: ${err.message}`));
          return;
        }

        if (!zipfile) {
          reject(new Error('Zip file is null'));
          return;
        }

        // Ensure extract directory exists
        fs.mkdir(extractPath, { recursive: true }).then(() => {
          zipfile.readEntry();
        }).catch(reject);

        zipfile.on('entry', (entry: any) => {
          // Skip directories
          if (entry.fileName.endsWith('/')) {
            zipfile.readEntry();
            return;
          }

          // Only extract CSV files
          if (!entry.fileName.toLowerCase().endsWith('.csv')) {
            zipfile.readEntry();
            return;
          }

          const outputPath = path.join(extractPath, path.basename(entry.fileName));

          zipfile.openReadStream(entry, (err: any, readStream: any) => {
            if (err) {
              reject(err);
              return;
            }

            if (!readStream) {
              reject(new Error('Read stream is null'));
              return;
            }

            const writeStream = createWriteStream(outputPath);
            
            readStream.on('end', () => {
              extractedFiles.push(outputPath);
              zipfile.readEntry();
            });

            readStream.on('error', reject);
            writeStream.on('error', reject);

            readStream.pipe(writeStream);
          });
        });

        zipfile.on('end', () => {
          resolve(extractedFiles);
        });

        zipfile.on('error', reject);
      });
    });
  }

  async listZipContents(zipPath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const files: string[] = [];
      
      yauzl.open(zipPath, { lazyEntries: true }, (err: any, zipfile: any) => {
        if (err) {
          reject(new Error(`Failed to open zip file: ${err.message}`));
          return;
        }

        if (!zipfile) {
          reject(new Error('Zip file is null'));
          return;
        }

        zipfile.readEntry();

        zipfile.on('entry', (entry: any) => {
          if (!entry.fileName.endsWith('/')) {
            files.push(entry.fileName);
          }
          zipfile.readEntry();
        });

        zipfile.on('end', () => {
          resolve(files);
        });

        zipfile.on('error', reject);
      });
    });
  }
}
EOF