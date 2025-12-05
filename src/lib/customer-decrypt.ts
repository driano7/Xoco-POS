/*
 * --------------------------------------------------------------------
 *  Xoco POS — Point of Sale System
 *  Software Property of Xoco Café
 *  Copyright (c) 2025 Xoco Café
 *  Principal Developer: Donovan Riaño
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at:
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 *  --------------------------------------------------------------------
 *  PROPIEDAD DEL SOFTWARE — XOCO CAFÉ.
 *  Sistema Xoco POS — Punto de Venta.
 *  Desarrollador Principal: Donovan Riaño.
 *
 *  Este archivo está licenciado bajo Apache License 2.0.
 *  Consulta el archivo LICENSE en la raíz del proyecto para más detalles.
 * --------------------------------------------------------------------
 */

import { createDecipheriv, pbkdf2Sync } from 'node:crypto';

type RawEncryptedValue =
  | string
  | {
      encrypted?: string | null;
      cipher?: string | null;
      ciphertext?: string | null;
      iv?: string | null;
      lv?: string | null;
      nonce?: string | null;
      tag?: string | null;
      authTag?: string | null;
      salt?: string | null;
      keySalt?: string | null;
      plaintext?: string | null;
      encoding?: 'hex' | 'base64' | string | null;
    }
  | null
  | undefined;

type NormalizedEncryptedPayload =
  | {
      encrypted: string;
      iv: string;
      tag: string;
      salt: string;
      encoding: 'hex' | 'base64';
    }
  | { plaintext: string };

const HEX_REGEX = /^[0-9a-f]+$/i;

const bufferFromString = (value: string, encoding: 'hex' | 'base64') => {
  try {
    return Buffer.from(value, encoding);
  } catch {
    return null;
  }
};

const decodeBinary = (value: string, encodingHint?: 'hex' | 'base64') => {
  if (encodingHint) {
    return bufferFromString(value, encodingHint);
  }

  if (HEX_REGEX.test(value) && value.length % 2 === 0) {
    return bufferFromString(value, 'hex');
  }

  return bufferFromString(value, 'base64');
};

const normalizePayload = (input: RawEncryptedValue): NormalizedEncryptedPayload | null => {
  if (input == null) {
    return null;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          return normalizePayload(parsed as RawEncryptedValue);
        }
      } catch {
        return { plaintext: trimmed };
      }
    }

    return { plaintext: trimmed };
  }

  if (typeof input === 'object') {
    const payload = input as Record<string, unknown>;

    const plaintext =
      typeof payload.plaintext === 'string'
        ? payload.plaintext.trim()
        : typeof payload.value === 'string'
          ? payload.value.trim()
          : null;

    if (plaintext) {
      return { plaintext };
    }

    const encrypted =
      (payload.encrypted as string | null | undefined) ??
      (payload.cipher as string | null | undefined) ??
      (payload.ciphertext as string | null | undefined);
    const iv =
      (payload.iv as string | null | undefined) ??
      (payload.lv as string | null | undefined) ??
      (payload.nonce as string | null | undefined);
    const tag =
      (payload.tag as string | null | undefined) ??
      (payload.authTag as string | null | undefined);
    const salt =
      (payload.salt as string | null | undefined) ??
      (payload.keySalt as string | null | undefined);
    const encoding =
      payload.encoding === 'base64'
        ? 'base64'
        : payload.encoding === 'hex'
          ? 'hex'
          : undefined;

    if (encrypted && iv && tag && salt) {
      const looksHex = [encrypted, iv, tag].every(
        (value) => HEX_REGEX.test(value) && value.length % 2 === 0
      );
      return {
        encrypted,
        iv,
        tag,
        salt,
        encoding: encoding ?? (looksHex ? 'hex' : 'base64'),
      };
    }
  }

  return null;
};

const decryptWithEmailKey = (payload: NormalizedEncryptedPayload, email?: string | null) => {
  if ('plaintext' in payload) {
    return payload.plaintext;
  }

  const sanitizedEmail = typeof email === 'string' ? email.trim() : '';
  if (!sanitizedEmail) {
    return null;
  }

  const saltBuffer = decodeBinary(payload.salt, 'hex');
  const ivBuffer = decodeBinary(payload.iv, 'hex');
  const tagBuffer = decodeBinary(payload.tag, 'hex');
  const encryptedBuffer = decodeBinary(payload.encrypted, payload.encoding);

  if (!saltBuffer || !ivBuffer || !tagBuffer || !encryptedBuffer) {
    return null;
  }

  try {
    const key = pbkdf2Sync(sanitizedEmail, saltBuffer, 100000, 32, 'sha256');
    const decipher = createDecipheriv('aes-256-gcm', key, ivBuffer);
    decipher.setAuthTag(tagBuffer);
    const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    return decrypted.toString('utf8').trim();
  } catch {
    return null;
  }
};

export const decryptCustomerField = (input: RawEncryptedValue, email?: string | null) => {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed && !trimmed.startsWith('{')) {
      return trimmed;
    }
  }

  const normalized = normalizePayload(input);
  if (!normalized) {
    return null;
  }

  return decryptWithEmailKey(normalized, email);
};

export type RawUserRecord = {
  email?: string | null;
  clientId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  firstNameEncrypted?: RawEncryptedValue;
  firstNameIv?: string | null;
  firstNameTag?: string | null;
  firstNameSalt?: string | null;
  lastNameEncrypted?: RawEncryptedValue;
  lastNameIv?: string | null;
  lastNameTag?: string | null;
  lastNameSalt?: string | null;
  phoneEncrypted?: RawEncryptedValue;
  phoneIv?: string | null;
  phoneTag?: string | null;
  phoneSalt?: string | null;
  [key: string]: unknown;
} | null;

const buildFieldPayload = (user: RawUserRecord, field: string): RawEncryptedValue => {
  if (!user) {
    return null;
  }

  const plainValue = user[field];
  if (typeof plainValue === 'string' && plainValue.trim()) {
    return plainValue;
  }

  const encryptedValue = user?.[`${field}Encrypted`];
  if (typeof encryptedValue === 'string') {
    const trimmed = encryptedValue.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          return parsed as RawEncryptedValue;
        }
      } catch {
        return trimmed;
      }
    }
    // If we only have the encrypted column but no metadata, treat it as plaintext fallback.
    if (
      !user?.[`${field}Iv`] &&
      !user?.[`${field}Tag`] &&
      !user?.[`${field}Salt`] &&
      !HEX_REGEX.test(trimmed)
    ) {
      return trimmed;
    }
  }

  const enriched: Record<string, unknown> = {};
  let hasEncryptedShape = false;

  const assignValue = (suffix: string, targetKey: string) => {
    const key = `${field}${suffix}`;
    const value = user?.[key];
    if (typeof value === 'string' && value.trim()) {
      enriched[targetKey] = value.trim();
      hasEncryptedShape = true;
    }
  };

  assignValue('Encrypted', 'encrypted');
  assignValue('Iv', 'iv');
  assignValue('Tag', 'tag');
  assignValue('Salt', 'salt');

  if (hasEncryptedShape) {
    return enriched;
  }

  return null;
};

export const withDecryptedUserNames = <T extends RawUserRecord>(user: T) => {
  if (!user) {
    return null;
  }

  const firstName = decryptCustomerField(buildFieldPayload(user, 'firstName'), user.email) ?? null;
  const lastName = decryptCustomerField(buildFieldPayload(user, 'lastName'), user.email) ?? null;
  const phone = decryptCustomerField(buildFieldPayload(user, 'phone'), user.email) ?? null;

  return {
    ...user,
    firstName,
    lastName,
    phone,
  };
};
