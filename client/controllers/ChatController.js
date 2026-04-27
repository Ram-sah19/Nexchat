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
    this.chatModel.setActiveUser(username);
    this.chatView.setChatUser(username);
    this.chatView.clearMessages();
    this.chatView.setInputEnabled(true);

    // Refresh active-item highlight in sidebar
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

    // Fetch and decrypt history
    try {
      const messages = await this.socketCtrl.send('fetch_history', { withUser: username }, true);
      for (const msg of messages) {
        try {
          const text = await decryptMessage(this.chatModel.getSharedKey(username), msg.ciphertext, msg.iv);
          const isMine = msg.sender === this.authModel.username;
          this.chatView.appendMessage(isMine ? 'You' : msg.sender, text, isMine ? 'sent' : 'recv');
        } catch (err) {
          const isMine = msg.sender === this.authModel.username;
          console.error('[Chat] History decrypt failed:', err.name);
          this.chatView.appendMessage(
            isMine ? 'You' : msg.sender,
            '[Message could not be decrypted]',
            isMine ? 'sent' : 'recv'
          );
        }
      }
    } catch (e) {
      console.error('[Chat] Failed to fetch history:', e);
    }
  }

  // ─── Send Message ─────────────────────────────────────────────────────────────

  async sendMessage() {
    const text     = this.chatView.getMessageText();
    const receiver = this.chatModel.activeChatUser;
    if (!text || !receiver) return;

    try {
      let sharedKey = this.chatModel.getSharedKey(receiver);
      if (!sharedKey) sharedKey = await this.fetchPublicKeyAndDerive(receiver);

      const { ciphertext, iv } = await encryptMessage(sharedKey, text);
      this.socketCtrl.send('send_message', { receiver, ciphertext, iv });
      this.chatView.appendMessage('You', text, 'sent');
      this.chatView.clearInput();
    } catch (e) {
      this.toastView.show('Could not encrypt/send: ' + e.message, 'error');
    }
  }

  // ─── Incoming Message ─────────────────────────────────────────────────────────

  /**
   * Called by SocketController when a `receive_message` event arrives.
   * Derives key if missing, decrypts, and appends to chat view.
   */
  async handleIncomingMessage(data) {
    try {
      let sharedKey = this.chatModel.getSharedKey(data.sender);
      if (!sharedKey) sharedKey = await this.fetchPublicKeyAndDerive(data.sender);

      const text = await decryptMessage(sharedKey, data.ciphertext, data.iv);

      // Auto-open conversation if message arrives from someone else
      if (this.chatModel.activeChatUser !== data.sender) {
        await this.selectUser(data.sender);
      }

      this.chatView.appendMessage(data.sender, text, 'recv');
    } catch (e) {
      console.error('[Chat] Failed to decrypt incoming message:', e);
    }
  }
}
