/// <reference path="./globals.d.ts" />
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs').promises;
const { createReadStream, createWriteStream } = require('fs');
const path = require('path');

export class GoogleDriveOAuthHandler {
  oauth2Client: any;
  drive: any;
  folderId: string;

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

  getAuthUrl(): string {
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

  async getTokens(code: string) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      
      return tokens;
    } catch (error: any) {
      throw new Error(`Failed to exchange code for tokens: ${error.message}`);
    }
  }

  isAuthenticated(): boolean {
    return this.drive !== null && this.drive !== undefined;
  }

  async uploadFile(filePath: string, fileName: string): Promise<string> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      console.log(`📤 Uploading file to Google Drive: ${fileName}`);
      
      // Check if file exists locally
      const stats = await fs.stat(filePath);
      console.log(`📄 Local file size: ${stats.size} bytes`);

      const fileMetadata = {
        name: fileName,
        parents: this.folderId ? [this.folderId] : undefined,
      };

      // Determine MIME type based on file extension
      const mimeType = this.getMimeType(fileName);
      console.log(`📄 MIME type: ${mimeType}`);

      const media = {
        mimeType: mimeType,
        body: createReadStream(filePath),
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id,name,size,webViewLink',
      });

      if (!response.data.id) {
        throw new Error('Failed to get file ID from upload response');
      }

      console.log(`✅ File uploaded successfully!`);
      console.log(`📄 File ID: ${response.data.id}`);
      console.log(`📄 File Name: ${response.data.name}`);
      console.log(`📄 File Size: ${response.data.size} bytes`);
      console.log(`🔗 View Link: ${response.data.webViewLink}`);

      return response.data.id;
    } catch (error: any) {
      console.error(`❌ Upload failed:`, error);
      throw new Error(`Failed to upload file to Google Drive: ${error.message}`);
    }
  }

  async downloadFile(fileId: string, destinationPath: string): Promise<string> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      console.log(`📥 Downloading file from Google Drive: ${fileId}`);
      
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
            console.log(`✅ File downloaded successfully to: ${destinationPath}`);
            resolve(destinationPath);
          })
          .on('error', (err: any) => {
            reject(new Error(`Download stream error: ${err.message}`));
          })
          .pipe(dest)
          .on('error', (err: any) => {
            reject(new Error(`Write stream error: ${err.message}`));
          });
      });
    } catch (error: any) {
      throw new Error(`Failed to download file from Google Drive: ${error.message}`);
    }
  }

  async listFiles(): Promise<any[]> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      const query = this.folderId 
        ? `'${this.folderId}' in parents and trashed=false`
        : 'trashed=false';

      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name, size, mimeType, modifiedTime, createdTime, webViewLink)',
        orderBy: 'modifiedTime desc',
        pageSize: 100,
      });

      return response.data.files || [];
    } catch (error: any) {
      throw new Error(`Failed to list files from Google Drive: ${error.message}`);
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      console.log(`🗑️ Deleting file from Google Drive: ${fileId}`);
      
      await this.drive.files.delete({
        fileId: fileId
      });

      console.log(`✅ File deleted successfully`);
    } catch (error: any) {
      throw new Error(`Failed to delete file from Google Drive: ${error.message}`);
    }
  }

  async getFileInfo(fileId: string): Promise<any> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      const response = await this.drive.files.get({
        fileId: fileId,
        fields: 'id, name, size, mimeType, modifiedTime, createdTime, webViewLink, parents'
      });

      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get file info from Google Drive: ${error.message}`);
    }
  }

  private getMimeType(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    
    const mimeTypes: { [key: string]: string } = {
      '.csv': 'text/csv',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip'
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }
}