# 🔐 NexChat — End-to-End Encrypted Chat Application

> A production-ready, fully End-to-End Encrypted (E2EE) real-time chat system built with Python (Flask), Java (WebSocket), and vanilla JavaScript — powered by **ECDH + AES-GCM** cryptography via the browser's native WebCrypto API. Features a complete **friend request system** with live WebSocket notifications.

[![GitHub](https://img.shields.io/badge/GitHub-Nexchat-181717?style=flat-square&logo=github)](https://github.com/Ram-sah19/Nexchat)
[![Python](https://img.shields.io/badge/Python-3.8+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Java](https://img.shields.io/badge/Java-11+-ED8B00?style=flat-square&logo=java)](https://www.java.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-27017-47A248?style=flat-square&logo=mongodb)](https://www.mongodb.com/)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [What's New](#-whats-new)
- [Architecture](#️-architecture)
- [Friend System](#-friend-system)
- [Cryptographic Algorithms](#-cryptographic-algorithms)
- [Full Message Encryption Flow](#-full-message-encryption-flow)
- [Project Structure](#-project-structure)
- [Tech Stack](#️-tech-stack)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
- [Running the Servers](#-running-the-servers)
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

This architecture is similar to how **Signal Protocol** works — the server is a blind relay.

---

## ✨ What's New

### 🤝 Friend Request System
A complete social graph layer sits on top of the E2EE chat:

| Feature | Description |
|---|---|
| **Add Friend** | Send a friend request from the "All Users" discovery panel |
| **Live 🔔 Alert** | If the target is online, they receive an instant WebSocket notification — no refresh |
| **Accept / Decline** | Incoming requests appear in a notification panel in the sidebar |
| **Friendship Activated** | On accept, Java fires `friendship_activated` to **both** users simultaneously — both UIs update live |
| **Unfriend** | Remove a friend at any time; Java blocks their messages immediately |
| **Security Guard** | Java WebSocket server verifies friendship in MongoDB before delivering any message |
| **Polling Safety Net** | Every 5 seconds, the client compares local state with MongoDB — catches any missed WS events |

### 🔑 Cross-Device Key Persistence
Private keys are stored **encrypted on the server** (encrypted with your password via PBKDF2) — message history is decryptable on any device.

### 🗂️ Sidebar Redesign
- **My Friends** — click to open chat (only friends can chat)
- **All Users** — discover and add anyone registered in the system
- **Friend Requests panel** — live incoming request notifications with Accept / Decline

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                         │
│                                                               │
│  ┌──────────────────┐        ┌───────────────────────────┐   │
│  │  auth + friends  │        │  chat + social WS relay   │   │
│  │  (REST API)      │        │  (WebSocket)              │   │
│  └────────┬─────────┘        └──────────────┬────────────┘   │
└───────────┼─────────────────────────────────┼───────────────-┘
            │ HTTP                             │ WebSocket (ws://)
            ▼                                  ▼
┌───────────────────────┐       ┌──────────────────────────────┐
│   Python / Flask      │       │   Java WebSocket Server      │
│   (Port 5000)         │       │   (Port 5001)                │
│                       │       │                              │
│  - /auth/register     │       │  - JWT verification          │
│  - /auth/login        │       │  - Public key exchange       │
│  - /friends/request   │       │  - E2EE message relay        │
│  - /friends/accept    │       │  - Friend guard (areFriends) │
│  - /friends/reject    │       │  - Social event relay:       │
│  - /friends/remove    │       │    friend_request_sent       │
│  - /friends/status    │       │    friendship_activated      │
│  - Serves client HTML │       │    friend_removed            │
└───────────┬───────────┘       └──────────────┬───────────────┘
            │                                  │
            └────────────────┬─────────────────┘
                             ▼
                  ┌─────────────────────┐
                  │      MongoDB        │
                  │    (Port 27017)     │
                  │                    │
                  │  Collections:      │
                  │  - users           │
                  │  - messages        │
                  │  - friend_requests │
                  └─────────────────────┘
```

| Layer | Technology | Port | Role |
|-------|-----------|------|------|
| Auth + Friend API | Python / Flask | **5000** | Register, Login, JWT, Friend CRUD |
| Chat + Relay | Java / WebSocket | **5001** | E2EE relay, friend guard, live social events |
| Database | MongoDB | **27017** | Users, encrypted messages, friendships |
| Client | Vanilla JS / WebCrypto | (served by Flask) | Crypto, UI, WS relay |

---

## 🤝 Friend System

### Flow Overview

```
Step 1 — Alice clicks "Add Friend" on Bob
  ├─ Frontend → POST /friends/request  (Python saves { sender, receiver, status: "pending" })
  ├─ Frontend → WS: { type: "friend_request_sent", to: "Bob" }
  └─ Java relays to Bob (if online): { type: "new_friend_request", from: "Alice" }
       └─ Bob's UI: 🔔 toast + request appears in notification panel

Step 2 — Bob clicks "Accept"
  ├─ Frontend → POST /friends/accept  (Python sets status → "accepted")
  ├─ Frontend → WS: { type: "friend_request_accepted", to: "Alice" }
  └─ Java fires to BOTH simultaneously:
       Alice: { type: "friendship_activated", with: "Bob" }   → Bob moves to "My Friends"
       Bob:   { type: "friendship_activated", with: "Alice" } → Alice moves to "My Friends"

Step 3 — Chatting
  └─ Java checks areFriends(sender, receiver) in MongoDB before every message
       ✅ Friends   → message delivered
       ❌ Not friends → { type: "error", message: "You must be friends to chat!" }

Step 4 — Unfriend
  ├─ Frontend → POST /friends/remove  (Python deletes friendship document)
  ├─ Frontend → WS: { type: "friend_removed_notify", to: "Bob" }
  └─ Java relays to Bob: { type: "friend_removed", from: "Alice" }
       └─ Bob's UI updates live; Java immediately starts blocking messages
```

### MongoDB Schema — `friend_requests` Collection

```json
{
  "sender":   "alice",
  "receiver": "bob",
  "status":   "pending"   // → "accepted" | "rejected"
}
```

---

## 🔐 Cryptographic Algorithms

### 1. ECDH — P-256 (Key Exchange)
**File:** `client/crypto.js`

```js
const ecdhParams = { name: "ECDH", namedCurve: "P-256" };
localKeyPair = await crypto.subtle.generateKey(ecdhParams, true, ["deriveKey", "deriveBits"]);
```

- Each user generates a **P-256 ECDH key pair** in the browser on first login.
- **Public key** → shared with the server (stored in MongoDB).
- **Private key** → never transmitted; stored in `localStorage` AND backed up encrypted on the server.
- When Alice chats with Bob: `Alice_priv + Bob_pub → sharedSecret = Bob_priv + Alice_pub`
- The shared secret becomes the **AES-GCM encryption key**.

> **Why ECDH over RSA?** P-256 ECDH gives equivalent security to RSA-3072 with far smaller key sizes and faster computation — ideal for real-time chat.

---

### 2. AES-GCM 256-bit (Message Encryption)
**File:** `client/crypto.js`

```js
const iv = crypto.getRandomValues(new Uint8Array(12)); // fresh random IV per message
const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, encoded);
```

- **AES-GCM (Galois/Counter Mode)** with a **256-bit key**.
- GCM provides both **encryption and authentication** (AEAD) — messages cannot be tampered with without detection.
- A **fresh random 12-byte IV** is generated for **every single message**, preventing IV-reuse attacks.
- `ciphertext` + `iv` are stored in MongoDB as byte arrays — the server cannot decrypt them.

---

### 3. HMAC-SHA256 (JWT Authentication)
**File:** `server-python/app.py` + `server-java/ChatServer.java`

```python
# Python — issues token after login
token = jwt.encode({'id': ..., 'username': ..., 'exp': now + 10h}, JWT_SECRET, algorithm='HS256')
```
```java
// Java — verifies token on every WebSocket connection
DecodedJWT jwt = JWT.require(Algorithm.HMAC256(JWT_SECRET)).build().verify(token);
```

- JWT is passed as a WebSocket query parameter: `ws://localhost:5001/?token=<JWT>`
- Valid for **10 hours**.

---

### 4. bcrypt (Password Hashing)
**File:** `server-python/app.py`

```python
hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8'))
```

- Passwords never stored in plaintext.
- Random salt per user — identical passwords produce different hashes.
- Computationally expensive by design — resists brute-force.

---

### 5. PBKDF2 + AES-GCM (Private Key Encryption for Cross-Device Access)
**File:** `client/crypto.js`

```js
// Derive an AES key from the user's password
const aesKey = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt: enc.encode(username + "_salt"), iterations: 100000, hash: "SHA-256" },
  keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
);
// Encrypt the private key JWK with this derived key → store on server
```

- Private key is encrypted client-side before being sent to the server.
- The server **cannot decrypt it without the user's password**.
- Enables key recovery on new devices without re-generating keys (which would break history).

---

### 6. SHA-256 (Key Fingerprinting)
**File:** `client/crypto.js`

```js
const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(jwk)));
// → "A3:F2:91:..." (like SSH fingerprints)
```

- Deterministic fingerprint of any user's public key.
- Used for identity verification (**TOFU — Trust On First Use**).

---

## 🔄 Full Message Encryption Flow

```
[Alice]                          [Server]                       [Bob]
   │                                │                              │
   │── Login ──────────────────────►│                              │
   │◄─ JWT + encrypted private key ─│                              │
   │                                │                              │
   │── Generate / restore ECDH keys │                              │
   │── WS connect (?token=JWT) ────►│                              │
   │── join { publicKey: Alice_pub }►│── store Alice_pub in MongoDB │
   │                                │                              │
   │── friend_request_sent {to:Bob}►│── relay to Bob: new_friend_request
   │                                │◄── Bob accepts ──────────────│
   │                                │── friendship_activated → Alice + Bob
   │                                │                              │
   │── request_public_key(Bob) ────►│                              │
   │◄─ Bob_pub ─────────────────────│                              │
   │                                │                              │
   │── deriveSharedKey(Alice_priv, Bob_pub) → sharedKey            │
   │── encryptMessage(sharedKey, "Hello Bob!")                     │
   │   → { ciphertext: [...], iv: [...] }                          │
   │                                │                              │
   │── send_message{receiver:Bob} ─►│── areFriends? ✅             │
   │                                │── save to MongoDB ─────────  │
   │                                │── relay to Bob ──────────────►
   │                                │                              │
   │                                │         decryptMessage(sharedKey, ciphertext, iv)
   │                                │                    → "Hello Bob!" ✅
```

**The server at no point has access to the plaintext message.**

---

## 📁 Project Structure

```
nexchat/
├── client/                     # Frontend (served by Flask at port 5000)
│   ├── index.html              # App shell — auth screen + split sidebar chat layout
│   ├── app.js                  # Auth, WebSocket, friend system, chat logic, polling
│   ├── crypto.js               # ECDH + AES-GCM + PBKDF2 + SHA-256 implementation
│   └── style.css               # Glassmorphism dark UI with friend system components
│
├── server-python/              # Auth + Friend API Server
│   ├── app.py                  # Flask REST API (auth + 5 friend endpoints)
│   ├── requirements.txt        # Python dependencies
│   └── .env                    # MONGO_URI, JWT_SECRET
│
└── server-java/                # Chat / WebSocket / Social Relay Server
    ├── pom.xml                 # Maven build config
    └── src/main/java/chat/
        ├── Main.java           # Entry point (port 5001)
        └── ChatServer.java     # JWT verify, E2EE relay, friend guard, social relay
```

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Auth + Friend API | Python 3, Flask, Flask-CORS |
| Chat + Social Relay | Java 11, Java-WebSocket (TooTallNate) |
| Database | MongoDB |
| Client Crypto | Browser WebCrypto API (`crypto.subtle`) |
| Auth Tokens | JWT (PyJWT + auth0 java-jwt) |
| Password Hashing | bcrypt |
| Key Backup | PBKDF2-derived AES-GCM encryption |
| Build Tool (Java) | Apache Maven + maven-shade-plugin |
| Key Exchange | ECDH P-256 |
| Message Encryption | AES-GCM 256-bit |
| UI Icons | Phosphor Icons |
| Fonts | Inter (Google Fonts) |

---

## ✅ Prerequisites

- **Python 3.8+**
- **Java 11+**
- **Apache Maven 3.6+**
- **MongoDB** running on `localhost:27017`

---

## 📦 Installation & Setup

### Python Server

```bash
cd server-python
pip install -r requirements.txt
```

**`requirements.txt`:**
```
flask
flask-cors
pymongo
bcrypt
PyJWT
python-dotenv
```

**`.env` file:**
```env
MONGO_URI=MONGO_URI
JWT_SECRET=JWT_SECRET
```

### Java Server

```bash
cd server-java
mvn clean package
```

This produces `server-java/target/server-java-1.0-SNAPSHOT.jar` — a fat JAR with all dependencies.

---

## 🚀 Running the Servers

### Step 1 — Start MongoDB
```bash
mongosh
```

### Step 2 — Create Indexes (run once in mongosh)
```js
use securechat
db.friend_requests.createIndex({ sender: 1, receiver: 1 })
db.friend_requests.createIndex({ receiver: 1, status: 1 })
db.friend_requests.createIndex({ status: 1 })
```

### Step 3 — Start Python Auth + Friend API (Terminal 1)
```bash
cd server-python
python app.py
# → http://localhost:5000
```

### Step 4 — Start Java WebSocket Server (Terminal 2)
```bash
cd server-java
java -jar target\server-java-1.0-SNAPSHOT.jar
# → ws://localhost:5001
```

### Step 5 — Open the App
Navigate to: **http://localhost:5000**

---

## 🗄️ MongoDB Setup & Indexes

### Verify Data
```js
use securechat

// Check users
db.users.find({}, { username: 1, publicKey: 1 }).pretty()

// Check friend requests
db.friend_requests.find().pretty()
// Expected: { sender: "alice", receiver: "bob", status: "pending" | "accepted" }

// Check messages (encrypted blobs — server cannot read these)
db.messages.find().pretty()
```

### Recommended Indexes
```js
// Friend request lookups (run once)
db.friend_requests.createIndex({ sender: 1, receiver: 1 })
db.friend_requests.createIndex({ receiver: 1, status: 1 })

// Message history lookups
db.messages.createIndex({ sender: 1, receiver: 1, timestamp: 1 })
```

---

## 📡 API Reference

### Auth Endpoints (Python — Port 5000)

#### `POST /auth/register`
```json
Request:  { "username": "alice", "password": "secret123", "publicKey": {JWK}, "encryptedPrivateKey": {...} }
Response: { "msg": "User created successfully" }
```

#### `POST /auth/login`
```json
Request:  { "username": "alice", "password": "secret123" }
Response: { "token": "<JWT>", "username": "alice", "publicKey": {JWK}, "encryptedPrivateKey": {...} }
```

---

### Friend Endpoints (Python — Port 5000, JWT Required)

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/friends/status` | GET | — | Returns `friends[]`, `pending_sent[]`, `pending_received[]` |
| `/friends/request` | POST | `{ receiver }` | Send a friend request |
| `/friends/accept` | POST | `{ sender }` | Accept a pending request |
| `/friends/reject` | POST | `{ sender }` | Decline a pending request |
| `/friends/remove` | POST | `{ target }` | Unfriend — deletes from MongoDB |

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

### Connection
```
ws://localhost:5001/?token=<JWT>
```
JWT is verified on connect. Invalid tokens are rejected with code `4001`.

---

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `join` | `{ publicKey: JWK }` | Register public key for session |
| `request_public_key` | `{ receiver: "username" }` | Fetch another user's ECDH public key |
| `send_message` | `{ receiver, ciphertext[], iv[] }` | Send encrypted message (blocked if not friends) |
| `fetch_history` | `{ withUser: "username" }` | Load chat history |
| `friend_request_sent` | `{ to: "username" }` | Relay: tell receiver a request was sent |
| `friend_request_accepted` | `{ to: "username" }` | Relay: tell original sender it was accepted |
| `friend_removed_notify` | `{ to: "username" }` | Relay: tell unfriended user they were removed |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `user_list` | `["alice", "bob", ...]` | All registered users (for "All Users" panel) |
| `online_users` | `["alice", ...]` | Currently connected users (status dots) |
| `public_key_response` | `{ publicKey: JWK }` | Response to key request |
| `receive_message` | `{ sender, ciphertext[], iv[], timestamp }` | Incoming encrypted message |
| `history_response` | `[{ sender, receiver, ciphertext[], iv[], timestamp }]` | Chat history |
| `new_friend_request` | `{ from: "username" }` | 🔔 Live friend request alert |
| `friendship_activated` | `{ with: "username" }` | Both users → move to "My Friends" |
| `friend_removed` | `{ from: "username" }` | Live unfriend notification |
| `error` | `{ message: "..." }` | Blocked message (non-friend attempt) |

---

## 🛡️ Security Design Decisions

| Design Choice | Reason |
|--------------|--------|
| **ECDH over RSA** | Smaller keys, faster operations, equivalent security |
| **AES-GCM over AES-CBC** | GCM provides authenticated encryption (AEAD) — prevents tampering |
| **Fresh IV per message** | Prevents IV-reuse attacks which break AES-GCM security |
| **Private key encrypted before server storage** | PBKDF2(password) → AES-GCM wraps private key — server never has plaintext key |
| **bcrypt with gensalt()** | Salted hashing prevents rainbow table and duplicate-password attacks |
| **JWT expiry (10 hours)** | Limits token exposure window |
| **WebCrypto API** | Native, audited, hardware-accelerated browser crypto — no third-party library needed |
| **Server stores only ciphertext** | True E2EE — server compromise does not expose message content |
| **Friend guard in Java** | Friendship verified in MongoDB at the WebSocket layer — cannot be bypassed by the frontend |
| **Polling safety net (5s)** | Catches missed WebSocket relay events — eventual consistency guarantee |

---

## ⚠️ Known Limitations

- **No Perfect Forward Secrecy (PFS):** Keys are persisted (localStorage + server). A compromised private key could decrypt stored ciphertext. A production system would use ephemeral keys per session.
- **TOFU model only:** No out-of-band key verification mechanism is implemented (fingerprint UI exists but not enforced).
- **No message deletion / key rotation** implemented.
- **Single server deployment:** No horizontal scaling for the Java WebSocket server.
- **No push notifications:** Offline users see requests only after next login (the 5s poll catches it on reconnect).

---

## 📝 License

This project is for educational and demonstration purposes.

---

<div align="center">
  <p>Built with ❤️ for Developers</p>
  <p><strong>NexChat</strong> — Encrypted · Social · Real-Time</p>
</div>
