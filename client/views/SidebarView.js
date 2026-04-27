/**
 * SidebarView — renders all three sidebar sections:
 *   • Friend Requests notification panel
 *   • My Friends (chat zone)
 *   • All Users (discovery zone)
 *
 * DOM only — all action callbacks are injected by controllers.
 *
 * @typedef {{ onSelect, onAdd, onAccept, onReject, onUnfriend }} SidebarCallbacks
 */
class SidebarView {
  constructor() {
    this.allUsersListEl        = document.getElementById('all-users-list');
    this.friendsListEl         = document.getElementById('friends-list');
    this.friendRequestsPanelEl = document.getElementById('friend-requests-panel');
    this.currentUsernameSpan   = document.getElementById('current-username');
    this.sidebarEl             = document.querySelector('.sidebar');
    this.collapseBtn           = document.getElementById('collapse-btn');
    this.logoutBtn             = document.getElementById('logout-btn');
  }

  setUsername(username) {
    this.currentUsernameSpan.textContent = username;
  }

  toggleCollapse() {
    this.sidebarEl.classList.toggle('collapsed');
  }

  /**
   * Renders the "All Users" discovery panel.
   *
   * @param {UserModel}       userModel
   * @param {string}          currentUsername  — the logged-in user (excluded from list)
   * @param {SidebarCallbacks} callbacks
   */
  renderAllUsers(userModel, currentUsername, callbacks) {
    this.allUsersListEl.innerHTML = '';
    const others = userModel.allRegisteredUsers.filter(u => u !== currentUsername);

    if (others.length === 0) {
      this._appendEmpty(this.allUsersListEl, 'No other users yet');
      return;
    }

    others.forEach(u => {
      const li = document.createElement('li');
      li.className = 'user-item';

      // Left: status dot + name
      const left = document.createElement('div');
      left.className = 'user-item-left';
      left.appendChild(this._makeDot(userModel.isOnline(u)));

      const name = document.createElement('span');
      name.className   = 'user-item-name';
      name.textContent = u;
      left.appendChild(name);

      // Right: contextual action button(s)
      const btnArea = document.createElement('div');
      btnArea.className = 'user-btn-area';

      if (userModel.isFriend(u)) {
        const badge = document.createElement('span');
        badge.className = 'friends-badge';
        badge.innerHTML = `<i class="ph-fill ph-check-circle"></i> Friends`;

        const unfriendBtn = document.createElement('button');
        unfriendBtn.className = 'unfriend-btn';
        unfriendBtn.title     = `Unfriend ${u}`;
        unfriendBtn.innerHTML = `<i class="ph-bold ph-user-minus"></i>`;
        unfriendBtn.onclick   = e => { e.stopPropagation(); callbacks.onUnfriend(u); };

        btnArea.appendChild(badge);
        btnArea.appendChild(unfriendBtn);

      } else if (userModel.hasSentRequest(u)) {
        const btn     = document.createElement('button');
        btn.className = 'pending-btn';
        btn.textContent = 'Pending…';
        btn.disabled    = true;
        btnArea.appendChild(btn);

      } else if (userModel.hasReceivedFrom(u)) {
        const acceptBtn     = document.createElement('button');
        acceptBtn.className = 'accept-btn-sm';
        acceptBtn.textContent = 'Accept';
        acceptBtn.onclick   = e => { e.stopPropagation(); callbacks.onAccept(u); };

        const rejectBtn     = document.createElement('button');
        rejectBtn.className = 'reject-btn-sm';
        rejectBtn.innerHTML = `<i class="ph-bold ph-x"></i>`;
        rejectBtn.onclick   = e => { e.stopPropagation(); callbacks.onReject(u); };

        btnArea.appendChild(acceptBtn);
        btnArea.appendChild(rejectBtn);

      } else {
        const btn     = document.createElement('button');
        btn.className = 'add-friend-btn';
        btn.innerHTML = `<i class="ph-bold ph-user-plus"></i> Add`;
        btn.onclick   = e => { e.stopPropagation(); callbacks.onAdd(u); };
        btnArea.appendChild(btn);
      }

      li.appendChild(left);
      li.appendChild(btnArea);
      this.allUsersListEl.appendChild(li);
    });
  }

  /**
   * Renders the "My Friends" chat zone.
   *
   * @param {UserModel}       userModel
   * @param {string|null}     activeChatUser  — highlights the active conversation
   * @param {SidebarCallbacks} callbacks
   */
  renderFriendsList(userModel, activeChatUser, callbacks) {
    this.friendsListEl.innerHTML = '';

    if (userModel.myFriends.length === 0) {
      this._appendEmpty(this.friendsListEl, 'No friends yet — add someone below!');
      return;
    }

    userModel.myFriends.forEach(u => {
      const li = document.createElement('li');
      li.className = 'friend-item';
      if (u === activeChatUser) li.classList.add('active');

      // Status dot OR animated typing dots
      if (userModel.isTyping(u)) {
        const typingDot = document.createElement('span');
        typingDot.className = 'typing-dot-sidebar';
        typingDot.innerHTML =
          '<span></span><span></span><span></span>';
        li.appendChild(typingDot);
      } else {
        li.appendChild(this._makeDot(userModel.isOnline(u)));
      }

      const name = document.createElement('span');
      name.textContent = u;
      name.style.flex  = '1';
      li.appendChild(name);

      // Unread badge
      const count = userModel.getUnread(u);
      if (count > 0 && u !== activeChatUser) {
        const badge = document.createElement('span');
        badge.className   = 'unread-badge';
        badge.textContent = count > 99 ? '99+' : count;
        li.appendChild(badge);
      }

      li.onclick = () => callbacks.onSelect(u);
      this.friendsListEl.appendChild(li);
    });
  }

  /**
   * Renders the incoming friend requests notification panel.
   *
   * @param {UserModel}       userModel
   * @param {SidebarCallbacks} callbacks
   */
  renderFriendRequests(userModel, callbacks) {
    if (userModel.pendingReceived.length === 0) {
      this.friendRequestsPanelEl.classList.add('hidden');
      return;
    }

    this.friendRequestsPanelEl.classList.remove('hidden');
    this.friendRequestsPanelEl.innerHTML = `
      <div class="requests-header">
        <i class="ph-fill ph-bell-ringing"></i>
        <span>Friend Requests</span>
        <span class="requests-badge">${userModel.pendingReceived.length}</span>
      </div>
    `;

    userModel.pendingReceived.forEach(req => {
      const item = document.createElement('div');
      item.className = 'request-item';
      item.innerHTML = `<span class="request-sender">${req.sender}</span>`;

      const actions = document.createElement('div');
      actions.className = 'request-actions';

      const acceptBtn     = document.createElement('button');
      acceptBtn.className = 'accept-btn';
      acceptBtn.textContent = 'Accept';
      acceptBtn.onclick   = () => callbacks.onAccept(req.sender);

      const rejectBtn     = document.createElement('button');
      rejectBtn.className = 'reject-btn';
      rejectBtn.textContent = 'Decline';
      rejectBtn.onclick   = () => callbacks.onReject(req.sender);

      actions.appendChild(acceptBtn);
      actions.appendChild(rejectBtn);
      item.appendChild(actions);
      this.friendRequestsPanelEl.appendChild(item);
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  _makeDot(isOnline) {
    const dot = document.createElement('span');
    dot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
    return dot;
  }

  _appendEmpty(container, msg) {
    const li = document.createElement('li');
    li.className   = 'empty-state';
    li.textContent = msg;
    container.appendChild(li);
  }
}
