/**
 * ChatView — manages the chat message list, header, and input area.
 * DOM only — no business logic, no crypto, no API calls.
 */
class ChatView {
  constructor() {
    this.messageList    = document.getElementById('message-list');
    this.messageInput   = document.getElementById('message-input');
    this.sendBtn        = document.getElementById('send-btn');
    this.chatWithHeader = document.getElementById('chat-with-header');
  }

  /**
   * Appends a message bubble with iMessage-style sender grouping.
   * Consecutive messages from the same sender get tighter spacing + joined radius.
   *
   * @param {string}         sender  — display name
   * @param {string}         text    — plaintext content
   * @param {'sent'|'recv'}  type    — alignment + colour
   */
  appendMessage(sender, text, type) {
    const lastMsg     = this.messageList.lastElementChild;
    const isContinued = lastMsg && lastMsg.dataset.sender === sender;

    const wrapper = document.createElement('div');
    wrapper.className    = `msg-wrapper ${type}`;
    wrapper.dataset.sender = sender;
    if (isContinued) wrapper.classList.add('msg-continued');

    // Show sender name only on the first message of a received group
    if (!isContinued && type === 'recv') {
      const info = document.createElement('div');
      info.className   = 'msg-info';
      info.textContent = sender;
      wrapper.appendChild(info);
    }

    const bubble = document.createElement('div');
    bubble.className   = 'msg-bubble';
    bubble.textContent = text;
    wrapper.appendChild(bubble);

    this.messageList.appendChild(wrapper);
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  clearMessages() {
    this.messageList.innerHTML = '';
  }

  /** Update the chat header to show the active conversation partner. */
  setChatUser(username) {
    this.chatWithHeader.textContent = username
      ? `Chat with ${username}`
      : 'Select a friend to chat';
  }

  /** Enable or disable the input field and send button. */
  setInputEnabled(enabled) {
    this.messageInput.disabled = !enabled;
    this.sendBtn.disabled      = !enabled;
    if (enabled) this.messageInput.focus();
  }

  getMessageText() { return this.messageInput.value.trim(); }
  clearInput()     { this.messageInput.value = ''; }
}
