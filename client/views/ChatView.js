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
  /**
   * Appends a message bubble.
   * @param {string}         sender
   * @param {string}         text
   * @param {'sent'|'recv'}  type
   * @param {object}         [opts]  { to, status } — for sent ticks
   */
  appendMessage(sender, text, type, opts = {}) {
    const lastMsg     = this.messageList.lastElementChild;
    const isContinued = lastMsg && lastMsg.dataset.sender === sender
                        && lastMsg.classList.contains('msg-wrapper');

    const wrapper = document.createElement('div');
    wrapper.className      = `msg-wrapper ${type}`;
    wrapper.dataset.sender = sender;
    if (isContinued) wrapper.classList.add('msg-continued');

    // Sender label — only on first bubble of a received group
    if (!isContinued && type === 'recv') {
      const info = document.createElement('div');
      info.className   = 'msg-info';
      info.textContent = sender;
      wrapper.appendChild(info);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    const textSpan = document.createElement('span');
    textSpan.className   = 'msg-text';
    textSpan.textContent = text;
    bubble.appendChild(textSpan);

    // Meta row: time + tick
    const meta = document.createElement('div');
    meta.className = 'msg-meta';

    const timeEl = document.createElement('span');
    timeEl.className   = 'msg-time';
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeEl);

    // Tick for sent messages
    if (type === 'sent' && opts.to) {
      const tick = document.createElement('span');
      tick.className      = 'msg-tick';
      tick.dataset.to     = opts.to;
      const status        = opts.status || 'sent';
      tick.dataset.status = status;
      tick.innerHTML      = this._tickIcon(status);
      meta.appendChild(tick);
    }

    bubble.appendChild(meta);
    wrapper.appendChild(bubble);
    this.messageList.appendChild(wrapper);
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  /**
   * Upgrade tick status for all sent messages to `peerUsername`.
   * Status order: sent < delivered < seen
   */
  updateTicks(peerUsername, status) {
    const order = { sent: 0, delivered: 1, seen: 2 };
    this.messageList
      .querySelectorAll(`.msg-tick[data-to="${peerUsername}"]`)
      .forEach(tick => {
        if (order[status] > order[tick.dataset.status || 'sent']) {
          tick.dataset.status = status;
          tick.innerHTML      = this._tickIcon(status);
        }
      });
  }

  _tickIcon(status) {
    if (status === 'seen')      return '<i class="ph-fill ph-checks msg-tick-seen"></i>';
    if (status === 'delivered') return '<i class="ph-fill ph-checks"></i>';
    return '<i class="ph-fill ph-check"></i>';   // sent
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

  /** Show the "X is typing…" indicator. */
  showTyping(username) {
    const el = document.getElementById('typing-indicator');
    if (!el) return;
    el.innerHTML =
      `<span class="typing-dots"><span></span><span></span><span></span></span>` +
      `<span style="margin-left:8px;">${username} is typing…</span>`;
    el.classList.remove('hidden');
  }

  /** Hide the typing indicator. */
  hideTyping() {
    const el = document.getElementById('typing-indicator');
    if (!el) return;
    el.innerHTML = '';
    el.classList.add('hidden');
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

