// app.js
const REST_URL = "http://localhost:5000";
const WS_URL   = "ws://localhost:5001";

let socket = null;
let currentUsername = null;
let token = null;

let localKeyPair = null;
let exportedPublicKey = null;

let activeChatUser = null;
const sharedKeys = {};

// ─── Friend System State ──────────────────────────────────────────────────────
let myFriends        = [];   // accepted friends (usernames)
let pendingSent      = [];   // usernames I sent requests to (still pending)
let pendingReceived  = [];   // [{sender}] requests others sent to me (still pending)
let allRegisteredUsers = []; // all users from DB (for "All Users" panel)
let onlineUserSet    = new Set(); // currently connected users (for status dots)
let isLoggedIn       = false;    // guards the polling interval

// ─── Request-Response Mapper for native WebSockets ───────────────────────────
let reqCounter = 0;
const pendingRequests = new Map();

// ─── DOM Elements — Auth ──────────────────────────────────────────────────────
const authContainer      = document.getElementById("auth-container");
const chatContainer      = document.getElementById("chat-container");
const usernameInput      = document.getElementById("username");
const passwordInput      = document.getElementById("password");
const loginBtn           = document.getElementById("login-btn");
const registerBtn        = document.getElementById("register-btn");
const authError          = document.getElementById("auth-error");

// ─── DOM Elements — Chat Layout ───────────────────────────────────────────────
const currentUsernameSpan    = document.getElementById("current-username");
const logoutBtn              = document.getElementById("logout-btn");
const chatWithHeader         = document.getElementById("chat-with-header");
const messageList            = document.getElementById("message-list");
const messageInput           = document.getElementById("message-input");
const sendBtn                = document.getElementById("send-btn");

// ─── DOM Elements — Friend System ─────────────────────────────────────────────
const allUsersListEl         = document.getElementById("all-users-list");
const friendsListEl          = document.getElementById("friends-list");
const friendRequestsPanelEl  = document.getElementById("friend-requests-panel");

// =============================================================================
// CRYPTO INIT
// =============================================================================
async function initCrypto(password, serverPublicKey = null, serverEncryptedPrivateKey = null) {
  const storedJwkPrivate = localStorage.getItem(`chat_private_key_${currentUsername}`);
  const storedJwkPublic  = localStorage.getItem(`chat_public_key_${currentUsername}`);

  if (storedJwkPrivate && storedJwkPublic) {
    // Restore from localStorage (same browser)
    const pub  = JSON.parse(storedJwkPublic);
    const priv = JSON.parse(storedJwkPrivate);
    localKeyPair = {
      publicKey:  await importPublicKey(pub),
      privateKey: await crypto.subtle.importKey("jwk", priv, ecdhParams, true, ["deriveKey", "deriveBits"])
    };
    exportedPublicKey = pub;
  } else if (serverEncryptedPrivateKey && serverPublicKey) {
    // Restore from server-stored encrypted private key (different browser/device)
    const privJwk = await decryptPrivateKey(serverEncryptedPrivateKey, password, currentUsername);
    localKeyPair = {
      publicKey:  await importPublicKey(serverPublicKey),
      privateKey: await crypto.subtle.importKey("jwk", privJwk, ecdhParams, true, ["deriveKey", "deriveBits"])
    };
    exportedPublicKey = serverPublicKey;
    localStorage.setItem(`chat_private_key_${currentUsername}`, JSON.stringify(privJwk));
    localStorage.setItem(`chat_public_key_${currentUsername}`, JSON.stringify(serverPublicKey));
  } else {
    // First time: generate a fresh key pair
    localKeyPair = await generateKeyPair();
    const exportedPriv = await crypto.subtle.exportKey("jwk", localKeyPair.privateKey);
    exportedPublicKey  = await exportPublicKey(localKeyPair.publicKey);
    localStorage.setItem(`chat_private_key_${currentUsername}`, JSON.stringify(exportedPriv));
    localStorage.setItem(`chat_public_key_${currentUsername}`, JSON.stringify(exportedPublicKey));
  }
}

// =============================================================================
// AUTH
// =============================================================================
async function authCall(endpoint, username, password) {
  try {
    const res  = await fetch(`${REST_URL}/auth${endpoint}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  } catch (err) {
    showError(err.message);
    throw err;
  }
}

async function authCallWithKeys(endpoint, username, password, publicKey, encryptedPrivateKey) {
  try {
    const res  = await fetch(`${REST_URL}/auth${endpoint}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password, publicKey, encryptedPrivateKey })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  } catch (err) {
    showError(err.message);
    throw err;
  }
}

function showError(msg) {
  authError.textContent = msg;
  authError.classList.remove("hidden");
}
function hideError() {
  authError.classList.add("hidden");
}

loginBtn.addEventListener("click", async () => {
  hideError();
  const u = usernameInput.value.trim();
  const p = passwordInput.value.trim();
  if (!u || !p) return showError("Please enter username and password");

  try {
    const data = await authCall("/login", u, p);
    token = data.token;
    currentUsername = data.username;

    await initCrypto(p, data.publicKey || null, data.encryptedPrivateKey || null);
    await loadFriendStatus(); // load friends before connecting socket

    connectSocket();
    isLoggedIn = true;

    authContainer.classList.add("hidden");
    chatContainer.classList.remove("hidden");
    currentUsernameSpan.textContent = currentUsername;
  } catch(e) {}
});

registerBtn.addEventListener("click", async () => {
  hideError();
  const u = usernameInput.value.trim();
  const p = passwordInput.value.trim();
  if (!u || !p) return showError("Please enter username and password");

  try {
    const keyPair       = await generateKeyPair();
    const pubJwk        = await exportPublicKey(keyPair.publicKey);
    const privJwk       = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const encryptedPriv = await encryptPrivateKey(privJwk, p, u);

    await authCallWithKeys("/register", u, p, pubJwk, encryptedPriv);
    showError("Registration successful. Please login.");
    authError.style.color = "var(--primary-color)";
  } catch(e) {}
});

logoutBtn.addEventListener("click", () => {
  if (socket) socket.close();
  isLoggedIn = false;
  myFriends = []; pendingSent = []; pendingReceived = [];
  allRegisteredUsers = []; onlineUserSet.clear();
  location.reload();
});

// =============================================================================
// FRIEND SYSTEM — API CALLS
// =============================================================================
async function loadFriendStatus() {
  try {
    const res  = await fetch(`${REST_URL}/friends/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    myFriends       = data.friends          || [];
    pendingSent     = data.pending_sent     || [];
    pendingReceived = data.pending_received || [];
    // Re-render all panels so polling updates are reflected
    renderFriendRequests();
    renderFriendsList();
    renderAllUsers(); // <-- critical: sync button states after polling
  } catch(e) {
    console.error("Failed to load friend status:", e);
  }
}

async function sendFriendRequest(receiver) {
  try {
    const res  = await fetch(`${REST_URL}/friends/request`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ receiver })
    });
    const data = await res.json();
    if (res.ok) {
      pendingSent.push(receiver);
      renderAllUsers();
      showToast(`🤝 Friend request sent to ${receiver}!`);
      // Relay live alert to receiver's browser via the WebSocket
      wsSend('friend_request_sent', { to: receiver })
        .catch(err => console.warn('[WS Relay] friend_request_sent failed:', err.message));
    } else {
      showToast(data.error || 'Failed to send request', 'error');
    }
  } catch(e) {
    showToast('Network error', 'error');
  }
}

async function acceptFriendRequest(sender) {
  try {
    const res = await fetch(`${REST_URL}/friends/accept`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ sender })
    });
    if (res.ok) {
      // Remove from pending immediately so the panel clears
      pendingReceived = pendingReceived.filter(r => r.sender !== sender);
      renderFriendRequests();
      renderAllUsers();
      // Relay to Java → Java fires `friendship_activated` to BOTH Alice and Bob
      // Both UIs will add each other to "My Friends" via the WS event handler below
      wsSend('friend_request_accepted', { to: sender })
        .catch(err => console.warn('[WS Relay] friend_request_accepted failed:', err.message));
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to accept', 'error');
    }
  } catch(e) {
    showToast('Network error', 'error');
  }
}

async function rejectFriendRequest(sender) {
  try {
    const res = await fetch(`${REST_URL}/friends/reject`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ sender })
    });
    if (res.ok) {
      pendingReceived = pendingReceived.filter(r => r.sender !== sender);
      renderFriendRequests();
      renderAllUsers();
      showToast(`Request from ${sender} declined.`);
    }
  } catch(e) {
    showToast('Network error', 'error');
  }
}

async function unfriend(target) {
  try {
    const res = await fetch(`${REST_URL}/friends/remove`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ target })
    });
    if (res.ok) {
      myFriends = myFriends.filter(u => u !== target);
      // Close chat if we were chatting with this person
      if (activeChatUser === target) {
        messageList.innerHTML = '';
        chatWithHeader.textContent = 'Select a friend to chat';
        messageInput.disabled = true;
        sendBtn.disabled = true;
        activeChatUser = null;
      }
      renderAllUsers();
      renderFriendsList();
      showToast(`Unfriended ${target}.`);
      // Tell the other person's browser live via WebSocket relay
      wsSend('friend_removed_notify', { to: target })
        .catch(err => console.warn('[WS Relay] friend_removed_notify failed:', err.message));
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to unfriend', 'error');
    }
  } catch(e) {
    showToast('Network error', 'error');
  }
}

// =============================================================================
// RENDER FUNCTIONS
// =============================================================================
function renderAllUsers() {
  allUsersListEl.innerHTML = '';
  const others = allRegisteredUsers.filter(u => u !== currentUsername);

  if (others.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No other users yet';
    allUsersListEl.appendChild(empty);
    return;
  }

  others.forEach(u => {
    const li = document.createElement('li');
    li.className = 'user-item';

    // Left side: status dot + name
    const left = document.createElement('div');
    left.className = 'user-item-left';

    const dot = document.createElement('span');
    dot.className = `status-dot ${onlineUserSet.has(u) ? 'online' : 'offline'}`;

    const name = document.createElement('span');
    name.className = 'user-item-name';
    name.textContent = u;

    left.appendChild(dot);
    left.appendChild(name);

    // Right side: action buttons based on relationship state
    const btnArea = document.createElement('div');
    btnArea.className = 'user-btn-area';

    if (myFriends.includes(u)) {
      const badge = document.createElement('span');
      badge.className = 'friends-badge';
      badge.innerHTML = `<i class="ph-fill ph-check-circle"></i> Friends`;

      const unfriendBtn = document.createElement('button');
      unfriendBtn.className = 'unfriend-btn';
      unfriendBtn.title = `Unfriend ${u}`;
      unfriendBtn.innerHTML = `<i class="ph-bold ph-user-minus"></i>`;
      unfriendBtn.onclick = e => { e.stopPropagation(); unfriend(u); };

      btnArea.appendChild(badge);
      btnArea.appendChild(unfriendBtn);

    } else if (pendingSent.includes(u)) {
      const btn = document.createElement('button');
      btn.className = 'pending-btn';
      btn.textContent = 'Pending…';
      btn.disabled = true;
      btnArea.appendChild(btn);

    } else if (pendingReceived.some(r => r.sender === u)) {
      // They sent a request to me — show Accept + Decline
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'accept-btn-sm';
      acceptBtn.textContent = 'Accept';
      acceptBtn.onclick = e => { e.stopPropagation(); acceptFriendRequest(u); };

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'reject-btn-sm';
      rejectBtn.innerHTML = `<i class="ph-bold ph-x"></i>`;
      rejectBtn.onclick = e => { e.stopPropagation(); rejectFriendRequest(u); };

      btnArea.appendChild(acceptBtn);
      btnArea.appendChild(rejectBtn);

    } else {
      const btn = document.createElement('button');
      btn.className = 'add-friend-btn';
      btn.innerHTML = `<i class="ph-bold ph-user-plus"></i> Add`;
      btn.onclick = e => { e.stopPropagation(); sendFriendRequest(u); };
      btnArea.appendChild(btn);
    }

    li.appendChild(left);
    li.appendChild(btnArea);
    allUsersListEl.appendChild(li);
  });
}

function renderFriendsList() {
  friendsListEl.innerHTML = '';
  const friendsToShow = myFriends.filter(u => u !== currentUsername);

  if (friendsToShow.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No friends yet — add someone below!';
    friendsListEl.appendChild(empty);
    return;
  }

  friendsToShow.forEach(u => {
    const li = document.createElement('li');
    li.className = 'friend-item';
    if (u === activeChatUser) li.classList.add('active');

    const dot = document.createElement('span');
    dot.className = `status-dot ${onlineUserSet.has(u) ? 'online' : 'offline'}`;

    const name = document.createElement('span');
    name.textContent = u;

    li.appendChild(dot);
    li.appendChild(name);
    li.onclick = () => selectUser(u);
    friendsListEl.appendChild(li);
  });
}

function renderFriendRequests() {
  if (pendingReceived.length === 0) {
    friendRequestsPanelEl.classList.add('hidden');
    return;
  }
  friendRequestsPanelEl.classList.remove('hidden');
  friendRequestsPanelEl.innerHTML = `
    <div class="requests-header">
      <i class="ph-fill ph-bell-ringing"></i>
      <span>Friend Requests</span>
      <span class="requests-badge">${pendingReceived.length}</span>
    </div>
  `;
  pendingReceived.forEach(req => {
    const item = document.createElement('div');
    item.className = 'request-item';
    item.innerHTML = `
      <span class="request-sender">${req.sender}</span>
      <div class="request-actions">
        <button class="accept-btn" onclick="acceptFriendRequest('${req.sender}')">Accept</button>
        <button class="reject-btn" onclick="rejectFriendRequest('${req.sender}')">Decline</button>
      </div>
    `;
    friendRequestsPanelEl.appendChild(item);
  });
}

// =============================================================================
// TOAST NOTIFICATION
// =============================================================================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Double rAF to ensure the element is rendered before the transition fires
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-show')));

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// =============================================================================
// WEBSOCKET
// =============================================================================
function wsSend(type, payload = {}, expectsResponse = false) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Socket not connected"));
  }

  const msg = { type, payload };

  if (expectsResponse) {
    const reqId = (++reqCounter).toString();
    msg.reqId = reqId;
    const promise = new Promise((resolve, reject) => {
      pendingRequests.set(reqId, { resolve, reject });
      setTimeout(() => {
        if (pendingRequests.has(reqId)) {
          pendingRequests.get(reqId).reject(new Error("Request timeout"));
          pendingRequests.delete(reqId);
        }
      }, 5000);
    });
    socket.send(JSON.stringify(msg));
    return promise;
  } else {
    socket.send(JSON.stringify(msg));
    return Promise.resolve();
  }
}

function connectSocket() {
  socket = new WebSocket(`${WS_URL}/?token=${token}`);

  socket.onopen = () => {
    wsSend("join", { publicKey: exportedPublicKey });
  };

  socket.onerror = err => {
    alert("Connection error. Ensure the Java server is running.");
    console.error("WS error:", err);
  };

  socket.onclose = () => console.log("Disconnected from server");

  socket.onmessage = async event => {
    try {
      const data = JSON.parse(event.data);
      const { type, payload, reqId } = data;

      // Resolve pending request-response callbacks first
      if (reqId && pendingRequests.has(reqId)) {
        pendingRequests.get(reqId).resolve(payload);
        pendingRequests.delete(reqId);
        return;
      }

      switch(type) {

        // ── All registered users (for discovery panel) ──
        case "user_list":
          allRegisteredUsers = payload;
          renderAllUsers();
          renderFriendsList();
          break;

        // ── Currently online users (for status dots) ──
        case "online_users":
          onlineUserSet = new Set(payload);
          renderAllUsers();
          renderFriendsList();
          break;

        // ── Incoming chat message ──
        case "receive_message":
          await handleIncomingMessage(payload);
          break;

        // ── Real-time: Bob receives a live ping when Alice adds him ──
        case "new_friend_request":
          if (!pendingReceived.some(r => r.sender === payload.from)) {
            pendingReceived.push({ sender: payload.from });
          }
          showToast(`🔔 New friend request from ${payload.from}!`);
          renderAllUsers();
          renderFriendRequests();
          break;

        // ── Real-time: Java fires this to BOTH users when a request is accepted ──
        // payload.with = the other person's username
        case "friendship_activated":
          if (!myFriends.includes(payload.with)) myFriends.push(payload.with);
          pendingSent     = pendingSent.filter(u => u !== payload.with);
          pendingReceived = pendingReceived.filter(r => r.sender !== payload.with);
          showToast(`✅ You are now friends with ${payload.with}!`);
          renderAllUsers();
          renderFriendsList();
          renderFriendRequests();
          break;

        // ── Real-time unfriend alert ──
        case "friend_removed":
          myFriends = myFriends.filter(u => u !== payload.from);
          showToast(`❌ ${payload.from} removed you as a friend.`);
          renderAllUsers();
          renderFriendsList();
          if (activeChatUser === payload.from) {
            messageList.innerHTML = '';
            chatWithHeader.textContent = 'Select a friend to chat';
            messageInput.disabled = true;
            sendBtn.disabled = true;
            activeChatUser = null;
          }
          break;

        // ── Java security guard error (e.g. non-friend message attempt) ──
        case "error":
          showToast(`⚠️ ${payload.message}`, 'error');
          break;
      }
    } catch(e) {
      console.error("Error parsing socket message:", e);
    }
  };
}

// =============================================================================
// INCOMING MESSAGE HANDLER
// =============================================================================
async function handleIncomingMessage(data) {
  try {
    let sharedKey = sharedKeys[data.sender];
    if (!sharedKey) {
      sharedKey = await fetchPublicKeyAndDerive(data.sender);
    }
    const decryptedText = await decryptMessage(sharedKey, data.ciphertext, data.iv);

    if (activeChatUser !== data.sender) {
      selectUser(data.sender);
    }
    appendMessage(data.sender, decryptedText, "recv");
  } catch(err) {
    console.error("Failed to decrypt incoming message:", err);
  }
}

async function fetchPublicKeyAndDerive(targetUsername) {
  const response = await wsSend("request_public_key", { receiver: targetUsername }, true);

  if (response.error) throw new Error(response.error);
  if (!response.publicKey) throw new Error("Empty response for public key");

  const otherPubKey = await importPublicKey(response.publicKey);
  const sharedKey   = await deriveSharedKey(localKeyPair.privateKey, otherPubKey);
  sharedKeys[targetUsername] = sharedKey;
  return sharedKey;
}

// =============================================================================
// SELECT USER / LOAD CHAT
// =============================================================================
async function selectUser(username) {
  activeChatUser = username;
  chatWithHeader.textContent = `Chat with ${username}`;
  messageList.innerHTML = "";
  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();
  renderFriendsList(); // update active highlight

  if (!sharedKeys[username]) {
    try {
      await fetchPublicKeyAndDerive(username);
    } catch(e) {
      console.warn(`Could not fetch key for ${username}. They might be offline.`);
    }
  }

  if (sharedKeys[username]) {
    try {
      const messages = await wsSend("fetch_history", { withUser: username }, true);
      for (const msg of messages) {
        try {
          const decryptedText = await decryptMessage(sharedKeys[username], msg.ciphertext, msg.iv);
          appendMessage(
            msg.sender === currentUsername ? "You" : msg.sender,
            decryptedText,
            msg.sender === currentUsername ? "sent" : "recv"
          );
        } catch(err) {
          console.error("Failed to decrypt history message:", {
            error: err.name + ": " + err.message,
            sender: msg.sender,
            ivLength: Array.isArray(msg.iv) ? msg.iv.length : typeof msg.iv,
            ciphertextLength: Array.isArray(msg.ciphertext) ? msg.ciphertext.length : typeof msg.ciphertext,
            hint: err.name === "OperationError"
              ? "Key mismatch: this message was encrypted with a different ECDH keypair than the one currently in localStorage."
              : "Check IV/ciphertext format from server."
          });
          appendMessage(
            msg.sender === currentUsername ? "You" : msg.sender,
            "[Message could not be decrypted]",
            msg.sender === currentUsername ? "sent" : "recv"
          );
        }
      }
    } catch(err) {
      console.error("Failed to fetch history:", err);
    }
  }
}

// =============================================================================
// SEND MESSAGE
// =============================================================================
sendBtn.addEventListener("click", async () => {
  const msg = messageInput.value.trim();
  if (!msg || !activeChatUser) return;

  try {
    let sharedKey = sharedKeys[activeChatUser];
    if (!sharedKey) {
      sharedKey = await fetchPublicKeyAndDerive(activeChatUser);
    }

    const { ciphertext, iv } = await encryptMessage(sharedKey, msg);

    wsSend("send_message", { receiver: activeChatUser, ciphertext, iv });

    appendMessage("You", msg, "sent");
    messageInput.value = "";
  } catch(e) {
    showToast("Could not encrypt/send: " + e.message, 'error');
  }
});

messageInput.addEventListener("keypress", e => {
  if (e.key === "Enter") sendBtn.click();
});

// =============================================================================
// APPEND MESSAGE TO UI
// =============================================================================
function appendMessage(sender, text, type) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg-wrapper ${type}`;

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = text;

  const info = document.createElement("div");
  info.className = "msg-info";
  info.textContent = sender;

  wrapper.appendChild(bubble);
  wrapper.appendChild(info);
  messageList.appendChild(wrapper);
  messageList.scrollTop = messageList.scrollHeight;
}

// =============================================================================
// POLLING SAFETY NET — "Manual Sync" fallback
// If the Java WebSocket relay drops a message (e.g., the target was connecting
// at the same moment), the UI catches up automatically within 5 seconds.
// This is the "hackathon safety net" — zero refresh needed.
// =============================================================================
setInterval(async () => {
  if (!isLoggedIn) return;

  try {
    const res  = await fetch(`${REST_URL}/friends/status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();

    // Only re-render if something actually changed
    const newFriends  = data.friends          || [];
    const newSent     = data.pending_sent     || [];
    const newReceived = data.pending_received || [];

    const friendsChanged  = JSON.stringify(newFriends.sort())  !== JSON.stringify([...myFriends].sort());
    const sentChanged     = JSON.stringify(newSent.sort())     !== JSON.stringify([...pendingSent].sort());
    const receivedChanged = JSON.stringify(newReceived.map(r => r.sender).sort()) !==
                            JSON.stringify(pendingReceived.map(r => r.sender).sort());

    if (friendsChanged || sentChanged || receivedChanged) {
      console.log('[Sync] State drift detected — syncing from DB...');
      myFriends       = newFriends;
      pendingSent     = newSent;
      pendingReceived = newReceived;
      renderFriendRequests();
      renderFriendsList();
      renderAllUsers();
    }
  } catch(e) {
    // Network error during polling — silently ignore, will retry next interval
  }
}, 5000);
