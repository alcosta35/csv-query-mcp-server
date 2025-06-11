// google-drive-oauth-handler.ts
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';

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

    // Set credentials if refresh token is available
    if (process.env.GOOGLE_REFRESH_TOKEN) {
      this.oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      });
      
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    }
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.readonly'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent' // Force refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   */
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

  /**
   * Set tokens manually (for persistent storage)
   */
  setTokens(tokens: any): void {
    this.oauth2Client.setCredentials(tokens);
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.drive !== null;
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<void> {
    try {
      await this.oauth2Client.refreshAccessToken();
    } catch (error) {
      throw new Error(`Failed to refresh access token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Upload a file to Google Drive
   */
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

  /**
   * Download a file from Google Drive
   */
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
          .on('error', (err) => {
            reject(new Error(`Download stream error: ${err.message}`));
          })
          .pipe(dest)
          .on('error', (err) => {
            reject(new Error(`Write stream error: ${err.message}`));
          });
      });
    } catch (error) {
      throw new Error(`Failed to download file from Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List files in the configured Google Drive folder
   */
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

  /**
   * Get file metadata
   */
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

  /**
   * Delete a file from Google Drive
   */
  async deleteFile(fileId: string): Promise<void> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      await this.drive.files.delete({
        fileId: fileId,
      });

      console.log(`File deleted successfully. File ID: ${fileId}`);
    } catch (error) {
      throw new Error(`Failed to delete file from Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a folder in Google Drive
   */
  async createFolder(folderName: string, parentFolderId?: string): Promise<string> {
    if (!this.drive) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    try {
      const fileMetadata: drive_v3.Schema$File = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentFolderId ? [parentFolderId] : this.folderId ? [this.folderId] : undefined,
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        fields: 'id',
      });

      if (!response.data.id) {
        throw new Error('Failed to get folder ID from creation response');
      }

      console.log(`Folder created successfully. Folder ID: ${response.data.id}`);
      return response.data.id;
    } catch (error) {
      throw new Error(`Failed to create folder in Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Search for files by name
   */
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