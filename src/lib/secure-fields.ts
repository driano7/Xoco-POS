'use client';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const SALT = TEXT_ENCODER.encode('xoco-pos-aes-gcm');

const bufferToHex = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const hexToBuffer = (hex: string) => {
  const pairs = hex.match(/.{1,2}/g) ?? [];
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
};

const canUseWebCrypto = () => typeof window !== 'undefined' && !!window.crypto?.subtle;

const deriveKey = async (email: string) => {
  if (!canUseWebCrypto()) {
    throw new Error('WebCrypto not available');
  }
  const normalized = email.trim().toLowerCase();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(normalized),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: SALT,
      iterations: 120_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const encryptField = async (value: string, email: string) => {
  try {
    const key = await deriveKey(email);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      TEXT_ENCODER.encode(value)
    );
    return `${bufferToHex(iv)}:${bufferToHex(ciphertext)}`;
  } catch (error) {
    console.warn('AES-GCM encrypt fallback (returned plain text):', error);
    return value;
  }
};

export const decryptField = async (payload: string, email: string) => {
  try {
    const [ivHex, cipherHex] = payload.split(':');
    if (!ivHex || !cipherHex) {
      return payload;
    }
    const key = await deriveKey(email);
    const data = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBuffer(ivHex) },
      key,
      hexToBuffer(cipherHex)
    );
    return TEXT_DECODER.decode(data);
  } catch (error) {
    console.warn('AES-GCM decrypt fallback (returned payload):', error);
    return payload;
  }
};

export const encryptSensitiveSnapshot = async (
  data: Record<string, string | number | null | undefined>,
  email: string
) => {
  const snapshot: Record<string, string> = {};
  await Promise.all(
    Object.entries(data).map(async ([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      const normalized = typeof value === 'string' ? value : `${value}`;
      snapshot[key] = await encryptField(normalized, email);
    })
  );
  return snapshot;
};
