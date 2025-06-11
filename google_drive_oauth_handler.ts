const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs').promises;
const { createReadStream, createWriteStream } = require('fs');
const path = require('path');

export class GoogleDriveOAuthHandler {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback'
    );

    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

    if (process.env.GOOGLE_REFRESH_TOKEN) {
      this.oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      });
      
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    }
  }

  getAuthUrl() {
    const scopes = [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.readonly'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  async getTokens(code) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      
      return tokens;
    } catch (error) {
      throw new Error(`Failed to exchange code for tokens: ${error.message}`);
    }
  }

  isAuthenticated() {
    return this.drive !== null;
  }

  async uploadFile(filePath, fileName) {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      const fileMetadata = {
        name: fileName,
        parents: this.folderId ? [this.folderId] : undefined,
      };

      const media = {
        mimeType: 'application/octet-stream',
        body: createReadStream(filePath),
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id',
      });

      if (!response.data.id) {
        throw new Error('Failed to get file ID from upload response');
      }

      console.log(`File uploaded successfully. File ID: ${response.data.id}`);
      return response.data.id;
    } catch (error) {
      throw new Error(`Failed to upload file to Google Drive: ${error.message}`);
    }
  }

  async downloadFile(fileId, destinationPath) {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      const response = await this.drive.files.get({
        fileId: fileId,
        alt: 'media',
      }, { responseType: 'stream' });

      const dir = path.dirname(destinationPath);
      await fs.mkdir(dir, { recursive: true });

      return new Promise((resolve, reject) => {
        const dest = createWriteStream(destinationPath);
        
        response.data
          .on('end', () => {
            console.log(`File downloaded successfully to: ${destinationPath}`);
            resolve(destinationPath);
          })
          .on('error', (err) => {
            reject(new Error(`Download stream error: ${err.message}`));
          })
          .pipe(dest)
          .on('error', (err) => {
            reject(new Error(`Write stream error: ${err.message}`));
          });
      });
    } catch (error) {
      throw new Error(`Failed to download file from Google Drive: ${error.message}`);
    }
  }

  async listFiles() {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      const query = this.folderId 
        ? `'${this.folderId}' in parents and trashed=false`
        : 'trashed=false';

      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name, size, mimeType, modifiedTime, createdTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 100,
      });

      return response.data.files || [];
    } catch (error) {
      throw new Error(`Failed to list files from Google Drive: ${error.message}`);
    }
  }
}