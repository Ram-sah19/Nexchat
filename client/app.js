// app.js
const REST_URL = "http://localhost:5000";
const WS_URL = "ws://localhost:5001";

let socket = null;
let currentUsername = null;
let token = null;

let localKeyPair = null;
let exportedPublicKey = null;

let activeChatUser = null;
const sharedKeys = {};
let onlineUsers = [];

// Request-Response Mapper for native websockets
let reqCounter = 0;
const pendingRequests = new Map();

// DOM Elements
const authContainer = document.getElementById("auth-container");
const chatContainer = document.getElementById("chat-container");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const registerBtn = document.getElementById("register-btn");
const authError = document.getElementById("auth-error");

const currentUsernameSpan = document.getElementById("current-username");
const logoutBtn = document.getElementById("logout-btn");
const userListEl = document.getElementById("user-list");
const chatWithHeader = document.getElementById("chat-with-header");
const messageList = document.getElementById("message-list");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

async function initCrypto() {
  const storedJwkPrivate = localStorage.getItem(`chat_private_key_${currentUsername}`);
  const storedJwkPublic = localStorage.getItem(`chat_public_key_${currentUsername}`);

  if (storedJwkPrivate && storedJwkPublic) {
    const pub = JSON.parse(storedJwkPublic);
    const priv = JSON.parse(storedJwkPrivate);
    
    localKeyPair = {
      publicKey: await importPublicKey(pub),
      privateKey: await crypto.subtle.importKey("jwk", priv, ecdhParams, true, ["deriveKey", "deriveBits"])
    };
    exportedPublicKey = pub;
  } else {
    localKeyPair = await generateKeyPair();
    const exportedPriv = await crypto.subtle.exportKey("jwk", localKeyPair.privateKey);
    exportedPublicKey = await exportPublicKey(localKeyPair.publicKey);
    
    localStorage.setItem(`chat_private_key_${currentUsername}`, JSON.stringify(exportedPriv));
    localStorage.setItem(`chat_public_key_${currentUsername}`, JSON.stringify(exportedPublicKey));
  }
}

async function authCall(endpoint, username, password) {
  try {
    const res = await fetch(`${REST_URL}/auth${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
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
    
    await initCrypto();
    connectSocket();
    
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
    await authCall("/register", u, p);
    showError("Registration successful. Please login.");
    authError.style.color = "var(--primary-color)";
  } catch(e) {}
});

logoutBtn.addEventListener("click", () => {
  if (socket) socket.close();
  location.reload();
});

// Sends a message over WS. If a response is expected, returns a Promise.
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
      }, 5000); // 5 sec timeout
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

  socket.onerror = (err) => {
    alert("Connection error. Ensure Java server is running.");
    console.error("WS error:", err);
  };

  socket.onclose = () => {
    console.log("Disconnected from server");
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      const { type, payload, reqId } = data;

      // Handle Request-Response Callbacks
      if (reqId && pendingRequests.has(reqId)) {
        pendingRequests.get(reqId).resolve(payload);
        pendingRequests.delete(reqId);
        return; // Don't process as a broadcast event if it's a direct response
      }

      switch(type) {
        case "user_list":
          onlineUsers = payload.filter(u => u !== currentUsername);
          renderUserList();
          break;
        case "receive_message":
          await handleIncomingMessage(payload);
          break;
      }
    } catch (e) {
      console.error("Error parsing socket message:", e);
    }
  };
}

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
  
  if (response.error) {
    throw new Error(response.error);
  }
  if (!response.publicKey) {
    throw new Error("Empty response for public key");
  }
  
  const otherPubKey = await importPublicKey(response.publicKey);
  const sharedKey = await deriveSharedKey(localKeyPair.privateKey, otherPubKey);
  sharedKeys[targetUsername] = sharedKey;
  return sharedKey;
}

function renderUserList() {
  userListEl.innerHTML = "";
  onlineUsers.forEach(u => {
    const li = document.createElement("li");
    li.textContent = u;
    if (u === activeChatUser) li.classList.add("active");
    li.onclick = () => selectUser(u);
    userListEl.appendChild(li);
  });
}

async function selectUser(username) {
  activeChatUser = username;
  chatWithHeader.textContent = `Chat with ${username}`;
  messageList.innerHTML = ""; 
  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();
  renderUserList();
  
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
          appendMessage(msg.sender === currentUsername ? "You" : msg.sender, decryptedText, msg.sender === currentUsername ? "sent" : "recv");
        } catch(err) {
          console.error("Failed to decrypt history message:", err);
          appendMessage(msg.sender === currentUsername ? "You" : msg.sender, "[Encrypted Message]", msg.sender === currentUsername ? "sent" : "recv");
        }
      }
    } catch(err) {
      console.error("Failed to fetch history:", err);
    }
  }
}

sendBtn.addEventListener("click", async () => {
  const msg = messageInput.value.trim();
  if (!msg || !activeChatUser) return;
  
  try {
    let sharedKey = sharedKeys[activeChatUser];
    if (!sharedKey) {
      sharedKey = await fetchPublicKeyAndDerive(activeChatUser);
    }
    
    // WebCrypto encryption is untouched!
    const { ciphertext, iv } = await encryptMessage(sharedKey, msg);
    
    wsSend("send_message", {
      receiver: activeChatUser,
      ciphertext,
      iv
    });
    
    appendMessage("You", msg, "sent");
    messageInput.value = "";
  } catch(e) {
    alert("Could not encrypt/send: " + e.message);
  }
});

messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

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
