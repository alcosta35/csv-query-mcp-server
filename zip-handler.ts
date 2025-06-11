cat > zip-handler.ts << 'EOF'
const yauzl = require('yauzl');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const path = require('path');

export class ZipHandler {
  async extractZip(zipPath, extractPath) {
    return new Promise((resolve, reject) => {
      const extractedFiles = [];
      
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(new Error(`Failed to open zip file: ${err.message}`));
          return;
        }

        if (!zipfile) {
          reject(new Error('Zip file is null'));
          return;
        }

        fs.mkdir(extractPath, { recursive: true }).then(() => {
          zipfile.readEntry();
        }).catch(reject);

        zipfile.on('entry', (entry) => {
          if (entry.fileName.endsWith('/')) {
            zipfile.readEntry();
            return;
          }

          if (!entry.fileName.toLowerCase().endsWith('.csv')) {
            zipfile.readEntry();
            return;
          }

          const outputPath = path.join(extractPath, path.basename(entry.fileName));

          zipfile.openReadStream(entry, (err, readStream) => {
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
}
EOF