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

// Decrypt Message using Shared AES-GCM Key
async function decryptMessage(sharedKey, ciphertextArray, ivArray) {
  const ciphertext = new Uint8Array(ciphertextArray);
  const iv = new Uint8Array(ivArray);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    sharedKey,
    ciphertext
  );

  const dec = new TextDecoder();
  return dec.decode(decrypted);
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
