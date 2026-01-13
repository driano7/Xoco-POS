/*
 * --------------------------------------------------------------------
 *  Xoco POS — Address payload helpers
 * --------------------------------------------------------------------
 */

import { decryptCustomerField } from '@/lib/customer-decrypt';

export type EncryptedAddressRow = {
  id: string;
  userId?: string | null;
  label?: string | null;
  nickname?: string | null;
  type?: string | null;
  payload?: string | null;
  payload_iv?: string | null;
  payload_tag?: string | null;
  payload_salt?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  reference?: string | null;
  additionalInfo?: string | null;
  isDefault?: boolean | null;
  contactPhone?: string | null;
  isWhatsapp?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type DecryptedAddressPayload = {
  id: string;
  label?: string | null;
  nickname?: string | null;
  type?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  reference?: string | null;
  additionalInfo?: string | null;
  contactPhone?: string | null;
  isWhatsapp?: boolean | null;
  isDefault?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

const hasEncryptedPayload = (row: EncryptedAddressRow) =>
  Boolean(
    row.payload &&
      row.payload_iv &&
      row.payload_tag &&
      row.payload_salt &&
      row.payload.trim() &&
      row.payload_iv.trim() &&
      row.payload_tag.trim() &&
      row.payload_salt.trim()
  );

const parseAddressJson = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
};

export const decryptAddressRow = (
  row: EncryptedAddressRow,
  email?: string | null
): DecryptedAddressPayload | null => {
  if (!row?.id) {
    return null;
  }

  if (hasEncryptedPayload(row)) {
    const decryptedJson = decryptCustomerField(
      {
        encrypted: row.payload,
        iv: row.payload_iv,
        tag: row.payload_tag,
        salt: row.payload_salt,
        encoding: 'hex',
      },
      email
    );

    const parsed = parseAddressJson(decryptedJson);
    if (parsed) {
      return {
        id: row.id,
        label: typeof parsed.label === 'string' ? parsed.label : row.label ?? row.nickname ?? null,
        nickname: typeof parsed.nickname === 'string' ? parsed.nickname : row.nickname ?? null,
        type: typeof parsed.type === 'string' ? parsed.type : row.type ?? null,
        street: typeof parsed.street === 'string' ? parsed.street : null,
        city: typeof parsed.city === 'string' ? parsed.city : null,
        state: typeof parsed.state === 'string' ? parsed.state : null,
        postalCode: typeof parsed.postalCode === 'string' ? parsed.postalCode : null,
        country: typeof parsed.country === 'string' ? parsed.country : null,
        reference: typeof parsed.reference === 'string' ? parsed.reference : null,
        additionalInfo:
          typeof parsed.additionalInfo === 'string' ? parsed.additionalInfo : row.additionalInfo ?? null,
        contactPhone: typeof parsed.contactPhone === 'string' ? parsed.contactPhone : null,
        isWhatsapp:
          typeof parsed.isWhatsapp === 'boolean'
            ? parsed.isWhatsapp
            : typeof parsed.whatsapp === 'boolean'
              ? parsed.whatsapp
              : row.isWhatsapp ?? null,
        isDefault: typeof parsed.isDefault === 'boolean' ? parsed.isDefault : row.isDefault ?? null,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
      };
    }
  }

  return {
    id: row.id,
    label: row.label ?? row.nickname ?? null,
    nickname: row.nickname ?? row.label ?? null,
    type: row.type ?? null,
    street: row.street ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    postalCode: row.postalCode ?? null,
    country: row.country ?? null,
    reference: row.reference ?? null,
    additionalInfo: row.additionalInfo ?? null,
    contactPhone: row.contactPhone ?? null,
    isWhatsapp: row.isWhatsapp ?? null,
    isDefault: row.isDefault ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
};
