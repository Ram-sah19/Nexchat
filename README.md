# Secure E2EE Chat

A production-grade, end-to-end encrypted (E2EE) messaging application built with a dual-service backend architecture. This project emphasizes modern cryptographic security using the Web Crypto API for secure in-browser key exchange and message encryption.

## Architecture Structure

The project has been architected using microservices to separate RESTful user authentication from the real-time WebSocket messaging layer.

### 1. `client/` (Frontend UI & Cryptography)
- Built with vanilla HTML, CSS, and JavaScript.
- Implements **Web Crypto API** for true End-to-End Encryption (E2EE).
- Features ECDH for key exchange and AES-GCM for message encryption/decryption on the client-side.
- Manages connecting to the Java WebSocket server and authenticating via tokens obtained from the Python backend.

### 2. `server-python/` (REST Authentication Service)
- A **Python Flask** microservice dedicated to user authentication.
- Connects to MongoDB to manage user accounts.
- Uses `bcrypt` for secure password hashing and generates **JWT** (JSON Web Tokens) for session authorization.
- Exposes `/auth/register` and `/auth/login` endpoints.

### 3. `server-java/` (WebSocket Routing Service)
- A **Java** application (built with Maven) serving as the real-time messaging broker.
- Uses `Java-WebSocket` for lightweight, scalable full-duplex communication.
- Validates JWT tokens provided by the client upon connection.
- Relays encrypted message payloads between clients and stores encrypted chat history in MongoDB.
- *Note: The server never has access to plaintext messages, preserving true E2EE.*

### 4. Database (MongoDB)
- Both microservices interface with a **MongoDB** database (`securechat`).
- Stores registered users (hashed passwords) and encrypted messages.

## Security Features

- **End-to-End Encryption (E2EE):** Elliptic Curve Diffie-Hellman (ECDH) is used to establish shared secrets, which are then used as keys for AES-GCM encryption. All cryptography happens within the browser.
- **Identity Verification:** Users can verify chat integrity via "Fingerprints" to prevent Man-in-the-Middle (MITM) attacks.
- **JWT Authentication:** Secure token-based session management across both backends.
- **Microservice Separation:** Decoupling auth and real-time sockets increases system robustness and mitigates attack vectors.

## Requirements

- **Python 3.x**
- **Java 11+** & **Maven**
- **MongoDB** (running locally on `mongodb://localhost:27017` by default)
- A modern web browser supporting the Web Crypto API.

## Setup and Running

To run the full stack locally, follow these steps in separate terminal windows:

### 1. Start MongoDB
Ensure your local MongoDB server is active.
```bash
# Example if using mongod directly:
mongod
```

### 2. Start the Python Authentication Server
```bash
cd server-python
pip install -r requirements.txt
python app.py
```
*Runs on port 5000 by default.*

### 3. Start the Java WebSocket Server
```bash
cd server-java
mvn clean package
java -jar target/server-java-1.0-SNAPSHOT.jar
```
*(Ensure the port specified in `chat.Main` does not conflict with the Flask server)*

### 4. Open the Client
Since the frontend uses vanilla HTML/JS with absolute paths routed by the servers (or via static file serving), you can simply serve the directory or point a local server to the `client/` folder. Alternatively, the Python Flask backend is configured to serve the static frontend dynamically:
- Open your browser to `http://localhost:5000/`

## Contributing
When extending functionality, maintain the boundary between the REST module (Python) and the Socket Router (Java), and ensure all payloads injected into the socket feed are handled opaquely by the backend to avoid breaking encryption guarantees.
