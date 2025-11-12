// oauth-config.js
const OAUTH_CONFIG = {
    clientId: '',
    clientSecret: '', // Should be stored securely
    instanceUrl: 'https://sccitsmsit.service-now.com',
    redirectUri: 'https://phucbuipoc.github.io/callback',
    authorizationEndpoint: '/oauth_auth.do',
    tokenEndpoint: '/oauth_token.do',
    scope: 'useraccount'
};

class OAuthManager {
    constructor(config) {
        this.config = config;
        this.accessToken = null;
        this.idToken = null;
        this.refreshToken = null;
        this.expiresAt = null;
    }

    // Generate authorization URL
    getAuthorizationUrl() {
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            scope: this.config.scope,
            state: this.generateState() // CSRF protection
        });

        return `${this.config.instanceUrl}${this.config.authorizationEndpoint}?${params}`;
    }

    // Generate random state for CSRF protection
    generateState() {
        const state = Math.random().toString(36).substring(7);
        sessionStorage.setItem('oauth_state', state);
        return state;
    }

    // Verify state
    verifyState(state) {
        const savedState = sessionStorage.getItem('oauth_state');
        return state === savedState;
    }

    // Exchange authorization code for tokens
    async exchangeCodeForToken(code) {
        // Prefer explicit config, fall back to values persisted in sessionStorage (set by the caller page)
        const clientId = this.config.clientId || sessionStorage.getItem('oauth_client_id') || '';
        const clientSecret = this.config.clientSecret || sessionStorage.getItem('oauth_client_secret') || '';

        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: this.config.redirectUri,
            client_id: clientId,
            client_secret: clientSecret
        });

        console.log('Token exchange params:', params.toString());
        try {
            const response = await fetch(
                `${this.config.instanceUrl}${this.config.tokenEndpoint}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params
                }
            );

            if (!response.ok) {
                throw new Error('Token exchange failed');
            }

            const data = await response.json();
            console.log('Token exchange response:', data);
            // Store tokens
            this.accessToken = data.access_token;
            this.refreshToken = data.refresh_token;
            this.expiresAt = Date.now() + (data.expires_in * 1000);

            // Save to sessionStorage
            sessionStorage.setItem('access_token', this.accessToken);
            sessionStorage.setItem('refresh_token', this.refreshToken);
            sessionStorage.setItem('expires_at', this.expiresAt);

            return this.accessToken;
        } catch (error) {
            console.error('Token exchange error:', error);
            throw error;
        }
    }

    // Get current access token
    getAccessToken() {
        // Check if token exists and not expired
        if (this.accessToken && this.expiresAt > Date.now()) {
            return this.accessToken;
        }

        // Try to load from sessionStorage
        const storedToken = sessionStorage.getItem('access_token');
        const storedExpiry = sessionStorage.getItem('expires_at');

        if (storedToken && storedExpiry && parseInt(storedExpiry) > Date.now()) {
            this.accessToken = storedToken;
            return this.accessToken;
        }

        return null;
    }

    // Refresh token if expired
    async refreshAccessToken() {
        const refreshToken = this.refreshToken || sessionStorage.getItem('refresh_token');
        
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }

        // Use configured client credentials or fall back to stored values
        const clientId = this.config.clientId || sessionStorage.getItem('oauth_client_id') || '';
        const clientSecret = this.config.clientSecret || sessionStorage.getItem('oauth_client_secret') || '';

        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret
        });

        try {
            const response = await fetch(
                `${this.config.instanceUrl}${this.config.tokenEndpoint}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params
                }
            );

            if (!response.ok) {
                throw new Error('Token refresh failed');
            }

            const data = await response.json();
            
            this.accessToken = data.access_token;
            this.expiresAt = Date.now() + (data.expires_in * 1000);

            // Update sessionStorage
            sessionStorage.setItem('access_token', this.accessToken);
            sessionStorage.setItem('expires_at', this.expiresAt);

            return this.accessToken;
        } catch (error) {
            console.error('Token refresh error:', error);
            throw error;
        }
    }

    // Clear all tokens (logout)
    clearTokens() {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = null;

        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('refresh_token');
        sessionStorage.removeItem('expires_at');
        sessionStorage.removeItem('oauth_state');
        // Remove persisted client credentials used for the test flow
        sessionStorage.removeItem('oauth_client_id');
        sessionStorage.removeItem('oauth_client_secret');
    }

    // Check if user is authenticated
    isAuthenticated() {
        return this.getAccessToken() !== null;
    }
}

// Export for use
// If a caller stored clientId / clientSecret in sessionStorage (test flow), merge those in so the
// manager has the correct values after a redirect back to the callback page.
try {
    const _storedClientId = sessionStorage.getItem('oauth_client_id');
    const _storedClientSecret = sessionStorage.getItem('oauth_client_secret');
    if (_storedClientId) OAUTH_CONFIG.clientId = _storedClientId;
    if (_storedClientSecret) OAUTH_CONFIG.clientSecret = _storedClientSecret;
} catch (e) {
    // sessionStorage might be unavailable in some contexts; fall back silently
    console.warn('Could not read sessionStorage for oauth overrides:', e);
}

window.OAuthManager = OAuthManager;
window.oauthManager = new OAuthManager(OAUTH_CONFIG);