/**
 * AuthView — manages the login/register form and auth ↔ chat screen transitions.
 * DOM only — no business logic, no API calls.
 */
class AuthView {
  constructor() {
    this.authContainer = document.getElementById('auth-container');
    this.chatContainer = document.getElementById('chat-container');
    this.usernameInput = document.getElementById('username');
    this.passwordInput = document.getElementById('password');
    this.loginBtn      = document.getElementById('login-btn');
    this.registerBtn   = document.getElementById('register-btn');
    this.errorEl       = document.getElementById('auth-error');
  }

  /** @returns {{ username: string, password: string }} */
  getCredentials() {
    return {
      username: this.usernameInput.value.trim(),
      password: this.passwordInput.value.trim()
    };
  }

  showError(msg) {
    this.errorEl.textContent  = msg;
    this.errorEl.style.color  = '';
    this.errorEl.classList.remove('hidden');
  }

  showSuccess(msg) {
    this.errorEl.textContent  = msg;
    this.errorEl.style.color  = 'var(--primary-color)';
    this.errorEl.classList.remove('hidden');
  }

  hideError() {
    this.errorEl.classList.add('hidden');
  }

  /** Transition to the chat screen. */
  showChat() {
    this.authContainer.classList.add('hidden');
    this.chatContainer.classList.remove('hidden');
  }

  /** Transition back to the auth screen. */
  showAuth() {
    this.authContainer.classList.remove('hidden');
    this.chatContainer.classList.add('hidden');
  }
}
