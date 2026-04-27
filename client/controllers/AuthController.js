/**
 * AuthController — orchestrates login, register, and logout flows.
 * Also owns the sidebar collapse button binding and the polling lifecycle.
 *
 * This is the "main conductor" — it coordinates all other controllers
 * and is the first entry point for user interaction.
 */
class AuthController {
  /**
   * @param {AuthModel}    authModel
   * @param {UserModel}    userModel
   * @param {ChatModel}    chatModel
   * @param {AuthView}     authView
   * @param {SidebarView}  sidebarView
   * @param {ChatView}     chatView
   * @param {ToastView}    toastView
   * @param {string}       REST_URL
   */
  constructor(authModel, userModel, chatModel, authView, sidebarView, chatView, toastView, REST_URL) {
    this.authModel   = authModel;
    this.userModel   = userModel;
    this.chatModel   = chatModel;
    this.authView    = authView;
    this.sidebarView = sidebarView;
    this.chatView    = chatView;
    this.toastView   = toastView;
    this.REST_URL    = REST_URL;

    this._pollingId  = null;

    // Filled by wire()
    this.socketCtrl = null;
    this.chatCtrl   = null;
    this.friendCtrl = null;

    this._bindEvents();
  }

  /** Inject circular dependencies after all controllers are created. */
  wire(socketCtrl, chatCtrl, friendCtrl) {
    this.socketCtrl = socketCtrl;
    this.chatCtrl   = chatCtrl;
    this.friendCtrl = friendCtrl;
  }

  // ─── Event Binding ────────────────────────────────────────────────────────────

  _bindEvents() {
    this.authView.loginBtn.addEventListener('click',    () => this.handleLogin());
    this.authView.registerBtn.addEventListener('click', () => this.handleRegister());

    const logoutBtn   = this.sidebarView.logoutBtn;
    const collapseBtn = this.sidebarView.collapseBtn;

    if (logoutBtn)   logoutBtn.addEventListener('click',   () => this.handleLogout());
    if (collapseBtn) collapseBtn.addEventListener('click', () => this.sidebarView.toggleCollapse());
  }

  // ─── Login ───────────────────────────────────────────────────────────────────

  async handleLogin() {
    this.authView.hideError();
    const { username, password } = this.authView.getCredentials();

    if (!username || !password) {
      return this.authView.showError('Please enter username and password');
    }

    try {
      const res  = await fetch(`${this.REST_URL}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      // 1. Store auth state
      this.authModel.setAuth(data.token, data.username);

      // 2. Restore or generate crypto keys
      const isNewKey = await this.chatCtrl.initCrypto(
        password,
        data.publicKey          || null,
        data.encryptedPrivateKey || null
      );

      // 3. Load friend state from DB
      await this.friendCtrl.loadFriendStatus();

      // 4. Connect WebSocket (join event fires on open)
      //    Pass isNewKey so Java only updates the stored public key when necessary.
      this.socketCtrl.connect(data.token, this.chatModel.exportedPublicKey, isNewKey);

      // 5. Transition UI
      this.authView.showChat();
      this.sidebarView.setUsername(data.username);

      // 6. Start polling safety net
      this._pollingId = this.friendCtrl.startPolling();

    } catch (e) {
      this.authView.showError(e.message);
    }
  }

  // ─── Register ────────────────────────────────────────────────────────────────

  async handleRegister() {
    this.authView.hideError();
    const { username, password } = this.authView.getCredentials();

    if (!username || !password) {
      return this.authView.showError('Please enter username and password');
    }

    try {
      const keyPair       = await generateKeyPair();
      const pubJwk        = await exportPublicKey(keyPair.publicKey);
      const privJwk       = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
      const encryptedPriv = await encryptPrivateKey(privJwk, password, username);

      const res  = await fetch(`${this.REST_URL}/auth/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          username,
          password,
          publicKey:            pubJwk,
          encryptedPrivateKey:  encryptedPriv
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      this.authView.showSuccess('Registration successful. Please log in.');
    } catch (e) {
      this.authView.showError(e.message);
    }
  }

  // ─── Logout ──────────────────────────────────────────────────────────────────

  handleLogout() {
    this.socketCtrl.disconnect();
    clearInterval(this._pollingId);
    this.authModel.clearAuth();
    this.userModel.reset();
    this.chatModel.reset();
    location.reload();
  }
}
