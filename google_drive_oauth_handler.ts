// Enhanced OAuth handler with better token management
async getTokens(code) {
  try {
    console.log('🔐 Exchanging authorization code for tokens...');
    
    const { tokens } = await this.oauth2Client.getToken(code);
    console.log('✅ Tokens received successfully');
    
    // Set credentials
    this.oauth2Client.setCredentials(tokens);
    
    // Initialize drive service
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    
    // Verify the tokens work by making a test call
    try {
      await this.drive.about.get({ fields: 'user' });
      console.log('✅ Token validation successful');
    } catch (testError) {
      console.warn('⚠️ Token validation failed:', testError.message);
    }
    
    return tokens;
  } catch (error) {
    console.error('❌ Token exchange error:', error);
    
    let errorMessage = `Failed to exchange code for tokens: ${error.message}`;
    
    if (error.message.includes('invalid_grant')) {
      errorMessage += '\n\nThis usually means:\n';
      errorMessage += '1. The authorization code has expired (use within 10 minutes)\n';
      errorMessage += '2. The code has already been used\n';
      errorMessage += '3. The redirect URI doesn\'t match\n\n';
      errorMessage += 'Please try the authorization process again.';
    }
    
    throw new Error(errorMessage);
  }
}

// Enhanced authentication check
isAuthenticated() {
  if (!this.oauth2Client) {
    console.log('❌ OAuth client not initialized');
    return false;
  }
  
  const credentials = this.oauth2Client.credentials;
  if (!credentials) {
    console.log('❌ No credentials found');
    return false;
  }
  
  if (!credentials.refresh_token && !credentials.access_token) {
    console.log('❌ No tokens found');
    return false;
  }
  
  // Check if we have a drive instance
  if (!this.drive) {
    console.log('🔄 Reinitializing drive service...');
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }
  
  console.log('✅ Authentication check passed');
  return true;
}

// Auto-refresh tokens when needed
async ensureValidTokens() {
  try {
    if (!this.oauth2Client.credentials.access_token) {
      console.log('🔄 No access token, attempting refresh...');
      await this.oauth2Client.getAccessToken();
    }
    
    // Check if token is about to expire (refresh if less than 5 minutes left)
    const expiryDate = this.oauth2Client.credentials.expiry_date;
    if (expiryDate && expiryDate < Date.now() + 5 * 60 * 1000) {
      console.log('🔄 Token expiring soon, refreshing...');
      await this.oauth2Client.getAccessToken();
    }
    
    return true;
  } catch (error) {
    console.error('❌ Token refresh failed:', error);
    return false;
  }
}