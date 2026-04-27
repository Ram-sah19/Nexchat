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
    this.voiceCallBtn   = document.getElementById('voice-call-btn');
    this.videoCallBtn   = document.getElementById('video-call-btn');
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

    // Show call buttons only when a friend is selected
    if (username) {
      this.voiceCallBtn && this.voiceCallBtn.classList.remove('hidden');
      this.videoCallBtn && this.videoCallBtn.classList.remove('hidden');
    } else {
      this.voiceCallBtn && this.voiceCallBtn.classList.add('hidden');
      this.videoCallBtn && this.videoCallBtn.classList.add('hidden');
    }
  }

  /** Enable or disable the input field and send button. */
  setInputEnabled(enabled) {
    this.messageInput.disabled = !enabled;
    this.sendBtn.disabled      = !enabled;
    if (enabled) this.messageInput.focus();
  }

  getMessageText() { return this.messageInput.value.trim(); }
  clearInput()     { this.messageInput.value = ''; }

  /**
   * Renders a WhatsApp-style call log entry inline in the message list.
   * @param {{ caller, callee, type, status, duration, startedAt }} record
   * @param {string} myUsername
   */
  appendCallRecord(record, myUsername) {
    const isOutgoing = record.caller === myUsername;
    const isMissed   = record.status === 'missed' && !isOutgoing;

    const wrapper = document.createElement('div');
    wrapper.className = 'call-record-bubble';

    // Icon section: call type + direction arrow
    const iconEl = document.createElement('div');
    iconEl.className = `call-record-icon${isMissed ? ' missed' : ''}`;
    const typeIcon  = record.type === 'video' ? 'ph-video-camera' : 'ph-phone';
    const arrowIcon = isOutgoing ? 'ph-arrow-up-right' : 'ph-arrow-down-left';
    iconEl.innerHTML =
      `<i class="ph-fill ${typeIcon}"></i>` +
      `<i class="ph-fill ${arrowIcon} call-dir-arrow"></i>`;

    // Text section
    const info = document.createElement('div');
    info.className = 'call-record-info';

    const callTypeLabel = record.type === 'video' ? 'Video call' : 'Voice call';
    const dirLabel      = isOutgoing ? 'Outgoing' : (isMissed ? 'Missed' : 'Incoming');
    const titleText     = `${dirLabel} ${callTypeLabel}`;

    let metaText = this._formatCallTime(record.startedAt);
    if (record.status === 'completed' && record.duration > 0) {
      metaText += ' · ' + this._formatDuration(record.duration);
    }

    info.innerHTML =
      `<span class="call-record-title${isMissed ? ' missed' : ''}">${titleText}</span>` +
      `<span class="call-record-meta">${metaText}</span>`;

    wrapper.appendChild(iconEl);
    wrapper.appendChild(info);
    this.messageList.appendChild(wrapper);
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  _formatDuration(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m === 0 ? `${s}s` : `${m}:${String(s).padStart(2, '0')}`;
  }

  _formatCallTime(ts) {
    const d      = new Date(ts);
    const now    = new Date();
    const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayMs  = 86400000;
    const diff   = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / dayMs);
    const time   = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff === 0) return `Today, ${time}`;
    if (diff === 1) return `Yesterday, ${time}`;
    if (diff < 7)  return `${d.toLocaleDateString([], { weekday: 'long' })}, ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
  }
}

