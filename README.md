# 🔐 NexChat — End-to-End Encrypted Chat Application

> A production-ready, fully End-to-End Encrypted (E2EE) real-time chat system built with **Python (Flask)**, **Java (WebSocket)**, and **vanilla JavaScript** — powered by **ECDH + AES-GCM** cryptography via the browser's native WebCrypto API. Features a complete **friend request system**, **live WebSocket notifications**, and a clean **MVC architecture** on the frontend.

[![GitHub](https://img.shields.io/badge/GitHub-Nexchat-181717?style=flat-square&logo=github)](https://github.com/Ram-sah19/Nexchat)
[![Python](https://img.shields.io/badge/Python-3.8+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Java](https://img.shields.io/badge/Java-11+-ED8B00?style=flat-square&logo=java)](https://www.java.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-27017-47A248?style=flat-square&logo=mongodb)](https://www.mongodb.com/)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#️-architecture)
- [Frontend MVC Structure](#-frontend-mvc-structure)
- [Friend System](#-friend-system)
- [Cryptographic Algorithms](#-cryptographic-algorithms)
- [Full Message Encryption Flow](#-full-message-encryption-flow)
- [Tech Stack](#️-tech-stack)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
- [Running the App](#-running-the-app)
- [MongoDB Setup & Indexes](#-mongodb-setup--indexes)
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
- **Users must be friends before they can chat** — enforced at both the frontend and Java server level.
- **Live real-time notifications**: friend requests and accepts arrive instantly without page refresh.
- The client follows a strict **MVC pattern** — state, DOM, and logic are fully separated.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser — MVC)                         │
│                                                                        │
│  ┌──────────────────────┐       ┌──────────────────────────────────┐  │
│  │  auth + friend REST  │       │  chat + social WebSocket relay   │  │
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
│  /auth/login            │       │  Public key storage (session)       │
│  /friends/status        │       │  E2EE message relay                 │
│  /friends/request       │       │  Friend guard (areFriends check)    │
│  /friends/accept        │       │  Social event relay:                │
│  /friends/reject        │       │    friend_request_sent →            │
│  /friends/remove        │       │    new_friend_request               │
│  Serves client files    │       │    friend_request_accepted →        │
└──────────────┬──────────┘       │    friendship_activated (×2)        │
               │                  │    friend_removed_notify →          │
               └──────────────────│    friend_removed                   │
                                  └──────────────┬──────────────────────┘
                                                 │
                                  ┌──────────────▼──────────────────────┐
                                  │           MongoDB                    │
                                  │         (Port 27017)                 │
                                  │  Collections:                        │
                                  │  • users           (auth + keys)     │
                                  │  • messages        (encrypted blobs) │
                                  │  • friend_requests (social graph)    │
                                  └─────────────────────────────────────┘
```

| Layer | Technology | Port | Role |
|-------|-----------|------|------|
| Auth + Friend API | Python / Flask | **5000** | Register, Login, JWT, Friend CRUD |
| Chat + Relay | Java / WebSocket | **5001** | E2EE relay, friend guard, live social events |
| Database | MongoDB | **27017** | Users, encrypted messages, friendships |
| Client | Vanilla JS / WebCrypto | (served by Flask) | MVC app — Crypto, UI, WS relay |

---

## 📐 Frontend MVC Structure

The entire client is split across **11 files** following strict MVC separation. No layer may cross into another's responsibility.

```
client/
  index.html                      ← HTML shell (no logic)
  style.css                       ← Warm glassmorphism design system
  crypto.js                       ← Global WebCrypto helpers (ECDH, AES-GCM, PBKDF2)
  app.js                          ← Entry point: instantiate + wire (≈50 lines)
  
  models/                         ── PURE STATE, no DOM, no fetch, no WebSocket
    AuthModel.js                  ← token, username, isLoggedIn, authHeader getter
    UserModel.js                  ← friends[], pendingSent[], pendingReceived[], online set
    ChatModel.js                  ← activeChatUser, sharedKeys{}, ECDH keypair, reqId map
  
  views/                          ── DOM ONLY, no business logic
    AuthView.js                   ← login/register form, showChat/showAuth transitions
    SidebarView.js                ← renderAllUsers, renderFriendsList, renderFriendRequests
    ChatView.js                   ← appendMessage (grouped), setChatUser, setInputEnabled
    ToastView.js                  ← show(message, type) with rAF fade animation
  
  controllers/                    ── ORCHESTRATION: use models + views + APIs
    SocketController.js           ← WebSocket lifecycle, send(), event dispatcher
    FriendController.js           ← 5 REST actions, WS relay, 5s polling safety net
    ChatController.js             ← initCrypto, key exchange, selectUser, sendMessage
    AuthController.js             ← login, register, logout, sidebar collapse, polling
```

### Dependency Graph

```
        AuthController
        ┌──────┬──────┬─────────────┐
        ▼      ▼      ▼             │
  SocketCtrl  ChatCtrl  FriendCtrl  │
      │    ◄──────┘   ◄────────────┘
      │         └── share: AuthModel, UserModel, ChatModel
      │         └── share: AuthView, SidebarView, ChatView, ToastView
      ▼
  (WebSocket → Java Server)
```

**Circular dependencies** are resolved via post-construction `wire()` calls in `app.js`:
```js
socketCtrl.wire({ chatCtrl, friendCtrl, authCtrl, ... });
chatCtrl.wire(socketCtrl, friendCtrl);
friendCtrl.wire(socketCtrl, chatCtrl);
authCtrl.wire(socketCtrl, chatCtrl, friendCtrl);
```

### Layer Rules

| Layer | Can Access | Cannot Access |
|---|---|---|
| **Model** | Pure data only | DOM, fetch, WebSocket |
| **View** | DOM elements via IDs | Models, controllers, fetch |
| **Controller** | Models + Views + fetch/WS | Sibling controllers directly (use wired refs) |
| **app.js** | Everything (for wiring only) | Business logic |

---

## 🤝 Friend System

### Flow Overview

```
Step 1 — Alice clicks "+ Add" on Bob
  ├─ Frontend → POST /friends/request    (Python saves status: "pending")
  ├─ FriendController mutates UserModel
  ├─ FriendController → WS: { type: "friend_request_sent", to: "Bob" }
  └─ Java relays to Bob: { type: "new_friend_request", from: "Alice" }
       └─ SocketController → UserModel.addPendingReceived("Alice")
       └─ SidebarView.renderFriendRequests() — live notification panel ✅

Step 2 — Bob clicks "Accept"
  ├─ Frontend → POST /friends/accept     (Python sets status: "accepted")
  ├─ FriendController → WS: { type: "friend_request_accepted", to: "Alice" }
  └─ Java fires `friendship_activated` to BOTH simultaneously:
       Alice: { type: "friendship_activated", with: "Bob" }
       Bob:   { type: "friendship_activated", with: "Alice" }
       └─ Both SocketControllers → UserModel.addFriend() → SidebarView re-render ✅

Step 3 — Chatting
  └─ Java ChatServer.areFriends() checks MongoDB before every message
       ✅ Friends   → message relayed
       ❌ Not friends → { type: "error" } blocked live

Step 4 — Unfriend
  ├─ Frontend → POST /friends/remove     (Python deletes document)
  ├─ FriendController → WS: { type: "friend_removed_notify", to: "Bob" }
  └─ Java relays: { type: "friend_removed", from: "Alice" }
       └─ Bob's UI closes the open chat + Java immediately blocks new messages ✅

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

### 1. ECDH P-256 — Key Exchange (`crypto.js`)
```js
const ecdhParams = { name: "ECDH", namedCurve: "P-256" };
const keyPair = await crypto.subtle.generateKey(ecdhParams, true, ["deriveKey", "deriveBits"]);
```
- Each user generates a P-256 ECDH key pair in the browser on first login.
- **Public key** → stored on server (MongoDB + registered in Java session on `join`).
- **Private key** → never leaves the browser (cached in `localStorage` + server backup encrypted with PBKDF2).
- Shared secret: `Alice_priv + Bob_pub = Bob_priv + Alice_pub` → becomes the **AES-GCM key**.

### 2. AES-GCM 256-bit — Message Encryption (`crypto.js`)
```js
const iv         = crypto.getRandomValues(new Uint8Array(12)); // fresh per message
const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, encoded);
```
- **Authenticated encryption (AEAD)** — provides both confidentiality and integrity.
- **Fresh 12-byte random IV per message** — prevents IV-reuse attacks.
- Server stores only `ciphertext[]` + `iv[]` byte arrays — cannot decrypt them.

### 3. HMAC-SHA256 — JWT Auth
```python
# Python: issues token on login
token = jwt.encode({ 'username': ..., 'exp': now + 10h }, JWT_SECRET, algorithm='HS256')
```
```java
// Java: verifies token on every WebSocket connect
DecodedJWT jwt = JWT.require(Algorithm.HMAC256(JWT_SECRET)).build().verify(token);
```

### 4. bcrypt — Password Hashing
```python
hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
```
- Salted per user — identical passwords produce different hashes.
- Computationally expensive by design — resists brute-force.

### 5. PBKDF2 + AES-GCM — Private Key Backup (Cross-Device)
```js
const aesKey = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt: enc.encode(username + "_salt"), iterations: 100000, hash: "SHA-256" },
  await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]),
  { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
);
```
- Private key is encrypted **client-side** with a key derived from the user's password before being sent to the server.
- The server **cannot decrypt it** without the password — enables cross-device key recovery.

### 6. SHA-256 — Key Fingerprinting
```js
const hash = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(pubKeyJwk)));
// → "A3:F2:91:..." (TOFU identity verification)
```

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
       │── friend_request_sent ─────►│── new_friend_request ────►│
       │                              │◄── friend_request_accepted│
       │                              │── friendship_activated ──►│ (both)
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
```

**The server has zero access to plaintext at any step.**

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Auth + Friend API | Python 3, Flask, Flask-CORS, PyMongo, PyJWT, bcrypt |
| Chat + Relay | Java 11, Java-WebSocket (TooTallNate), auth0 java-jwt |
| Database | MongoDB 6+ |
| Client Architecture | Vanilla JS MVC (11 files, no framework) |
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
mvn clean package
```
Produces a fat JAR at `target/server-java-1.0-SNAPSHOT.jar`.

> ⚠️ **Always rebuild after editing `ChatServer.java`** — the running JAR will not pick up source changes automatically.

---

## 🚀 Running the App

### Step 1 — MongoDB
```bash
mongosh
```

### Step 2 — Create Indexes (one-time setup)
```js
use securechat
db.friend_requests.createIndex({ sender: 1, receiver: 1 })
db.friend_requests.createIndex({ receiver: 1, status: 1 })
db.messages.createIndex({ sender: 1, receiver: 1, timestamp: 1 })
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
java -jar target\server-java-1.0-SNAPSHOT.jar
# → ws://localhost:5001
```

### Step 5 — Open the App
Navigate to **http://localhost:5000**

---

## 🗄️ MongoDB Setup & Indexes

```js
use securechat

// Check users
db.users.find({}, { username: 1, _id: 0 }).pretty()

// Check friend relationships
db.friend_requests.find().pretty()

// Recommended indexes
db.friend_requests.createIndex({ sender: 1, receiver: 1 })
db.friend_requests.createIndex({ receiver: 1, status: 1 })
db.messages.createIndex({ sender: 1, receiver: 1, timestamp: 1 })
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

#### `GET /friends/status` Response
```json
{
  "friends": ["bob", "charlie"],
  "pending_sent": ["dave"],
  "pending_received": [{ "sender": "eve" }]
}
```

---

## 🔌 WebSocket Events (Java — Port 5001)

Connect: `ws://localhost:5001/?token=<JWT>`

### Client → Server

| Type | Payload | Handler |
|------|---------|---------|
| `join` | `{ publicKey: JWK }` | Register for session |
| `request_public_key` | `{ receiver }` | Fetch ECDH public key |
| `send_message` | `{ receiver, ciphertext[], iv[] }` | Send encrypted message |
| `fetch_history` | `{ withUser }` | Retrieve chat history |
| `friend_request_sent` | `{ to }` | Relay: ping receiver with `new_friend_request` |
| `friend_request_accepted` | `{ to }` | Relay: fire `friendship_activated` to both users |
| `friend_removed_notify` | `{ to }` | Relay: ping target with `friend_removed` |

### Server → Client

| Type | Payload | Triggered by |
|------|---------|-------------|
| `user_list` | `["alice", ...]` | Any connect/disconnect |
| `online_users` | `["alice", ...]` | Any connect/disconnect |
| `public_key_response` | `{ publicKey }` | `request_public_key` |
| `receive_message` | `{ sender, ciphertext[], iv[], timestamp }` | `send_message` |
| `history_response` | `[{ sender, ciphertext[], iv[], timestamp }]` | `fetch_history` |
| `new_friend_request` | `{ from }` | 🔔 Live request alert |
| `friendship_activated` | `{ with }` | ✅ Both UIs add each other to My Friends |
| `friend_removed` | `{ from }` | ❌ Live unfriend notification |
| `error` | `{ message }` | Message blocked by friend guard |

---

## 🛡️ Security Design Decisions

| Design Choice | Reason |
|---|---|
| **ECDH over RSA** | Smaller keys, faster operations, equivalent security |
| **AES-GCM over AES-CBC** | AEAD — encryption + authentication in one primitive; prevents tampering |
| **Fresh IV per message** | Prevents IV-reuse attacks that break AES-GCM security entirely |
| **PBKDF2 private key backup** | `PBKDF2(password)  → AES-GCM wraps private key` — server never holds plaintext key |
| **bcrypt with gensalt()** | Salted, computationally expensive — resists rainbow tables and brute force |
| **JWT expiry (10 hours)** | Limits token exposure window if intercepted |
| **Browser WebCrypto API** | Native, audited, hardware-accelerated — no third-party crypto library needed |
| **Friend guard in Java (server-side)** | Cannot be bypassed by the client — friendship verified in MongoDB before every relay |
| **5s polling safety net** | Eventual-consistency guarantee — catches missed WS relay events silently |
| **MVC separation** | State lives only in Models — Views never mutate state; zero spaghetti logic |

---

## ⚠️ Known Limitations

- **No Perfect Forward Secrecy (PFS):** Keys are persisted. A compromised private key could decrypt stored ciphertext. Production would use ephemeral keys per session.
- **TOFU model only:** Key fingerprints are displayed but not enforced — no out-of-band verification flow.
- **No message deletion or key rotation.**
- **Single server:** No horizontal scaling for the Java WebSocket server.
- **Offline notifications:** Users who are offline when a friend request is sent receive it only after next login (the 5s poll catches it immediately on reconnect).

---

## 📝 License

This project is for educational and demonstration purposes.

---

<div align="center">
  <p>Built with ❤️ by <a href="https://github.com/Ram-sah19">Ram-sah19</a></p>
  <p><strong>NexChat</strong> — Encrypted · Social · Real-Time · MVC</p>
</div>
