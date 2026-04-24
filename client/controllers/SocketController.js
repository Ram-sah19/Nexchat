/**
 * SocketController — the "nervous system".
 * Owns the WebSocket connection, dispatches incoming events to the right controller,
 * and exposes send() for all outgoing messages.
 *
 * Circular deps are resolved post-construction via wire().
 */
class SocketController {
  /**
   * @param {ChatModel} chatModel
   * @param {{ WS_URL: string }} config
   */
  constructor(chatModel, config) {
    this.chatModel = chatModel;
    this.WS_URL    = config.WS_URL;
    this.socket    = null;

    // Filled by wire()
    this.chatCtrl   = null;
    this.friendCtrl = null;
    this.authCtrl   = null;
    this.userModel  = null;
    this.authModel  = null;
    this.sidebarView = null;
    this.chatView    = null;
    this.toastView   = null;
  }

  /** Inject cross-controller dependencies after all instances are created. */
  wire({ chatCtrl, friendCtrl, authCtrl, userModel, authModel, sidebarView, chatView, toastView }) {
    this.chatCtrl    = chatCtrl;
    this.friendCtrl  = friendCtrl;
    this.authCtrl    = authCtrl;
    this.userModel   = userModel;
    this.authModel   = authModel;
    this.sidebarView = sidebarView;
    this.chatView    = chatView;
    this.toastView   = toastView;
  }

  // ─── Connection Lifecycle ────────────────────────────────────────────────────

  connect(token, exportedPublicKey) {
    this.socket = new WebSocket(`${this.WS_URL}/?token=${token}`);

    this.socket.onopen = () => {
      this.send('join', { publicKey: exportedPublicKey });
    };

    this.socket.onerror = err => {
      alert('Connection error. Please ensure the Java WebSocket server is running.');
      console.error('[WS] Error:', err);
    };

    this.socket.onclose = () => console.log('[WS] Disconnected.');

    this.socket.onmessage = e => this._handleMessage(e);
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  // ─── Send ────────────────────────────────────────────────────────────────────

  /**
   * Send a typed message over the WebSocket.
   *
   * @param {string}  type             — event type string
   * @param {Object}  payload          — message body
   * @param {boolean} expectsResponse  — if true, returns a Promise resolved on reqId match
   * @returns {Promise<any>}
   */
  send(type, payload = {}, expectsResponse = false) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Socket not connected'));
    }

    const msg = { type, payload };

    if (expectsResponse) {
      const reqId = this.chatModel.nextReqId();
      msg.reqId   = reqId;

      const promise = new Promise((resolve, reject) => {
        this.chatModel.pendingRequests.set(reqId, { resolve, reject });

        // 10-second timeout guard
        setTimeout(() => {
          if (this.chatModel.pendingRequests.has(reqId)) {
            this.chatModel.pendingRequests.get(reqId).reject(new Error('WS request timeout'));
            this.chatModel.pendingRequests.delete(reqId);
          }
        }, 10000);
      });

      this.socket.send(JSON.stringify(msg));
      return promise;
    }

    this.socket.send(JSON.stringify(msg));
    return Promise.resolve();
  }

  /**
   * Convenience: trigger a full sidebar re-render from any controller.
   * Uses the wired friendCtrl to produce the canonical callback set.
   */
  renderSidebar() {
    const cb = this.friendCtrl._makeCallbacks();
    this.sidebarView.renderAllUsers(this.userModel, this.authModel.username, cb);
    this.sidebarView.renderFriendsList(this.userModel, this.chatModel.activeChatUser, cb);
    this.sidebarView.renderFriendRequests(this.userModel, cb);
  }

  // ─── Incoming Message Dispatcher ─────────────────────────────────────────────

  async _handleMessage(event) {
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch (e) {
      console.error('[WS] Could not parse message:', e);
      return;
    }

    const { type, payload, reqId } = parsed;

    // Resolve pending request-response callbacks first
    if (reqId && this.chatModel.pendingRequests.has(reqId)) {
      this.chatModel.pendingRequests.get(reqId).resolve(payload);
      this.chatModel.pendingRequests.delete(reqId);
      return;
    }

    try {
      switch (type) {

        // ── Broadcasting ────────────────────────────────────────────
        case 'user_list':
          this.userModel.setAllUsers(payload);
          this.renderSidebar();
          break;

        case 'online_users':
          this.userModel.setOnlineUsers(payload);
          this.renderSidebar();
          break;

        // ── E2EE Chat ───────────────────────────────────────────────
        case 'receive_message':
          await this.chatCtrl.handleIncomingMessage(payload);
          break;

        // ── Friend System — live relay events ───────────────────────
        case 'new_friend_request':
          this.userModel.addPendingReceived(payload.from);
          this.toastView.show(`🔔 New friend request from ${payload.from}!`);
          this.renderSidebar();
          break;

        case 'friendship_activated':
          this.userModel.addFriend(payload.with);
          this.userModel.removePendingSent(payload.with);
          this.userModel.removePendingReceived(payload.with);
          this.toastView.show(`✅ You are now friends with ${payload.with}!`);
          this.renderSidebar();
          break;

        case 'friend_removed':
          this.userModel.removeFriend(payload.from);
          this.toastView.show(`❌ ${payload.from} removed you as a friend.`);
          if (this.chatModel.activeChatUser === payload.from) {
            this.chatView.clearMessages();
            this.chatView.setChatUser(null);
            this.chatView.setInputEnabled(false);
            this.chatModel.clearActiveUser();
          }
          this.renderSidebar();
          break;

        // ── Server error (e.g. blocked non-friend message) ──────────
        case 'error':
          this.toastView.show(`⚠️ ${payload.message}`, 'error');
          break;

        default:
          console.log('[WS] Unknown event type:', type);
      }
    } catch (e) {
      console.error('[WS] Error handling event:', type, e);
    }
  }
}
