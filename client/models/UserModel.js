/**
 * UserModel — stores the social graph and online status.
 * Pure data — no DOM, no fetch, no WebSocket.
 */
class UserModel {
  constructor() {
    this.myFriends          = [];
    this.pendingSent        = [];
    this.pendingReceived    = [];
    this.allRegisteredUsers = [];
    this.onlineUserSet      = new Set();
    this.unreadCounts       = {};   // username → number of unread messages
    this.typingUsers        = new Set(); // usernames currently typing
  }

  /** Bulk-replace state from GET /friends/status response. */
  setFriendStatus({ friends = [], pending_sent = [], pending_received = [] }) {
    this.myFriends       = friends;
    this.pendingSent     = pending_sent;
    this.pendingReceived = pending_received;
  }

  setAllUsers(users)    { this.allRegisteredUsers = users; }
  setOnlineUsers(users) { this.onlineUserSet = new Set(users); }

  // ─── Predicates ────────────────────────────────────────────────
  isFriend(u)        { return this.myFriends.includes(u); }
  hasSentRequest(u)  { return this.pendingSent.includes(u); }
  hasReceivedFrom(u) { return this.pendingReceived.some(r => r.sender === u); }
  isOnline(u)        { return this.onlineUserSet.has(u); }

  // ─── Mutations ─────────────────────────────────────────────────
  addFriend(u) {
    if (!this.myFriends.includes(u)) this.myFriends.push(u);
  }
  removeFriend(u) {
    this.myFriends = this.myFriends.filter(f => f !== u);
  }

  addPendingSent(u) {
    if (!this.pendingSent.includes(u)) this.pendingSent.push(u);
  }
  removePendingSent(u) {
    this.pendingSent = this.pendingSent.filter(f => f !== u);
  }

  addPendingReceived(sender) {
    if (!this.pendingReceived.some(r => r.sender === sender)) {
      this.pendingReceived.push({ sender });
    }
  }
  removePendingReceived(sender) {
    this.pendingReceived = this.pendingReceived.filter(r => r.sender !== sender);
  }

  // ─── Unread Counts ───────────────────────────────────────────────────────────
  incrementUnread(u) { this.unreadCounts[u] = (this.unreadCounts[u] || 0) + 1; }
  clearUnread(u)     { delete this.unreadCounts[u]; }
  getUnread(u)       { return this.unreadCounts[u] || 0; }
  hasUnread(u)       { return (this.unreadCounts[u] || 0) > 0; }

  // ─── Typing ────────────────────────────────────────────────────────────────
  setTyping(u, isTyping) {
    isTyping ? this.typingUsers.add(u) : this.typingUsers.delete(u);
  }
  isTyping(u) { return this.typingUsers.has(u); }

  reset() {
    this.myFriends = [];
    this.pendingSent = [];
    this.pendingReceived = [];
    this.allRegisteredUsers = [];
    this.onlineUserSet.clear();
    this.unreadCounts = {};
    this.typingUsers.clear();
  }
}
