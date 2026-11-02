/**
 * Authentication Module
 * Handles login, logout, token management, and API requests
 */

const API_BASE_URL = AppConfig.API_BASE_URL;

class AuthManager {
    constructor() {
        // Check both storages — localStorage (remember me) and sessionStorage (session only)
        this.accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
        this.refreshToken = localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token');
        this.username = localStorage.getItem('username') || sessionStorage.getItem('username');
        this._useLocalStorage = !!localStorage.getItem('access_token');
    }

    /**
     * Get the active storage (localStorage or sessionStorage)
     */
    _getStorage() {
        return this._useLocalStorage ? localStorage : sessionStorage;
    }

    /**
     * Login user with credentials
     */
    async login(username, password, rememberMe = true) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password, remember_me: rememberMe }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Login failed');
            }

            const data = await response.json();
            
            // Store tokens in chosen storage
            this._useLocalStorage = rememberMe;
            const storage = this._getStorage();

            this.accessToken = data.access_token;
            this.refreshToken = data.refresh_token;
            this.username = username;
            
            storage.setItem('access_token', this.accessToken);
            storage.setItem('refresh_token', this.refreshToken);
            storage.setItem('username', username);

            return { success: true, username };
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Logout user
     */
    async logout() {
        try {
            if (this.accessToken) {
                await fetch(`${API_BASE_URL}/api/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                    },
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Clear tokens regardless of API call result
            this.clearTokens();
        }
    }

    /**
     * Clear stored tokens
     */
    clearTokens() {
        this.accessToken = null;
        this.refreshToken = null;
        this.username = null;
        
        // Clear both storages
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('username');
        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('refresh_token');
        sessionStorage.removeItem('username');
    }

    /**
     * Verify current token
     */
    async verifyToken() {
        if (!this.accessToken) {
            return false;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/verify`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                this.username = data.username;
                localStorage.setItem('username', data.username);
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Token verification error:', error);
            return false;
        }
    }

    /**
     * Refresh access token
     */
    async refreshAccessToken() {
        if (!this.refreshToken) {
            return false;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ refresh_token: this.refreshToken }),
            });

            if (response.ok) {
                const data = await response.json();
                
                this.accessToken = data.access_token;
                this.refreshToken = data.refresh_token;
                
                const storage = this._getStorage();
                storage.setItem('access_token', this.accessToken);
                storage.setItem('refresh_token', this.refreshToken);
                
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Token refresh error:', error);
            return false;
        }
    }

    /**
     * Make authenticated API request
     */
    async request(url, options = {}) {
        // Ensure we have a valid token
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        // Add authorization header
        const headers = {
            ...options.headers,
            'Authorization': `Bearer ${this.accessToken}`,
        };

        try {
            let response = await fetch(`${API_BASE_URL}${url}`, {
                ...options,
                headers,
            });

            // If unauthorized, try to refresh token
            if (response.status === 401) {
                const refreshed = await this.refreshAccessToken();
                
                if (refreshed) {
                    // Retry request with new token
                    headers['Authorization'] = `Bearer ${this.accessToken}`;
                    response = await fetch(`${API_BASE_URL}${url}`, {
                        ...options,
                        headers,
                    });
                } else {
                    // Refresh failed, user needs to login again
                    this.clearTokens();
                    throw new Error('Session expired. Please login again.');
                }
            }

            return response;
        } catch (error) {
            console.error('API request error:', error);
            throw error;
        }
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!this.accessToken;
    }

    /**
     * Get current username
     */
    getUsername() {
        return this.username;
    }
}

// Export singleton instance
const authManager = new AuthManager();