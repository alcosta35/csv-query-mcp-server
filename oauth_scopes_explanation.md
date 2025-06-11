# Google Drive OAuth Scopes Detailed Explanation

## What is `../auth/drive.file`?

The `../auth/drive.file` is shorthand for:
```
https://www.googleapis.com/auth/drive.file
```

## Scope Breakdown

### `https://www.googleapis.com/auth/drive.file`
**What it allows:**
- ✅ View and manage Google Drive files **that the app has opened or created**
- ✅ Upload new files to Google Drive
- ✅ Download files that the app uploaded
- ✅ Modify files that the app created or was given access to
- ❌ **Cannot** see ALL files in user's Drive
- ❌ **Cannot** access files created by other apps

**Security Level:** 🟡 **Moderate** - Restricted access

### Other Common Drive Scopes (for comparison)

#### `https://www.googleapis.com/auth/drive` (Full Access)
**What it allows:**
- ✅ See, edit, download, and delete ALL files in Google Drive
- ✅ See info about Google Drive files
- ⚠️ **Very broad permissions** - access to everything

**Security Level:** 🔴 **High Risk** - Full access

#### `https://www.googleapis.com/auth/drive.readonly`
**What it allows:**
- ✅ View and download Google Drive files **that the app has been given access to**
- ❌ Cannot upload, modify, or delete files
- ❌ Cannot see ALL files in user's Drive

**Security Level:** 🟢 **Low Risk** - Read-only access

#### `https://www.googleapis.com/auth/drive.metadata.readonly`
**What it allows:**
- ✅ View metadata (name, size, date) of Drive files
- ❌ Cannot download actual file content
- ❌ Cannot modify anything

**Security Level:** 🟢 **Very Low Risk** - Metadata only

## For Your MCP Server

### Recommended Scopes
```javascript
const scopes = [
  'https://www.googleapis.com/auth/drive.file',     // Upload/manage files the app creates
  'https://www.googleapis.com/auth/drive.readonly'  // Read files user explicitly shares
];
```

### Why This Combination?

1. **`drive.file`** allows your MCP server to:
   - Upload ZIP files containing CSVs
   - Download files it previously uploaded
   - Manage files in a specific folder (if user shares it)

2. **`drive.readonly`** allows your MCP server to:
   - Read files that users explicitly share with the app
   - List files in folders the user grants access to

## What Users See During OAuth

When users click your OAuth link, Google shows them something like:

```
[Your App Name] wants to:
✓ See, edit, create, and delete only the specific Google Drive files you use with this app
✓ See and download your Google Drive files
```

## Setting Scopes in Code

### In your OAuth handler:
```typescript
getAuthUrl(): string {
  const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly'
  ];

  return this.oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,  // Full URLs
    prompt: 'consent'
  });
}
```

### In Google Cloud Console:
When configuring the OAuth consent screen, add:
- `../auth/drive.file` (shorthand)
- `../auth/drive.readonly` (shorthand)

Google automatically expands these to full URLs.

## Best Practices

### ✅ Do:
- Use the **minimum scopes** needed for your app
- Explain to users what your app will do with their files
- Use `drive.file` instead of full `drive` access when possible

### ❌ Don't:
- Request `drive` (full access) unless absolutely necessary
- Request scopes you don't actually use
- Store or process files outside your app's scope

## For Training Courses

The `drive.file` scope is perfect because:
- Students can upload their CSV data files
- The app can only access files students explicitly upload
- Students' other Drive files remain private
- Instructors can share datasets with the app

## Testing Scope Permissions

You can test what your app can access:

```typescript
// This will only list files the app has access to
const files = await drive.files.list({
  q: 'trashed=false',
  fields: 'files(id, name, size, mimeType)'
});

// If using drive.file scope, this might return:
// - Files uploaded through your app
// - Files in folders explicitly shared with your app
// - NO random user files
```

## Scope Changes

If you need to change scopes later:
1. Update your code
2. Update OAuth consent screen in Google Cloud Console
3. Users will need to re-authorize (they'll see new permissions)
4. Previous tokens with old scopes will still work until they expire

This approach ensures your MCP server has appropriate access while respecting user privacy!