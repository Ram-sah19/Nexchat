/**
 * AuthModel — stores authentication state.
 * Pure data — no DOM, no fetch, no WebSocket.
 */
class AuthModel {
  constructor() {
    this.token      = null;
    this.username   = null;
    this.isLoggedIn = false;
  }

  setAuth(token, username) {
    this.token      = token;
    this.username   = username;
    this.isLoggedIn = true;
  }

  clearAuth() {
    this.token      = null;
    this.username   = null;
    this.isLoggedIn = false;
  }

  /** Convenience getter — returns Authorization header object. */
  get authHeader() {
    return { 'Authorization': `Bearer ${this.token}` };
  }
}
