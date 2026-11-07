/**
 * Tipos y utilidades compartidos para el chat (Web + Android)
 * Versión del protocolo: 1
 */

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

/**
 * Mensaje de chat recibido del servidor
 * @typedef {Object} ChatMessage
 * @property {number} id
 * @property {string} game_id
 * @property {string} player_id
 * @property {string} player_name
 * @property {string} content        // texto plano (v=0) o base64(ciphertext) (v=1)
 * @property {number} version        // 0 = plano, 1 = libsodium crypto_box
 * @property {string|null} nonce     // base64 nonce (solo v=1)
 * @property {string} created_at     // ISO timestamp
 */

/**
 * Clave pública de un jugador para E2E
 * @typedef {Object} GameKey
 * @property {string} game_id
 * @property {string} player_id
 * @property {string} public_key     // base64(clave pública 32 bytes curve25519)
 * @property {string} created_at
 */

/**
 * Mensaje para enviar al servidor (antes de cifrar)
 * @typedef {Object} OutgoingMessage
 * @property {string} game_id
 * @property {string} player_id
 * @property {string} player_name
 * @property {string} text           // texto plano que el usuario escribió
 */

// ─────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────

const CHAT_PROTOCOL_VERSION = 1;
const LIBSODIUM_KEYBYTES = 32;
const LIBSODIUM_NONCEBYTES = 24;
const LIBSODIUM_MACBYTES = 16;

// ─────────────────────────────────────────────────────────────
// Utilidades base64 / Uint8Array
// ─────────────────────────────────────────────────────────────

function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function randomNonce() {
  const arr = new Uint8Array(LIBSODIUM_NONCEBYTES);
  crypto.getRandomValues(arr);
  return arr;
}

// ─────────────────────────────────────────────────────────────
// Formato de mensaje cifrado (v=1)
// ─────────────────────────────────────────────────────────────

/**
 * Crea el payload para enviar al servidor (ya cifrado si hay clave del destinatario)
 * @param {OutgoingMessage} msg
 * @param {Uint8Array|null} senderPrivKey    // clave privada del remitente
 * @param {Uint8Array|null} recipientPubKey  // clave pública del destinatario
 * @returns {Promise<{version:number, content:string, nonce:string|null}>}
 */
async function prepareMessage(msg, senderPrivKey, recipientPubKey) {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(msg.text);

  if (!senderPrivKey || !recipientPubKey) {
    // Sin E2E → texto plano (version 0)
    return { version: 0, content: msg.text, nonce: null };
  }

  // E2E con libsodium: crypto_box(plaintext, nonce, recipientPub, senderPriv)
  const sodium = await getSodium();
  const nonce = randomNonce();
  const ciphertext = sodium.crypto_box_easy(plaintext, nonce, recipientPubKey, senderPrivKey);

  return {
    version: CHAT_PROTOCOL_VERSION,
    content: bytesToB64(ciphertext),
    nonce: bytesToB64(nonce),
  };
}

/**
 * Descifra un mensaje recibido
 * @param {ChatMessage} msg
 * @param {Uint8Array} myPrivKey
 * @param {Uint8Array} theirPubKey
 * @returns {Promise<string>} texto plano
 */
async function decryptMessage(msg, myPrivKey, theirPubKey) {
  if (msg.version === 0 || !msg.nonce) {
    return msg.content; // plano
  }
  const sodium = await getSodium();
  const ciphertext = b64ToBytes(msg.content);
  const nonce = b64ToBytes(msg.nonce);
  const plaintext = sodium.crypto_box_open_easy(ciphertext, nonce, theirPubKey, myPrivKey);
  return new TextDecoder().decode(plaintext);
}

// ─────────────────────────────────────────────────────────────
// libsodium (carga perezosa)
// ─────────────────────────────────────────────────────────────

let _sodiumReady = null;

async function getSodium() {
  if (_sodiumReady) return _sodiumReady;
  // Carga libsodium-wrappers desde CDN
  _sodiumReady = (async () => {
    if (window.sodium) return window.sodium;
    await loadScript('https://cdn.jsdelivr.net/npm/libsodium-wrappers@0.7.13/dist/browsers/libsodium.wrapper.min.js');
    await window.sodium_ready;
    return window.sodium;
  })();
  return _sodiumReady;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─────────────────────────────────────────────────────────────
// Gestión de claves (IndexedDB)
// ─────────────────────────────────────────────────────────────

const DB_NAME = 'ajedrez_chat_keys';
const STORE_NAME = 'keys';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'gameId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Genera o recupera par de claves para una partida
 * @param {string} gameId
 * @returns {Promise<{publicKey:Uint8Array, privateKey:Uint8Array}>}
 */
async function getOrCreateKeyPair(gameId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(gameId);
    getReq.onsuccess = async () => {
      if (getReq.result) {
        resolve({
          publicKey: b64ToBytes(getReq.result.publicKey),
          privateKey: b64ToBytes(getReq.result.privateKey),
        });
      } else {
        const sodium = await getSodium();
        const kp = sodium.crypto_box_keypair();
        const pubB64 = bytesToB64(kp.publicKey);
        const privB64 = bytesToB64(kp.privateKey);
        store.put({ gameId, publicKey: pubB64, privateKey: privB64 });
        resolve({ publicKey: kp.publicKey, privateKey: kp.privateKey });
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Guarda la clave pública del rival para esta partida
 * @param {string} gameId
 * @param {string} playerId
 * @param {Uint8Array} publicKey
 */
async function setPeerPublicKey(gameId, playerId, publicKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(gameId);
    getReq.onsuccess = () => {
      const record = getReq.result || { gameId, peers: {} };
      record.peers = record.peers || {};
      record.peers[playerId] = bytesToB64(publicKey);
      store.put(record);
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Obtiene la clave pública del rival
 * @param {string} gameId
 * @param {string} playerId
 * @returns {Promise<Uint8Array|null>}
 */
async function getPeerPublicKey(gameId, playerId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(gameId);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record && record.peers && record.peers[playerId]) {
        resolve(b64ToBytes(record.peers[playerId]));
      } else {
        resolve(null);
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

// ─────────────────────────────────────────────────────────────
// Consentimiento (localStorage)
// ─────────────────────────────────────────────────────────────

const CONSENT_KEY = 'ajedrez_chat_consent';

function hasChatConsent() {
  return localStorage.getItem(CONSENT_KEY) === '1';
}

function setChatConsent(granted) {
  localStorage.setItem(CONSENT_KEY, granted ? '1' : '0');
}

function clearChatConsent() {
  localStorage.removeItem(CONSENT_KEY);
}

// ─────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────

window.AjedrezChat = {
  // tipos (solo documentación, JS no los usa en runtime)
  // ChatMessage, GameKey, OutgoingMessage,

  // constantes
  CHAT_PROTOCOL_VERSION,
  LIBSODIUM_KEYBYTES,
  LIBSODIUM_NONCEBYTES,

  // utilidades
  b64ToBytes,
  bytesToB64,
  randomNonce,

  // cifrado
  prepareMessage,
  decryptMessage,

  // claves
  getOrCreateKeyPair,
  setPeerPublicKey,
  getPeerPublicKey,

  // consentimiento
  hasChatConsent,
  setChatConsent,
  clearChatConsent,
};