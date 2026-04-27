# 🔐 NexChat — End-to-End Encrypted Chat Application

> A production-ready, fully End-to-End Encrypted (E2EE) real-time chat system built with **Python (Flask)**, **Java (WebSocket)**, and **vanilla JavaScript** — powered by **ECDH + AES-GCM** cryptography via the browser's native WebCrypto API. Features real-time **voice & video calling** (WebRTC), **call history**, **typing indicators**, **unread badges**, **message delivery ticks**, and a complete **friend system** — all following a clean **MVC architecture**.

[![GitHub](https://img.shields.io/badge/GitHub-Nexchat-181717?style=flat-square&logo=github)](https://github.com/Ram-sah19/Nexchat)
[![Python](https://img.shields.io/badge/Python-3.8+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Java](https://img.shields.io/badge/Java-11+-ED8B00?style=flat-square&logo=java)](https://www.java.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-27017-47A248?style=flat-square&logo=mongodb)](https://www.mongodb.com/)
[![WebRTC](https://img.shields.io/badge/WebRTC-P2P_Calls-333333?style=flat-square&logo=webrtc)](https://webrtc.org/)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#️-architecture)
- [Frontend MVC Structure](#-frontend-mvc-structure)
- [WebRTC Calling](#-webrtc-calling)
- [Message Status Ticks](#-message-status-ticks)
- [Friend System](#-friend-system)
- [Cryptographic Algorithms](#-cryptographic-algorithms)
- [Full Message Encryption Flow](#-full-message-encryption-flow)
- [Tech Stack](#️-tech-stack)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
- [Running the App](#-running-the-app)
- [MongoDB Collections](#-mongodb-collections)
- [API Reference](#-api-reference)
- [WebSocket Events](#-websocket-events)
- [Security Design Decisions](#️-security-design-decisions)
- [Known Limitations](#️-known-limitations)

---

## 🌐 Overview

NexChat is a fully E2EE chat application where:

- **No one — not even the server — can read your messages.**
- All encryption and decryption happens **exclusively on the client (browser)**.
- The server only stores and relays **opaque ciphertext** it cannot decode.
- Authentication uses industry-standard **JWT (HMAC-SHA256)** tokens.
- Passwords are stored using **bcrypt** with salting.
- **Users must be friends before they can chat or call** — enforced at both the frontend and Java server level.
- **Live real-time voice & video calls** via WebRTC — peer-to-peer media, Java handles signalling only.
- **Live real-time notifications**: typing indicator, unread badges, message ticks, friend events.
- The client follows a strict **MVC pattern** — state, DOM, and logic are fully separated.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔐 **E2EE Messaging** | ECDH P-256 key exchange + AES-GCM 256-bit encryption in the browser |
| 📞 **Voice Calls** | Real-time P2P audio via WebRTC (STUN negotiation) |
| 📹 **Video Calls** | Real-time P2P video with local PiP + full-screen remote |
| 📋 **Call History** | WhatsApp-style inline call log (Outgoing / Incoming / Missed + duration) |
| ✓✓ **Message Ticks** | Single ✓ sent → Double ✓✓ grey delivered → Double ✓✓ **blue** seen |
| ⌛ **Message Timestamps** | HH:MM shown on every message bubble |
| 💬 **Typing Indicator** | Animated 3-dot bounce in chat + mini dots in sidebar |
| 🔴 **Unread Badge** | Accent-coloured count badge on friend in sidebar |
| 👥 **Friend System** | Add / accept / reject / unfriend with live WS notifications |
| 🌐 **Online Status** | Green/grey dot on every user — updated on connect/disconnect |
| 🔑 **Cross-Device Keys** | Private key encrypted with PBKDF2 and backed up to server |
| 🏗️ **MVC Architecture** | Strict model / view / controller separation (13 files, no framework) |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser — MVC)                         │
│                                                                        │
│  ┌──────────────────────┐       ┌──────────────────────────────────┐  │
│  │  auth + friend REST  │       │  chat + social + call WebSocket  │  │
│  │  (FriendController)  │       │  (SocketController)              │  │
│  └──────────┬───────────┘       └────────────────┬─────────────────┘  │
└─────────────┼────────────────────────────────────┼────────────────────┘
              │ HTTP (REST)                         │ WebSocket (ws://)
              ▼                                     ▼
┌─────────────────────────┐       ┌─────────────────────────────────────┐
│   Python / Flask        │       │   Java WebSocket Server             │
│   (Port 5000)           │       │   (Port 5001)                       │
│                         │       │                                     │
│  /auth/register         │       │  JWT verification on connect        │
│  /auth/login            │       │  E2EE message relay                 │
│  /friends/status        │       │  Friend guard (areFriends check)    │
│  /friends/request       │       │  WebRTC signalling relay            │
│  /friends/accept        │       │  Typing indicator relay             │
│  /friends/reject        │       │  Message delivery/seen relay        │
│  /friends/remove        │       │  Call history recording             │
│  Serves client files    │       │  Social event relay                 │
└──────────────┬──────────┘       └──────────────┬──────────────────────┘
               │                                  │
               └──────────────────────────────────┘
                                  │
               ┌──────────────────▼──────────────────────┐
               │              MongoDB                      │
               │            (Port 27017)                   │
               │  Collections:                             │
               │  • users           (auth + keys)          │
               │  • messages        (encrypted blobs)      │
               │  • friend_requests (social graph)         │
               │  • calls           (call history log)     │
               └───────────────────────────────────────────┘
```

| Layer | Technology | Port | Role |
|-------|-----------|------|------|
| Auth + Friend API | Python / Flask | **5000** | Register, Login, JWT, Friend CRUD |
| Chat + Relay | Java / WebSocket | **5001** | E2EE relay, WebRTC signalling, ticks, typing |
| Database | MongoDB | **27017** | Users, encrypted messages, friendships, calls |
| Client | Vanilla JS / WebCrypto | (served by Flask) | MVC app — Crypto, UI, WS relay |

---

## 📐 Frontend MVC Structure

The entire client is split across **13 files** following strict MVC separation.

```
client/
  index.html                      ← HTML shell (no logic)
  style.css                       ← Warm glassmorphism design system
  crypto.js                       ← Global WebCrypto helpers (ECDH, AES-GCM, PBKDF2)
  app.js                          ← Entry point: instantiate + wire (≈70 lines)

  models/                         ── PURE STATE, no DOM, no fetch, no WebSocket
    AuthModel.js                  ← token, username, isLoggedIn, authHeader getter
    UserModel.js                  ← friends[], pendingSent[], unreadCounts{}, typingUsers set
    ChatModel.js                  ← activeChatUser, sharedKeys{}, ECDH keypair, reqId map

  views/                          ── DOM ONLY, no business logic
    AuthView.js                   ← login/register form, showChat/showAuth transitions
    SidebarView.js                ← renderFriendsList (with badges + typing dots), renderAllUsers
    ChatView.js                   ← appendMessage (with ticks + timestamps), updateTicks, typing
    ToastView.js                  ← show(message, type) with rAF fade animation
    CallView.js                   ← Incoming banner, active call overlay, PiP, controls

  controllers/                    ── ORCHESTRATION: use models + views + APIs
    SocketController.js           ← WebSocket lifecycle, send(), event dispatcher
    FriendController.js           ← 5 REST actions, WS relay, 5s polling safety net
    ChatController.js             ← initCrypto, key exchange, selectUser, sendMessage, ticks
    AuthController.js             ← login, register, logout, sidebar collapse
    CallController.js             ← WebRTC lifecycle: offer/answer/ICE, media, hang-up
```

### Dependency Graph

```
        AuthController
        ┌──────┬──────┬─────────────┐
        ▼      ▼      ▼             │
  SocketCtrl  ChatCtrl  FriendCtrl  │
      │    ◄──────┘   ◄────────────┘
      │                  CallCtrl ◄── wired into SocketCtrl
      │         └── share: AuthModel, UserModel, ChatModel
      │         └── share: AuthView, SidebarView, ChatView, ToastView, CallView
      ▼
  (WebSocket → Java Server)
```

---

## 📞 WebRTC Calling

Voice and video calls are **peer-to-peer** — only signalling messages (offer/answer/ICE) go through the Java server. Media streams directly between browsers.

### Call Signal Flow

```
Caller (Browser A)          Java WS Server           Callee (Browser B)
      │                          │                          │
      │── call_offer ──────────► │ ── call_offer ─────────► │
      │                          │                (banner shows + ring)
      │◄─────────────── call_answer ◄───────────────────────│
      │── call_ice ─────────────►│ ── call_ice ────────────►│
      │◄──────────────────── call_ice ◄─────────────────────│
      │◄══════════════ WebRTC P2P media stream ═════════════│
      │── call_ended ───────────►│ ── call_ended ──────────►│
```

### Call History — MongoDB `calls` Collection

```json
{
  "caller":    "alice",
  "callee":    "bob",
  "type":      "voice",
  "status":    "completed",
  "startedAt": 1714234567890,
  "answeredAt": 1714234572000,
  "endedAt":   1714234692890,
  "duration":  120
}
```

| Status | Meaning |
|--------|---------|
| `ringing`     | Offer sent, callee hasn't answered |
| `in_progress` | Call answered by callee |
| `completed`   | Call ended after being answered (duration recorded) |
| `missed`      | Ended before callee answered |

### Call UI
- **Incoming banner** — slides in from top with ring pulse animation + caller name
- **Active overlay** — dark full-screen with remote video (full) + local PiP (bottom-right)
- **Controls** — Mute 🎙️ / Camera 📷 / End call 📵 (glassmorphic frosted bar)
- **Inline call record** — appears in chat immediately after the call ends (no reload needed)

---

## ✓✓ Message Status Ticks

Every sent message shows a WhatsApp-style tick that upgrades in real time:

| Tick | Colour | Meaning |
|------|--------|---------|
| `✓` single | Grey | **Sent** — message reached the server |
| `✓✓` double | Grey | **Delivered** — recipient's browser received it |
| `✓✓` double | **Blue 🔵** | **Seen** — recipient opened the chat |

### How it works

```
Alice sends msg          → ✓  grey  (single)
Bob receives it online   → Java relays message_delivered → Alice's ✓✓ grey
Bob opens the chat       → Java relays message_seen      → Alice's ✓✓ BLUE (+ pop animation)
```

- History messages load with **double grey** ticks (already delivered).
- Ticks upgrade **without page reload** via WS events.

---

## 🤝 Friend System

### Flow Overview

```
Step 1 — Alice clicks "+ Add" on Bob
  ├─ Frontend → POST /friends/request    (Python saves status: "pending")
  └─ Java relays: new_friend_request → Bob (live notification panel)

Step 2 — Bob clicks "Accept"
  ├─ Frontend → POST /friends/accept     (Python sets status: "accepted")
  └─ Java fires friendship_activated to BOTH simultaneously ✅

Step 3 — Chatting
  └─ Java ChatServer.areFriends() checks MongoDB before every message
       ✅ Friends   → message relayed
       ❌ Not friends → { type: "error" } blocked live

Step 4 — Unfriend
  ├─ Frontend → POST /friends/remove     (Python deletes document)
  └─ Java relays: friend_removed → Bob (UI closes chat instantly) ✅

Safety Net: Every 5 seconds FriendController polls /friends/status
  └─ If state drifted (missed WS event), auto-syncs and re-renders silently
```

### MongoDB Schema — `friend_requests`

```json
{
  "_id":      "ObjectId(...)",
  "sender":   "alice",
  "receiver": "bob",
  "status":   "pending"
}
```
Status transitions: `pending` → `accepted` | `rejected`
On unfriend: document is **deleted** (not soft-deleted).

---

## 🔐 Cryptographic Algorithms

### 1. ECDH P-256 — Key Exchange
```js
const ecdhParams = { name: "ECDH", namedCurve: "P-256" };
const keyPair = await crypto.subtle.generateKey(ecdhParams, true, ["deriveKey", "deriveBits"]);
```
- Shared secret: `Alice_priv + Bob_pub = Bob_priv + Alice_pub` → becomes the AES-GCM key.

### 2. AES-GCM 256-bit — Message Encryption
```js
const iv         = crypto.getRandomValues(new Uint8Array(12)); // fresh per message
const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, encoded);
```
- **Fresh 12-byte random IV per message** — prevents IV-reuse attacks.

### 3. HMAC-SHA256 — JWT Auth
```python
token = jwt.encode({ 'username': ..., 'exp': now + 10h }, JWT_SECRET, algorithm='HS256')
```

### 4. bcrypt — Password Hashing
```python
hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
```

### 5. PBKDF2 + AES-GCM — Private Key Backup (Cross-Device)
```js
const aesKey = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt: enc.encode(username + "_salt"), iterations: 100000, hash: "SHA-256" },
  passwordKey,
  { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
);
```
- Private key encrypted **client-side** before upload — server cannot decrypt it.

---

## 🔄 Full Message Encryption Flow

```
[Alice — Browser]               [Java Server]              [Bob — Browser]
       │                              │                            │
       │── login (REST) ────────────►│                            │
       │◄─ JWT + encrypted priv key ─│                            │
       │── ChatController.initCrypto()                            │
       │   restore ECDH keys from localStorage / server           │
       │                              │                            │
       │── WS connect ?token=JWT ───►│                            │
       │── join { publicKey } ──────►│── store Alice_pub in DB   │
       │                              │◄── Bob does the same ─────│
       │                              │                            │
       │── request_public_key(Bob) ──►│                           │
       │◄─ Bob_pub ──────────────────│                            │
       │── deriveSharedKey(Alice_priv, Bob_pub) → aesKey          │
       │── encryptMessage(aesKey, "Hello") → { ciphertext, iv }   │
       │── send_message ────────────►│── areFriends? ✅           │
       │                              │── save to MongoDB          │
       │                              │── relay to Bob ───────────►│
       │                              │       decryptMessage(aesKey, ciphertext, iv)
       │                              │                   → "Hello" ✅
       │                              │◄── message_seen ──────────│ (Bob opens chat)
       │◄─ message_seen (from: bob) ─│                            │
       │  updateTicks("bob", "seen") → ✓✓ BLUE                    │
```

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Auth + Friend API | Python 3, Flask, Flask-CORS, PyMongo, PyJWT, bcrypt |
| Chat + Relay | Java 11, Java-WebSocket (TooTallNate), auth0 java-jwt, MongoDB Java Driver |
| Real-Time Calling | WebRTC (RTCPeerConnection, getUserMedia), STUN: `stun.l.google.com:19302` |
| Database | MongoDB 6+ |
| Client Architecture | Vanilla JS MVC (13 files, no framework) |
| Cryptography | Browser WebCrypto API (`crypto.subtle`) |
| UI | Warm Glassmorphism (Inter font, Phosphor Icons) |
| Build | Apache Maven + maven-shade-plugin |

---

## ✅ Prerequisites

| Tool | Version |
|---|---|
| Python | 3.8+ |
| Java | 11+ |
| Apache Maven | 3.6+ |
| MongoDB | 6+ running on `localhost:27017` |

---

## 📦 Installation & Setup

### 1. Python Server
```bash
cd server-python
pip install -r requirements.txt
```

**`.env` file** (create in `server-python/`):
```env
MONGO_URI=mongodb://localhost:27017/securechat
JWT_SECRET=your-secret-key-here
```

### 2. Java Server
```bash
cd server-java
mvn clean package -DskipTests
```

> ⚠️ **Always rebuild and restart after editing `ChatServer.java`** — the running JAR will not pick up source changes automatically.
> Use the **shaded JAR**: `target/server-java-1.0-SNAPSHOT-shaded.jar`

---

## 🚀 Running the App

### Step 1 — MongoDB
```bash
mongosh
```

### Step 2 — Recommended Indexes (one-time setup)
```js
use securechat
db.friend_requests.createIndex({ sender: 1, receiver: 1 })
db.friend_requests.createIndex({ receiver: 1, status: 1 })
db.messages.createIndex({ sender: 1, receiver: 1, timestamp: 1 })
db.calls.createIndex({ caller: 1, callee: 1, startedAt: 1 })
```

### Step 3 — Python Server (Terminal 1)
```bash
cd server-python
python app.py
# → http://localhost:5000
```

### Step 4 — Java WebSocket Server (Terminal 2)
```bash
cd server-java
java -jar target\server-java-1.0-SNAPSHOT-shaded.jar
# → ws://localhost:5001
```

### Step 5 — Open the App
Navigate to **http://localhost:5000**

---

## 🗄️ MongoDB Collections

### `users`
```json
{
  "username": "alice",
  "password": "<bcrypt hash>",
  "publicKey": { "<ECDH P-256 JWK>" },
  "encryptedPrivateKey": { "<PBKDF2-encrypted JWK>" }
}
```

### `messages`
```json
{
  "sender": "alice",
  "receiver": "bob",
  "ciphertext": [12, 34, ...],
  "iv": [56, 78, ...],
  "timestamp": 1714234567890
}
```

### `friend_requests`
```json
{
  "sender": "alice",
  "receiver": "bob",
  "status": "pending | accepted | rejected"
}
```

### `calls`
```json
{
  "caller": "alice",
  "callee": "bob",
  "type": "voice | video",
  "status": "ringing | in_progress | completed | missed",
  "startedAt": 1714234567890,
  "answeredAt": 1714234572000,
  "endedAt": 1714234692890,
  "duration": 120
}
```

---

## 📡 API Reference

### Auth (Python — Port 5000)

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/auth/register` | `{ username, password, publicKey, encryptedPrivateKey }` | `{ msg }` |
| `POST` | `/auth/login` | `{ username, password }` | `{ token, username, publicKey, encryptedPrivateKey }` |

### Friend System (Python — Port 5000, JWT Required)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `GET`  | `/friends/status` | — | Returns `friends[]`, `pending_sent[]`, `pending_received[]` |
| `POST` | `/friends/request` | `{ receiver }` | Send a friend request |
| `POST` | `/friends/accept`  | `{ sender }` | Accept a pending request |
| `POST` | `/friends/reject`  | `{ sender }` | Decline a pending request |
| `POST` | `/friends/remove`  | `{ target }` | Unfriend — deletes from MongoDB |

---

## 🔌 WebSocket Events (Java — Port 5001)

Connect: `ws://localhost:5001/?token=<JWT>`

### Client → Server

| Type | Payload | Description |
|------|---------|----|
| `join` | `{ publicKey: JWK }` | Register session + public key |
| `request_public_key` | `{ receiver }` | Fetch ECDH public key |
| `send_message` | `{ receiver, ciphertext[], iv[] }` | Send encrypted message |
| `fetch_history` | `{ withUser }` | Retrieve chat history |
| `fetch_call_history` | `{ withUser }` | Retrieve call log |
| `typing` | `{ to, isTyping }` | Typing indicator relay |
| `message_delivered` | `{ to }` | Notify sender: message received |
| `message_seen` | `{ to }` | Notify sender: message seen |
| `call_offer` | `{ to, offer, withVideo }` | WebRTC offer (friends-only) |
| `call_answer` | `{ to, answer }` | WebRTC answer |
| `call_ice` | `{ to, candidate }` | ICE candidate |
| `call_ended` | `{ to }` | Hang-up / decline |
| `friend_request_sent` | `{ to }` | Relay: ping receiver |
| `friend_request_accepted` | `{ to }` | Relay: fire to both users |
| `friend_removed_notify` | `{ to }` | Relay: ping target |

### Server → Client

| Type | Payload | Triggered by |
|------|---------|-------------|
| `user_list` | `["alice", ...]` | Any connect/disconnect |
| `online_users` | `["alice", ...]` | Any connect/disconnect |
| `public_key_response` | `{ publicKey }` | `request_public_key` |
| `receive_message` | `{ sender, ciphertext[], iv[], timestamp }` | `send_message` |
| `history_response` | `[{ sender, ciphertext[], iv[], timestamp }]` | `fetch_history` |
| `call_history_response` | `[{ caller, callee, type, status, duration, startedAt }]` | `fetch_call_history` |
| `typing` | `{ from, isTyping }` | Typing relay |
| `message_delivered` | `{ from }` | Delivery receipt relay |
| `message_seen` | `{ from }` | Seen receipt relay |
| `call_offer` | `{ from, offer, withVideo }` | WebRTC signalling |
| `call_answer` | `{ from, answer }` | WebRTC signalling |
| `call_ice` | `{ from, candidate }` | WebRTC signalling |
| `call_ended` | `{ from }` | Hang-up / cancel |
| `new_friend_request` | `{ from }` | 🔔 Live request alert |
| `friendship_activated` | `{ with }` | ✅ Both UIs add each other |
| `friend_removed` | `{ from }` | ❌ Live unfriend notification |
| `error` | `{ message }` | Friend guard block or offline peer |

---

## 🛡️ Security Design Decisions

| Design Choice | Reason |
|---|---|
| **ECDH over RSA** | Smaller keys, faster operations, equivalent security |
| **AES-GCM over AES-CBC** | AEAD — encryption + authentication in one primitive; prevents tampering |
| **Fresh IV per message** | Prevents IV-reuse attacks that break AES-GCM security entirely |
| **PBKDF2 private key backup** | `PBKDF2(password) → AES-GCM wraps private key` — server never holds plaintext key |
| **bcrypt with gensalt()** | Salted, computationally expensive — resists rainbow tables and brute force |
| **JWT expiry (10 hours)** | Limits token exposure window if intercepted |
| **Browser WebCrypto API** | Native, audited, hardware-accelerated — no third-party crypto library needed |
| **Friend guard in Java (server-side)** | Cannot be bypassed by the client — friendship verified in MongoDB before every relay |
| **WebRTC P2P for calls** | Media never touches the server — no call recording possible by the server |
| **STUN for NAT traversal** | Uses Google's public STUN servers; add TURN for symmetric NAT environments |
| **5s polling safety net** | Eventual-consistency guarantee — catches missed WS relay events silently |
| **MVC separation** | State lives only in Models — Views never mutate state; zero spaghetti logic |

---

## ⚠️ Known Limitations

- **No Perfect Forward Secrecy (PFS):** Keys are persisted. A compromised private key could decrypt stored ciphertext. Production would use ephemeral keys per session.
- **TOFU model only:** Key fingerprints are displayed but not enforced — no out-of-band verification flow.
- **TURN server not included:** WebRTC calls work on LAN/same-network. For calls across the internet (symmetric NAT), a TURN relay server must be added to `CallController._iceConfig`.
- **No group calls or group chats:** One-to-one only.
- **No message deletion or editing.**
- **Single server:** No horizontal scaling for the Java WebSocket server.
- **Offline notifications:** Users who are offline when a friend request or message is sent receive it only after next login (the 5s poll catches it immediately on reconnect). Call history still saves to MongoDB regardless.

---

## 📝 License

This project is for educational and demonstration purposes.

---

<div align="center">
  <p>Built with ❤️ by <a href="https://github.com/Ram-sah19">Ram-sah19</a></p>
  <p><strong>NexChat</strong> — Encrypted · Social · Real-Time · WebRTC · MVC</p>
</div>
