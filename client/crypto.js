// crypto.js
const ecdhParams = { name: "ECDH", namedCurve: "P-256" };
const aesParams = { name: "AES-GCM", length: 256 };

// Generate ECDH Key Pair
async function generateKeyPair() {
  return await crypto.subtle.generateKey(
    ecdhParams,
    true, // extractable
    ["deriveKey", "deriveBits"]
  );
}

// Export Public Key (JWK)
async function exportPublicKey(key) {
  const exported = await crypto.subtle.exportKey("jwk", key);
  return exported;
}

// Import a received Public Key (JWK)
async function importPublicKey(jwk) {
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    ecdhParams,
    true,
    []
  );
}

// Derive Shared AES-GCM Key
async function deriveSharedKey(privateKey, publicKey) {
  return await crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    aesParams,
    false, // extractable
    ["encrypt", "decrypt"]
  );
}

// Encrypt Message using Shared AES-GCM Key
async function encryptMessage(sharedKey, messageString) {
  const enc = new TextEncoder();
  const encoded = enc.encode(messageString);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    sharedKey,
    encoded
  );

  return {
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    iv: Array.from(iv)
  };
}

// Normalize various server serialization formats to Uint8Array
// Handles: number[], Base64 string, ArrayBuffer, Uint8Array
function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "string") {
    // Base64 string (e.g. from some server serializations)
    const binary = atob(input);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  }
  if (Array.isArray(input)) return new Uint8Array(input);
  throw new TypeError("Cannot convert input to Uint8Array: " + typeof input);
}

// Decrypt Message using Shared AES-GCM Key
async function decryptMessage(sharedKey, ciphertextArray, ivArray) {
  const ciphertext = toUint8Array(ciphertextArray);
  const iv = toUint8Array(ivArray);

  if (iv.length !== 12) {
    throw new Error(`Invalid IV length: expected 12 bytes, got ${iv.length}`);
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    sharedKey,
    ciphertext
  );

  const dec = new TextDecoder();
  return dec.decode(decrypted);
}

// Derive an AES-GCM key from a password using PBKDF2
async function deriveKeyFromPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt a JWK private key with the user's password
async function encryptPrivateKey(privateKeyJwk, password, username) {
  const aesKey = await deriveKeyFromPassword(password, username + "_salt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    enc.encode(JSON.stringify(privateKeyJwk))
  );
  return {
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    iv: Array.from(iv)
  };
}

// Decrypt the stored private key with the user's password
async function decryptPrivateKey(encryptedPrivateKey, password, username) {
  const aesKey = await deriveKeyFromPassword(password, username + "_salt");
  const ciphertext = new Uint8Array(encryptedPrivateKey.ciphertext);
  const iv = new Uint8Array(encryptedPrivateKey.iv);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// Generate a 64-character SHA-256 fingerprint for a JWK public key
async function generateFingerprint(jwk) {
  const enc = new TextEncoder();
  // Sort the properties to ensure deterministic hashing for identical public keys
  const keyStr = JSON.stringify({
    crv: jwk.crv,
    ext: jwk.ext,
    key_ops: jwk.key_ops,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y
  });
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(keyStr));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // Convert to formatted hex: XX:XX:XX...
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
}
