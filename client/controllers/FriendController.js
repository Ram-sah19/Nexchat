/**
 * FriendController — all friend relationship CRUD actions.
 *
 * Responsibilities:
 *  1. Calls Python REST API (send, accept, reject, remove, status)
 *  2. Mutates UserModel
 *  3. Relays live events to Java via SocketController
 *  4. Re-renders the sidebar via SidebarView
 *  5. Owns the 5-second polling safety net
 */
class FriendController {
  /**
   * @param {AuthModel}    authModel
   * @param {UserModel}    userModel
   * @param {ChatModel}    chatModel
   * @param {SidebarView}  sidebarView
   * @param {ChatView}     chatView
   * @param {ToastView}    toastView
   * @param {string}       REST_URL
   */
  constructor(authModel, userModel, chatModel, sidebarView, chatView, toastView, REST_URL) {
    this.authModel   = authModel;
    this.userModel   = userModel;
    this.chatModel   = chatModel;
    this.sidebarView = sidebarView;
    this.chatView    = chatView;
    this.toastView   = toastView;
    this.REST_URL    = REST_URL;

    // Filled by wire()
    this.socketCtrl = null;
    this.chatCtrl   = null;
  }

  /** Inject circular dependencies post-construction. */
  wire(socketCtrl, chatCtrl) {
    this.socketCtrl = socketCtrl;
    this.chatCtrl   = chatCtrl;
  }

  /**
   * Produces the consolidated callback object required by all SidebarView render calls.
   * Called by SocketController.renderSidebar() too—hence it must be public.
   */
  _makeCallbacks() {
    return {
      onSelect:   u => this.chatCtrl.selectUser(u),
      onAdd:      u => this.sendFriendRequest(u),
      onAccept:   u => this.acceptFriendRequest(u),
      onReject:   u => this.rejectFriendRequest(u),
      onUnfriend: u => this.unfriend(u),
    };
  }

  _renderAll() {
    const cb = this._makeCallbacks();
    this.sidebarView.renderAllUsers(this.userModel, this.authModel.username, cb);
    this.sidebarView.renderFriendsList(this.userModel, this.chatModel.activeChatUser, cb);
    this.sidebarView.renderFriendRequests(this.userModel, cb);
  }

  // ─── API Actions ──────────────────────────────────────────────────────────────

  /** Initial load + used by the polling safety net. */
  async loadFriendStatus() {
    try {
      const res  = await fetch(`${this.REST_URL}/friends/status`, {
        headers: this.authModel.authHeader
      });
      const data = await res.json();
      this.userModel.setFriendStatus(data);
      this._renderAll();
    } catch (e) {
      console.error('[FriendCtrl] loadFriendStatus failed:', e);
    }
  }

  async sendFriendRequest(receiver) {
    try {
      const res  = await fetch(`${this.REST_URL}/friends/request`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...this.authModel.authHeader },
        body:    JSON.stringify({ receiver })
      });
      const data = await res.json();
      if (res.ok) {
        this.userModel.addPendingSent(receiver);
        this._renderAll();
        this.toastView.show(`🤝 Friend request sent to ${receiver}!`);
        // Relay live alert via WebSocket
        this.socketCtrl
          .send('friend_request_sent', { to: receiver })
          .catch(e => console.warn('[WS Relay] friend_request_sent:', e.message));
      } else {
        this.toastView.show(data.error || 'Failed to send request', 'error');
      }
    } catch (e) {
      this.toastView.show('Network error', 'error');
    }
  }

  async acceptFriendRequest(sender) {
    try {
      const res = await fetch(`${this.REST_URL}/friends/accept`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...this.authModel.authHeader },
        body:    JSON.stringify({ sender })
      });
      if (res.ok) {
        // Clear from pending panel immediately; UI will add to "My Friends" via WS event
        this.userModel.removePendingReceived(sender);
        this._renderAll();
        // Java fires `friendship_activated` to BOTH sides
        this.socketCtrl
          .send('friend_request_accepted', { to: sender })
          .catch(e => console.warn('[WS Relay] friend_request_accepted:', e.message));
      } else {
        const data = await res.json();
        this.toastView.show(data.error || 'Failed to accept', 'error');
      }
    } catch (e) {
      this.toastView.show('Network error', 'error');
    }
  }

  async rejectFriendRequest(sender) {
    try {
      const res = await fetch(`${this.REST_URL}/friends/reject`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...this.authModel.authHeader },
        body:    JSON.stringify({ sender })
      });
      if (res.ok) {
        this.userModel.removePendingReceived(sender);
        this._renderAll();
        this.toastView.show(`Request from ${sender} declined.`);
      }
    } catch (e) {
      this.toastView.show('Network error', 'error');
    }
  }

  async unfriend(target) {
    try {
      const res = await fetch(`${this.REST_URL}/friends/remove`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...this.authModel.authHeader },
        body:    JSON.stringify({ target })
      });
      if (res.ok) {
        this.userModel.removeFriend(target);
        if (this.chatModel.activeChatUser === target) {
          this.chatView.clearMessages();
          this.chatView.setChatUser(null);
          this.chatView.setInputEnabled(false);
          this.chatModel.clearActiveUser();
        }
        this._renderAll();
        this.toastView.show(`Unfriended ${target}.`);
        this.socketCtrl
          .send('friend_removed_notify', { to: target })
          .catch(e => console.warn('[WS Relay] friend_removed_notify:', e.message));
      } else {
        const data = await res.json();
        this.toastView.show(data.error || 'Failed to unfriend', 'error');
      }
    } catch (e) {
      this.toastView.show('Network error', 'error');
    }
  }

  // ─── Polling Safety Net ───────────────────────────────────────────────────────

  /**
   * Starts a 5-second interval that compares local state with MongoDB.
   * If the server state differs (missed WS relay), re-renders automatically.
   * Returns the interval ID so AuthController can clear it on logout.
   */
  startPolling() {
    return setInterval(async () => {
      if (!this.authModel.isLoggedIn) return;

      try {
        const res  = await fetch(`${this.REST_URL}/friends/status`, {
          headers: this.authModel.authHeader
        });
        if (!res.ok) return;
        const data = await res.json();

        const newFriends  = data.friends          || [];
        const newSent     = data.pending_sent     || [];
        const newReceived = data.pending_received || [];

        const changed =
          JSON.stringify(newFriends.sort())  !== JSON.stringify([...this.userModel.myFriends].sort())   ||
          JSON.stringify(newSent.sort())     !== JSON.stringify([...this.userModel.pendingSent].sort())  ||
          JSON.stringify(newReceived.map(r => r.sender).sort()) !==
          JSON.stringify(this.userModel.pendingReceived.map(r => r.sender).sort());

        if (changed) {
          console.log('[Sync] State drift detected — syncing from DB...');
          this.userModel.setFriendStatus(data);
          this._renderAll();
        }
      } catch (_) { /* silently ignore — will retry next interval */ }
    }, 5000);
  }
}
