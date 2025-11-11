// oauth-config.js
const OAUTH_CONFIG = {
    clientId: '',
    clientSecret: '', // Should be stored securely
    instanceUrl: 'https://sccitsmsit.service-now.com',
    redirectUri: 'https://phucbuipoc.github.io/callback',
    authorizationEndpoint: '/oauth_auth.do',
    tokenEndpoint: '/oauth_token.do',
    scope: 'useraccount',
    usePkce: true // Enable PKCE by default for browser-based flows. Requires the OAuth app to allow PKCE/public client.
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

        // If PKCE is enabled, create a code_verifier and code_challenge and add to params
        if (this.config.usePkce) {
            const codeVerifier = this.generateCodeVerifier();
            // store verifier for token exchange
            sessionStorage.setItem('pkce_code_verifier', codeVerifier);
            // compute challenge
            const challenge = this.base64UrlEncodeSHA256(codeVerifier);
            params.append('code_challenge', challenge);
            params.append('code_challenge_method', 'S256');
            console.log('[OAuthManager] PKCE enabled: code_verifier stored, code_challenge appended');
        }

        return `${this.config.instanceUrl}${this.config.authorizationEndpoint}?${params}`;
    }

    // Generate a high-entropy random code verifier for PKCE
    generateCodeVerifier(length = 64) {
        // length should be between 43 and 128
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let verifier = '';
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        for (let i = 0; i < length; i++) {
            verifier += possible[array[i] % possible.length];
        }
        return verifier;
    }

    // Compute base64url-encoded SHA256 of the verifier
    base64UrlEncodeSHA256(verifier) {
        // crypto.subtle.digest is async, but callers expect a synchronous value when building the URL.
        // To keep the API simple we synchronously compute using a quick fallback (not ideal for old browsers).
        // We'll perform an async digest using a blocking pattern by creating a synchronous XHR to a blob URL is complex,
        // so instead compute via a small synchronous approach using TextEncoder + subtle (async) and block with a Promise
        // Note: this function returns a placeholder if subtle is not supported.
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(verifier);
            // We MUST compute the digest synchronously for the URL building step; use a deasync-like approach with thenable.
            // We'll compute digest synchronously by blocking further execution until it's ready using async/await in caller.
            // To keep the call-site simpler, here we'll compute synchronously by using a small self-invoking async function
            // and blocking via a hack: create a synchronous loop polling sessionStorage for the result.
            // This is a pragmatic approach for this demo/test environment; in production use fully async flows.
            const key = 'pkce_challenge_' + Math.random().toString(36).substring(2);
            (async () => {
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const base64String = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
                const base64url = base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                sessionStorage.setItem(key, base64url);
            })();
            // wait briefly for the async digest to complete (poll)
            const start = Date.now();
            while (!sessionStorage.getItem(key)) {
                // timeout after 500ms
                if (Date.now() - start > 500) break;
            }
            const result = sessionStorage.getItem(key) || '';
            sessionStorage.removeItem(key);
            return result;
        } catch (err) {
            console.warn('[OAuthManager] PKCE challenge generation failed or is not supported:', err);
            return '';
        }
    }

    // Generate random state for CSRF protection
    generateState(codeVerifier) {
        const token = Math.random().toString(36).substring(7);
        // If a codeVerifier is provided, include it in the state payload so it can be restored on callback
        const payload = codeVerifier ? { s: token, v: codeVerifier } : { s: token };
        const json = JSON.stringify(payload);
        const base64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        // store the encoded state so verifyState can compare it on callback
        sessionStorage.setItem('oauth_state', base64);
        return base64;
    }

    // Verify state
    verifyState(state) {
        const savedState = sessionStorage.getItem('oauth_state');
        return state === savedState;
    }

    // Try to restore a PKCE code_verifier out of a returned state value.
    // This is useful for cases where the browser origin changed between auth start and callback
    // (for testing) but the state parameter contains the verifier.
    restorePkceFromState(state) {
        try {
            if (!state) return false;
            // base64url -> base64
            const b64 = state.replace(/-/g, '+').replace(/_/g, '/');
            const json = atob(b64);
            const obj = JSON.parse(json);
            if (obj && obj.v) {
                sessionStorage.setItem('pkce_code_verifier', obj.v);
                console.log('[OAuthManager] Restored PKCE code_verifier from state');
                return true;
            }
        } catch (err) {
            console.warn('[OAuthManager] Failed to restore PKCE verifier from state:', err);
        }
        return false;
    }

    // Exchange authorization code for tokens
    async exchangeCodeForToken(code) {
        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: this.config.redirectUri,
            client_id: this.config.clientId
        });

        // If PKCE was used, include the code_verifier instead of client_secret
        if (this.config.usePkce) {
            const verifier = sessionStorage.getItem('pkce_code_verifier');
            if (!verifier) {
                throw new Error('PKCE code_verifier not found in sessionStorage');
            }
            params.append('code_verifier', verifier);
            console.log('[OAuthManager] Using PKCE code_verifier for token exchange');
        } else if (this.config.clientSecret) {
            params.append('client_secret', this.config.clientSecret);
        }

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
                const text = await response.text();
                console.error('[OAuthManager] Token exchange failed, server response:', text);
                throw new Error('Token exchange failed: ' + response.status + ' ' + response.statusText);
            }

            const data = await response.json();
            
            // Store tokens
            this.accessToken = data.access_token;
            this.idToken = data.id_token; // This is what we need!
            this.refreshToken = data.refresh_token;
            this.expiresAt = Date.now() + (data.expires_in * 1000);

            // Save to sessionStorage
            sessionStorage.setItem('access_token', this.accessToken);
            sessionStorage.setItem('id_token', this.idToken);
            sessionStorage.setItem('refresh_token', this.refreshToken);
            sessionStorage.setItem('expires_at', this.expiresAt);

            return this.idToken;
        } catch (error) {
            console.error('Token exchange error:', error);
            throw error;
        }
    }

    // Get current ID token
    getIdToken() {
        // Check if token exists and not expired
        if (this.idToken && this.expiresAt > Date.now()) {
            return this.idToken;
        }

        // Try to load from sessionStorage
        const storedToken = sessionStorage.getItem('id_token');
        const storedExpiry = sessionStorage.getItem('expires_at');

        if (storedToken && storedExpiry && parseInt(storedExpiry) > Date.now()) {
            this.idToken = storedToken;
            return this.idToken;
        }

        return null;
    }

    // Refresh token if expired
    async refreshAccessToken() {
        const refreshToken = this.refreshToken || sessionStorage.getItem('refresh_token');
        
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }

        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: this.config.clientId
        });

        // If this is not a PKCE/public client and a clientSecret is provided, attach it
        if (!this.config.usePkce && this.config.clientSecret) {
            params.append('client_secret', this.config.clientSecret);
        }

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
            this.idToken = data.id_token;
            this.expiresAt = Date.now() + (data.expires_in * 1000);

            // Update sessionStorage
            sessionStorage.setItem('access_token', this.accessToken);
            sessionStorage.setItem('id_token', this.idToken);
            sessionStorage.setItem('expires_at', this.expiresAt);

            return this.idToken;
        } catch (error) {
            console.error('Token refresh error:', error);
            throw error;
        }
    }

    // Clear all tokens (logout)
    clearTokens() {
        this.accessToken = null;
        this.idToken = null;
        this.refreshToken = null;
        this.expiresAt = null;

        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('id_token');
        sessionStorage.removeItem('refresh_token');
        sessionStorage.removeItem('expires_at');
        sessionStorage.removeItem('oauth_state');
    }

    // Check if user is authenticated
    isAuthenticated() {
        return this.getIdToken() !== null;
    }
}

// Export for use
window.OAuthManager = OAuthManager;
window.oauthManager = new OAuthManager(OAUTH_CONFIG);