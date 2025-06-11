cat > google_drive_oauth_handler.ts << 'EOF'
/// <reference types="node" />
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { promises as fs } from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import * as path from 'path';

declare const process: any;
declare const console: any;

export class GoogleDriveOAuthHandler {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive | null = null;
  private folderId: string;

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

  async getTokens(code: string): Promise<any> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      
      return tokens;
    } catch (error) {
      throw new Error(`Failed to exchange code for tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  isAuthenticated(): boolean {
    return this.drive !== null;
  }

  async uploadFile(filePath: string, fileName: string): Promise<string> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      const fileMetadata: drive_v3.Schema$File = {
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
      throw new Error(`Failed to upload file to Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async downloadFile(fileId: string, destinationPath: string): Promise<string> {
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
          .on('error', (err: any) => {
            reject(new Error(`Download stream error: ${err.message}`));
          })
          .pipe(dest)
          .on('error', (err: any) => {
            reject(new Error(`Write stream error: ${err.message}`));
          });
      });
    } catch (error) {
      throw new Error(`Failed to download file from Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listFiles(): Promise<drive_v3.Schema$File[]> {
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
      throw new Error(`Failed to list files from Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFileMetadata(fileId: string): Promise<drive_v3.Schema$File> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      const response = await this.drive.files.get({
        fileId: fileId,
        fields: 'id, name, size, mimeType, modifiedTime, createdTime, parents',
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to get file metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async searchFiles(fileName: string): Promise<drive_v3.Schema$File[]> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      const baseQuery = `name contains '${fileName}' and trashed=false`;
      const query = this.folderId 
        ? `${baseQuery} and '${this.folderId}' in parents`
        : baseQuery;

      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name, size, mimeType, modifiedTime, createdTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 50,
      });

      return response.data.files || [];
    } catch (error) {
      throw new Error(`Failed to search files in Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
EOF