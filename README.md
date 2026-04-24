# 🔐 SecureChat — End-to-End Encrypted Chat Application

> A production-ready, fully End-to-End Encrypted (E2EE) real-time chat system built with Python (Flask), Java (WebSocket), and vanilla JavaScript — powered by **ECDH + AES-GCM** cryptography via the browser's native WebCrypto API.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Cryptographic Algorithms](#cryptographic-algorithms)
- [Full Message Encryption Flow](#full-message-encryption-flow)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Running the Servers](#running-the-servers)
- [API Reference](#api-reference)
- [WebSocket Events](#websocket-events)
- [Security Design Decisions](#security-design-decisions)

---

## 🌐 Overview

SecureChat is a fully E2EE chat application where:

- **No one — not even the server — can read your messages.**
- All encryption and decryption happens **exclusively on the client (browser)**.
- The server only stores and relays **opaque ciphertext** it cannot decode.
- Authentication uses industry-standard **JWT (HMAC-SHA256)** tokens.
- Passwords are stored using **bcrypt** with salting.

This architecture is similar to how **Signal Protocol** works — the server is a blind relay.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                  CLIENT (Browser)                    │
│                                                      │
│  ┌──────────────┐        ┌──────────────────────┐   │
│  │  auth (REST) │        │  chat (WebSocket)    │   │
│  └──────┬───────┘        └──────────┬───────────┘   │
└─────────┼──────────────────────────┼───────────────-┘
          │ HTTP                      │ WebSocket (ws://)
          ▼                           ▼
┌──────────────────┐       ┌──────────────────────┐
│  Python / Flask  │       │   Java WebSocket     │
│   (Port 5000)    │       │    (Port 5001)       │
│                  │       │                      │
│  - /auth/register│       │  - JWT verification  │
│  - /auth/login   │       │  - Public key store  │
│  - serves client │       │  - Message relay     │
└────────┬─────────┘       └──────────┬───────────┘
         │                            │
         └───────────┬────────────────┘
                     ▼
            ┌─────────────────┐
            │    MongoDB      │
            │  (Port 27017)   │
            │                 │
            │  collections:   │
            │  - users        │
            │  - messages     │
            └─────────────────┘
```

| Layer | Technology | Port | Role |
|-------|-----------|------|------|
| Auth Server | Python / Flask | **5000** | Register, Login, JWT issuance |
| Chat Server | Java / WebSocket | **5001** | Real-time messaging, key exchange |
| Database | MongoDB | **27017** | Users, encrypted messages |
| Client | Vanilla JS | (served by Flask) | Crypto + UI |

---

## 🔐 Cryptographic Algorithms

### 1. ECDH — P-256 (Key Exchange)

**File:** `client/crypto.js`

```js
const ecdhParams = { name: "ECDH", namedCurve: "P-256" };

// Generate key pair on login
localKeyPair = await crypto.subtle.generateKey(
  ecdhParams,
  true,
  ["deriveKey", "deriveBits"]
);
```

- Each user generates a **P-256 Elliptic Curve Diffie-Hellman** key pair in the browser.
- The **public key** is shared with the server (stored in MongoDB).
- The **private key never leaves the browser** — persisted in `localStorage`.
- When Alice wants to chat with Bob:
  1. Alice fetches **Bob's public key** from the server.
  2. Alice's private key + Bob's public key → derives a **shared secret**.
  3. Bob's private key + Alice's public key → derives the **same shared secret**.
  4. This shared secret becomes the AES-GCM encryption key.

> **Why ECDH over RSA?** P-256 ECDH gives equivalent security to RSA-3072 with far smaller key sizes and faster computation — ideal for real-time chat.

---

### 2. AES-GCM 256-bit (Message Encryption)

**File:** `client/crypto.js`

```js
// Encrypt
const iv = crypto.getRandomValues(new Uint8Array(12)); // fresh random IV per message
const ciphertext = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv: iv },
  sharedKey,   // derived from ECDH
  encoded      // UTF-8 encoded plaintext
);

// Decrypt
const decrypted = await crypto.subtle.decrypt(
  { name: "AES-GCM", iv: iv },
  sharedKey,
  ciphertext
);
```

- Uses **AES-GCM (Galois/Counter Mode)** with a **256-bit key**.
- GCM mode provides both **encryption and authentication** (AEAD) — messages cannot be tampered with without detection.
- A **fresh random 12-byte IV** is generated for **every single message**, preventing IV reuse attacks.
- `ciphertext` + `iv` are stored in MongoDB as byte arrays — the server cannot decrypt them.

---

### 3. HMAC-SHA256 (JWT Authentication)

**File:** `server-python/app.py` + `server-java/src/main/java/chat/ChatServer.java`

```python
# Python — Issues token after login
token = jwt.encode(
    {'id': str(user['_id']), 'username': username, 'exp': datetime.utcnow() + timedelta(hours=10)},
    JWT_SECRET,
    algorithm='HS256'
)
```

```java
// Java — Verifies token on every WebSocket connection
DecodedJWT jwt = JWT.require(Algorithm.HMAC256(JWT_SECRET))
                    .build()
                    .verify(token);
String username = jwt.getClaim("username").asString();
```

- Login via Python Flask → JWT token issued (valid for **10 hours**).
- Token is passed as a **WebSocket query parameter**: `ws://localhost:5001/?token=<JWT>`.
- Java server **verifies** the JWT signature before allowing the connection.
- Both servers share the same `JWT_SECRET` — configured via `.env`.

---

### 4. bcrypt (Password Hashing)

**File:** `server-python/app.py`

```python
# Registration — hash before storing
hashed_password = bcrypt.hashpw(
    password.encode('utf-8'),
    bcrypt.gensalt()        # random salt generated automatically
).decode('utf-8')

# Login — verify without ever storing plaintext
bcrypt.checkpw(password.encode('utf-8'), user['password'].encode('utf-8'))
```

- Passwords are **never stored in plaintext**.
- `bcrypt.gensalt()` generates a unique salt per user — identical passwords produce different hashes.
- bcrypt is deliberately slow (adaptive cost factor), making brute-force attacks computationally expensive.

---

### 5. SHA-256 (Key Fingerprinting)

**File:** `client/crypto.js`

```js
async function generateFingerprint(jwk) {
  const keyStr = JSON.stringify({
    crv: jwk.crv, ext: jwk.ext, key_ops: jwk.key_ops,
    kty: jwk.kty, x: jwk.x, y: jwk.y
  });
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(keyStr));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
  // Output: A3:F2:91:... (like SSH fingerprints)
}
```

- Generates a **deterministic SHA-256 fingerprint** of any user's public key JWK.
- Properties are **sorted** before hashing to ensure reproducibility.
- Used for identity verification (**TOFU — Trust On First Use** model).

---

## 🔄 Full Message Encryption Flow

```
[Alice]                          [Server]                       [Bob]
   │                                │                              │
   │── Login ──────────────────────►│                              │
   │◄─ JWT token ───────────────────│                              │
   │                                │                              │
   │── Generate ECDH key pair       │                              │
   │── Store private key in         │                              │
   │   localStorage                 │                              │
   │                                │                              │
   │── WS connect (?token=JWT) ────►│                              │
   │── join {publicKey: Alice_pub}─►│── store Alice_pub in MongoDB │
   │                                │                              │
   │                                │◄── Bob connects & joins ─────│
   │                                │◄── store Bob_pub in MongoDB──│
   │                                │                              │
   │── request_public_key(Bob) ────►│                              │
   │◄─ Bob_pub ─────────────────────│                              │
   │                                │                              │
   │── deriveSharedKey(Alice_priv, Bob_pub) → sharedKey            │
   │                                │   [Bob does same internally] │
   │                                │                              │
   │── encryptMessage(sharedKey, "Hello Bob!")                     │
   │   → { ciphertext: [...], iv: [...] }                          │
   │                                │                              │
   │── send_message{receiver:Bob, ciphertext, iv} ──►│             │
   │                                │── save to MongoDB ────────── │
   │                                │── relay to Bob ──────────────►
   │                                │                              │
   │                                │         decryptMessage(sharedKey, ciphertext, iv)
   │                                │                    → "Hello Bob!" ✅
```

**The server at no point has access to the plaintext message.**

---

## 📁 Project Structure

```
secure-chat-prod/
├── client/                  # Frontend (served by Flask)
│   ├── index.html           # App shell & UI structure
│   ├── app.js               # WebSocket, auth, chat logic
│   ├── crypto.js            # ECDH + AES-GCM + SHA-256 implementation
│   └── style.css            # Styling
│
├── server-python/           # Auth Server
│   ├── app.py               # Flask REST API (register, login)
│   ├── requirements.txt     # Python dependencies
│   └── .env                 # Environment variables (MONGO_URI, JWT_SECRET)
│
└── server-java/             # Chat / WebSocket Server
    ├── pom.xml              # Maven build config
    └── src/main/java/chat/
        ├── Main.java        # Entry point (port 5001)
        └── ChatServer.java  # WebSocket logic, JWT verify, message relay
```

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Auth Server | Python 3, Flask, Flask-CORS |
| Chat Server | Java 11, Java-WebSocket (TooTallNate) |
| Database | MongoDB |
| Client Crypto | Browser WebCrypto API (`crypto.subtle`) |
| Auth Tokens | JWT (PyJWT / auth0 java-jwt) |
| Password Hashing | bcrypt |
| Build Tool (Java) | Apache Maven + maven-shade-plugin |
| Key Exchange | ECDH P-256 |
| Message Encryption | AES-GCM 256-bit |

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

**`requirements.txt` includes:**
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
MONGO_URI=mongodb://localhost:27017/securechat
JWT_SECRET=JdXw3ypy3KXjLxfRpNW2LWV4ie3WyxrzCN7YUNAAxvE
```

### Java Server

```bash
cd server-java
mvn clean package
```

This creates a fat JAR (`server-java-1.0-SNAPSHOT.jar`) with all dependencies bundled.

---

## 🚀 Running the Servers

### Step 1 — Start MongoDB
```bash
mongosh
```

### Step 2 — Start the Python Auth Server (Terminal 1)
```bash
cd server-python
python app.py
# Running on http://localhost:5000
```

### Step 3 — Start the Java WebSocket Server (Terminal 2)
```bash
cd server-java
java -jar target\server-java-1.0-SNAPSHOT.jar
# Java WebSocket server started on port: 5001
```

### Step 4 — Open the App
Navigate to: **http://localhost:5000**

---

## 📡 API Reference (Python REST — Port 5000)

### `POST /auth/register`
Register a new user.

**Request:**
```json
{ "username": "alice", "password": "secret123" }
```

**Response:**
```json
{ "msg": "User created successfully" }
```

---

### `POST /auth/login`
Authenticate and receive a JWT.

**Request:**
```json
{ "username": "alice", "password": "secret123" }
```

**Response:**
```json
{
  "token": "<JWT>",
  "username": "alice"
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
| `request_public_key` | `{ receiver: "username" }` | Fetch another user's public key |
| `send_message` | `{ receiver, ciphertext[], iv[] }` | Send encrypted message |
| `fetch_history` | `{ withUser: "username" }` | Load chat history |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `user_list` | `["alice", "bob", ...]` | Broadcast all registered users |
| `public_key_response` | `{ publicKey: JWK }` | Response to key request |
| `receive_message` | `{ sender, ciphertext[], iv[], timestamp }` | Incoming message |
| `history_response` | `[ { sender, receiver, ciphertext[], iv[], timestamp } ]` | Chat history |

---

## 🛡️ Security Design Decisions

| Design Choice | Reason |
|--------------|--------|
| **ECDH over RSA** | Smaller keys, faster operations, same security level |
| **AES-GCM over AES-CBC** | GCM provides authenticated encryption (AEAD) — prevents tampering |
| **Fresh IV per message** | Prevents IV-reuse attacks which break AES-GCM security |
| **Private key in localStorage** | Key never transmitted; browser-only persistence |
| **bcrypt with gensalt()** | Salted hashing prevents rainbow table and duplicate-password attacks |
| **JWT expiry (10 hours)** | Limits token exposure window |
| **WebCrypto API** | Native, audited, hardware-accelerated browser crypto — no third-party library needed |
| **Server stores only ciphertext** | True E2EE — server compromise does not expose message content |

---

## ⚠️ Known Limitations

- **No Perfect Forward Secrecy (PFS):** Keys are persisted in localStorage. If the private key is compromised, past messages (stored ciphertext) could be decrypted. A production system would use ephemeral keys per session.
- **JWT Secret is hardcoded as fallback.** In production, `JWT_SECRET` must be a strong random secret loaded exclusively from environment variables.
- **No message deletion / key rotation** implemented.
- **TOFU model only** — no out-of-band key verification mechanism is implemented.

---

## 📝 License

This project is for educational and demonstration purposes.
