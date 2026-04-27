/**
 * ChatController — E2EE key management, message encryption/decryption, and chat UI.
 *
 * Responsibilities:
 *  1. initCrypto — restore or generate the ECDH key pair
 *  2. fetchPublicKeyAndDerive — ECDH key exchange via Java WS
 *  3. selectUser — open a chat, fetch/decrypt history
 *  4. sendMessage — encrypt + dispatch + update UI
 *  5. handleIncomingMessage — decrypt + display
 */
class ChatController {
  /**
   * @param {AuthModel}    authModel
   * @param {ChatModel}    chatModel
   * @param {UserModel}    userModel
   * @param {ChatView}     chatView
   * @param {SidebarView}  sidebarView
   * @param {ToastView}    toastView
   * @param {string}       REST_URL
   */
  constructor(authModel, chatModel, userModel, chatView, sidebarView, toastView, REST_URL) {
    this.authModel   = authModel;
    this.chatModel   = chatModel;
    this.userModel   = userModel;
    this.chatView    = chatView;
    this.sidebarView = sidebarView;
    this.toastView   = toastView;
    this.REST_URL    = REST_URL;

    // Filled by wire()
    this.socketCtrl = null;
    this.friendCtrl = null;

    this._bindEvents();
  }

  /** Inject circular dependencies post-construction. */
  wire(socketCtrl, friendCtrl) {
    this.socketCtrl = socketCtrl;
    this.friendCtrl = friendCtrl;
  }

  _bindEvents() {
    this.chatView.sendBtn.addEventListener('click', () => this.sendMessage());
    this.chatView.messageInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') this.sendMessage();
    });

    // ── Typing indicator ─────────────────────────────────────────────────
    this._typingTimer   = null;
    this._isTypingSent  = false;
    this.chatView.messageInput.addEventListener('input', () => {
      if (!this.chatModel.activeChatUser) return;

      // Send typing_start once until stop
      if (!this._isTypingSent) {
        this._isTypingSent = true;
        this.socketCtrl?.send('typing', { to: this.chatModel.activeChatUser, isTyping: true });
      }

      // Reset the stop-typing debounce timer
      clearTimeout(this._typingTimer);
      this._typingTimer = setTimeout(() => this._stopTyping(), 2500);
    });
  }

  _stopTyping() {
    if (!this._isTypingSent) return;
    this._isTypingSent = false;
    if (this.chatModel.activeChatUser) {
      this.socketCtrl?.send('typing', { to: this.chatModel.activeChatUser, isTyping: false });
    }
  }

  // ─── Crypto Init ──────────────────────────────────────────────────────────────

  /**
   * Restores or generates the local ECDH key pair.
   * Priority: localStorage → server backup → generate new.
   *
   * @param {string}      password
   * @param {Object|null} serverPublicKey
   * @param {Object|null} serverEncryptedPrivateKey
   */
  async initCrypto(password, serverPublicKey, serverEncryptedPrivateKey) {
    const u           = this.authModel.username;
    const storedPriv  = localStorage.getItem(`chat_private_key_${u}`);
    const storedPub   = localStorage.getItem(`chat_public_key_${u}`);

    if (storedPriv && storedPub) {
      // ① Restore from localStorage — key is unchanged, do NOT overwrite server copy
      const pub  = JSON.parse(storedPub);
      const priv = JSON.parse(storedPriv);
      this.chatModel.localKeyPair = {
        publicKey:  await importPublicKey(pub),
        privateKey: await crypto.subtle.importKey('jwk', priv, ecdhParams, true, ['deriveKey', 'deriveBits'])
      };
      this.chatModel.exportedPublicKey = pub;
      return false; // existing key — Java must NOT overwrite DB

    } else if (serverEncryptedPrivateKey && serverPublicKey) {
      // ② Restore from server (cross-device) — key is unchanged
      const privJwk = await decryptPrivateKey(serverEncryptedPrivateKey, password, u);
      this.chatModel.localKeyPair = {
        publicKey:  await importPublicKey(serverPublicKey),
        privateKey: await crypto.subtle.importKey('jwk', privJwk, ecdhParams, true, ['deriveKey', 'deriveBits'])
      };
      this.chatModel.exportedPublicKey = serverPublicKey;
      localStorage.setItem(`chat_private_key_${u}`, JSON.stringify(privJwk));
      localStorage.setItem(`chat_public_key_${u}`, JSON.stringify(serverPublicKey));
      return false; // existing key — Java must NOT overwrite DB

    } else {
      // ③ Generate fresh key pair (new device / first login)
      const kp      = await generateKeyPair();
      const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
      const pubJwk  = await exportPublicKey(kp.publicKey);
      this.chatModel.localKeyPair      = kp;
      this.chatModel.exportedPublicKey = pubJwk;
      localStorage.setItem(`chat_private_key_${u}`, JSON.stringify(privJwk));
      localStorage.setItem(`chat_public_key_${u}`, JSON.stringify(pubJwk));
      return true; // brand-new key — Java MUST update DB
    }
  }

  // ─── Key Exchange ─────────────────────────────────────────────────────────────

  /**
   * Requests the target's public key from Java and derives an ECDH shared AES key.
   * Result is cached in ChatModel.sharedKeys.
   */
  async fetchPublicKeyAndDerive(targetUsername) {
    const response = await this.socketCtrl.send(
      'request_public_key', { receiver: targetUsername }, true
    );
    if (response.error) throw new Error(response.error);
    if (!response.publicKey) throw new Error('Empty public key response');

    const otherPubKey = await importPublicKey(response.publicKey);
    const sharedKey   = await deriveSharedKey(this.chatModel.localKeyPair.privateKey, otherPubKey);
    this.chatModel.setSharedKey(targetUsername, sharedKey);
    return sharedKey;
  }

  // ─── Select User / Open Chat ──────────────────────────────────────────────────

  /**
   * Opens a conversation with the given user:
   *  1. Updates active state in ChatModel
   *  2. Clears and repopulates the chat view
   *  3. Ensures a shared key exists (derives if missing)
   *  4. Fetches + decrypts message history
   */
  async selectUser(username) {
    // Clear unread for this friend and re-render sidebar
    this.userModel.clearUnread(username);
    this.socketCtrl.renderSidebar();

    this.chatModel.setActiveUser(username);
    this.chatView.setChatUser(username);
    this.chatView.clearMessages();
    this.chatView.setInputEnabled(true);
    this.chatView.hideTyping();

    // Re-render sidebar again for active highlight
    this.socketCtrl.renderSidebar();

    // Ensure shared key
    if (!this.chatModel.hasSharedKey(username)) {
      try {
        await this.fetchPublicKeyAndDerive(username);
      } catch (e) {
        console.warn(`[Chat] Could not derive key for ${username}:`, e.message);
        return;
      }
    }

    // Fetch messages AND call history in parallel
    let messages = [], callHistory = [];
    try {
      [messages, callHistory] = await Promise.all([
        this.socketCtrl.send('fetch_history',      { withUser: username }, true),
        this.socketCtrl.send('fetch_call_history', { withUser: username }, true).catch(() => [])
      ]);
    } catch (e) {
      console.error('[Chat] Failed to fetch history:', e);
      return;
    }

    // Build merged timeline sorted by timestamp
    const timeline = [];
    for (const msg of (messages || [])) {
      timeline.push({ kind: 'message', ts: msg.timestamp, data: msg });
    }
    for (const call of (Array.isArray(callHistory) ? callHistory : [])) {
      timeline.push({ kind: 'call', ts: call.startedAt, data: call });
    }
    timeline.sort((a, b) => a.ts - b.ts);

    // Render the merged timeline
    for (const item of timeline) {
      if (item.kind === 'call') {
        this.chatView.appendCallRecord(item.data, this.authModel.username);
      } else {
        const msg    = item.data;
        const isMine = msg.sender === this.authModel.username;
        try {
          const text = await decryptMessage(this.chatModel.getSharedKey(username), msg.ciphertext, msg.iv);
          // History sent messages show double-grey (delivered) since they were received
          this.chatView.appendMessage(
            isMine ? 'You' : msg.sender,
            text,
            isMine ? 'sent' : 'recv',
            isMine ? { to: username, status: 'delivered' } : {}
          );
        } catch (err) {
          this.chatView.appendMessage(
            isMine ? 'You' : msg.sender,
            '[Message could not be decrypted]',
            isMine ? 'sent' : 'recv',
            isMine ? { to: username, status: 'delivered' } : {}
          );
        }
      }
    }

    // Opening this chat means we've seen all messages from this user
    this.socketCtrl.send('message_seen', { to: username });
  }

  // ─── Send Message ─────────────────────────────────────────────────────────────

  async sendMessage() {
    const text     = this.chatView.getMessageText();
    const receiver = this.chatModel.activeChatUser;
    if (!text || !receiver) return;

    // Stop typing indicator as soon as message is sent
    this._stopTyping();
    clearTimeout(this._typingTimer);

    try {
      let sharedKey = this.chatModel.getSharedKey(receiver);
      if (!sharedKey) sharedKey = await this.fetchPublicKeyAndDerive(receiver);

      const { ciphertext, iv } = await encryptMessage(sharedKey, text);
      this.socketCtrl.send('send_message', { receiver, ciphertext, iv });
      // Append with single tick (sent); upgrades to delivered/seen via WS events
      this.chatView.appendMessage('You', text, 'sent', { to: receiver, status: 'sent' });
      this.chatView.clearInput();
    } catch (e) {
      this.toastView.show('Could not encrypt/send: ' + e.message, 'error');
    }
  }

  // ─── Incoming Message ─────────────────────────────────────────────────────────

  /**
   * Called by SocketController when a `receive_message` event arrives.
   * Derives key if missing, decrypts, appends to chat view, and manages unread count.
   */
  async handleIncomingMessage(data) {
    try {
      let sharedKey = this.chatModel.getSharedKey(data.sender);
      if (!sharedKey) sharedKey = await this.fetchPublicKeyAndDerive(data.sender);

      const text = await decryptMessage(sharedKey, data.ciphertext, data.iv);

      if (this.chatModel.activeChatUser === data.sender) {
        // Chat is open — append and immediately send seen
        this.chatView.appendMessage(data.sender, text, 'recv');
        this.socketCtrl.send('message_seen', { to: data.sender });
      } else {
        // Chat NOT open — send delivered (received but not seen)
        this.socketCtrl.send('message_delivered', { to: data.sender });
        this.userModel.incrementUnread(data.sender);
        this.socketCtrl.renderSidebar();
        if (!this.chatModel.activeChatUser) {
          await this.selectUser(data.sender);
        }
      }
    } catch (e) {
      console.error('[Chat] Failed to decrypt incoming message:', e);
    }
  }

  /**
   * Called by SocketController when a `typing` event arrives.
   */
  handleTypingEvent(payload) {
    const { from, isTyping } = payload;
    this.userModel.setTyping(from, isTyping);
    this.socketCtrl.renderSidebar();

    // Show/hide inline typing indicator only if chat is open with that person
    if (this.chatModel.activeChatUser === from) {
      isTyping ? this.chatView.showTyping(from) : this.chatView.hideTyping();
    }
  }
}
