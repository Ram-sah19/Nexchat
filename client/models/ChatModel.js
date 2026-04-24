/**
 * ChatModel — stores E2EE key state, active chat session, and the WS req-response map.
 * Pure data — no DOM, no fetch, no WebSocket.
 */
class ChatModel {
  constructor() {
    this.activeChatUser    = null;      // username currently open in chat pane
    this.sharedKeys        = {};        // username → CryptoKey (derived via ECDH)
    this.localKeyPair      = null;      // { publicKey, privateKey } — ECDH CryptoKeyPair
    this.exportedPublicKey = null;      // JWK of own public key (sent to server on join)

    // Request-response mapper for fire-and-await WS patterns
    this._reqCounter      = 0;
    this.pendingRequests  = new Map(); // reqId → { resolve, reject }
  }

  nextReqId() { return String(++this._reqCounter); }

  setSharedKey(username, key) { this.sharedKeys[username] = key; }
  getSharedKey(username)      { return this.sharedKeys[username] || null; }
  hasSharedKey(username)      { return !!this.sharedKeys[username]; }

  setActiveUser(username)  { this.activeChatUser = username; }
  clearActiveUser()        { this.activeChatUser = null; }

  reset() {
    this.activeChatUser    = null;
    this.sharedKeys        = {};
    this.localKeyPair      = null;
    this.exportedPublicKey = null;
    this._reqCounter       = 0;
    this.pendingRequests.clear();
  }
}
