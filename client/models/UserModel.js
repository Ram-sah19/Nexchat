/**
 * UserModel — stores the social graph and online status.
 * Pure data — no DOM, no fetch, no WebSocket.
 */
class UserModel {
  constructor() {
    this.myFriends          = [];   // accepted friends (usernames)
    this.pendingSent        = [];   // usernames we sent requests to
    this.pendingReceived    = [];   // [{ sender }] requests received by us
    this.allRegisteredUsers = [];   // everyone in the system
    this.onlineUserSet      = new Set(); // currently connected users
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

  reset() {
    this.myFriends = [];
    this.pendingSent = [];
    this.pendingReceived = [];
    this.allRegisteredUsers = [];
    this.onlineUserSet.clear();
  }
}
