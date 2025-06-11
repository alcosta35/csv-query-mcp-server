// google-drive-handler.ts
import { google, drive_v3 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';

export class GoogleDriveHandler {
  private drive: drive_v3.Drive;
  private folderId: string;

  constructor() {
    // Initialize Google Auth
    const auth = new GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    this.drive = google.drive({ version: 'v3', auth });
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

    if (!this.folderId) {
      console.warn('GOOGLE_DRIVE_FOLDER_ID not set. Files will be uploaded to root folder.');
    }
  }

  /**
   * Upload a file to Google Drive
   */
  async uploadFile(filePath: string, fileName: string): Promise<string> {
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
    try {
      const response = await this.drive.files.get({
        fileId: fileId,
        alt: 'media',
      }, { responseType: 'stream' });

      // Ensure destination directory exists
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
    try {
      const baseQuery = `name contains '${fileName