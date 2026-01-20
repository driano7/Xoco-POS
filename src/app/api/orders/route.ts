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

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import {
  enqueuePendingOperations,
  flushPendingOperations,
  isLikelyNetworkError,
  markSupabaseFailure,
  markSupabaseHealthy,
  shouldPreferSupabase,
  type PendingOperation,
} from '@/lib/offline-sync';
import { withDecryptedUserNames } from '@/lib/customer-decrypt';
import { decryptAddressRow, type DecryptedAddressPayload } from '@/lib/address-decrypt';
import { sqlite } from '@/lib/sqlite';
import type { OrderShippingInfo } from '@/lib/api';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const TICKETS_TABLE = process.env.SUPABASE_TICKETS_TABLE ?? 'tickets';
const ORDER_CODES_TABLE = process.env.SUPABASE_ORDER_CODES_TABLE ?? 'order_codes';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const VENTAS_TABLE = process.env.SUPABASE_VENTAS_TABLE ?? 'ventas';
const ADDRESSES_TABLE = process.env.SUPABASE_ADDRESSES_TABLE ?? 'addresses';
const ORDER_CLIENT_ID_COLUMN =
  process.env.SUPABASE_ORDERS_CLIENT_ID_COLUMN?.trim() || null;

const sanitizeEnv = (value?: string | null) => value?.trim() || null;

const PUBLIC_SALE_CLIENT_ID =
  sanitizeEnv(process.env.SUPABASE_PUBLIC_SALE_CLIENT_ID) ??
  sanitizeEnv(process.env.NEXT_PUBLIC_PUBLIC_SALE_CLIENT_ID) ??
  'AAA-1111';
const PUBLIC_SALE_USER_ID =
  sanitizeEnv(process.env.SUPABASE_PUBLIC_SALE_USER_ID) ??
  sanitizeEnv(process.env.NEXT_PUBLIC_PUBLIC_SALE_USER_ID) ??
  PUBLIC_SALE_CLIENT_ID;

let publicSaleUserEnsured = false;
let ensuringPublicSaleUserPromise: Promise<void> | null = null;

const ensurePublicSaleUser = async () => {
  if (!PUBLIC_SALE_USER_ID || publicSaleUserEnsured) {
    return;
  }
  if (ensuringPublicSaleUserPromise) {
    await ensuringPublicSaleUserPromise;
    return;
  }

  ensuringPublicSaleUserPromise = (async () => {
    const identifier = PUBLIC_SALE_CLIENT_ID ?? PUBLIC_SALE_USER_ID;

    const { data: existing, error } = await supabaseAdmin
      .from(USERS_TABLE)
      .select('id')
      .or(`id.eq.${PUBLIC_SALE_USER_ID},"clientId".eq.${identifier}`)
      .limit(1)
      .maybeSingle();

    if (existing) {
      publicSaleUserEnsured = true;
      return;
    }

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to verify public sale user: ${error.message}`);
    }

    const email =
      process.env.SUPABASE_PUBLIC_SALE_EMAIL ??
      'venta-publico@xoco-pos.local';

    const insertPayload: Record<string, string> = {
      id: PUBLIC_SALE_USER_ID,
      clientId: identifier,
    };

    if (email) {
      insertPayload.email = email;
    }

    const { error: insertError } = await supabaseAdmin.from(USERS_TABLE).upsert(insertPayload, {
      onConflict: 'id',
    });

    if (insertError) {
      throw new Error(`Failed to upsert public sale user: ${insertError.message}`);
    }
    publicSaleUserEnsured = true;
  })();

  try {
    await ensuringPublicSaleUserPromise;
  } finally {
    ensuringPublicSaleUserPromise = null;
  }
};
const MAX_RESULTS = Number(process.env.ORDERS_LIMIT ?? 100);

const TICKET_CODE_PREFIX = 'XL-';
const TICKET_CODE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TICKET_CODE_DIGITS = '0123456789';

const generateTicketCode = () => {
  const digits = Array.from({ length: 2 }, () =>
    TICKET_CODE_DIGITS[Math.floor(Math.random() * TICKET_CODE_DIGITS.length)]
  );
  const letters = Array.from({ length: 3 }, () =>
    TICKET_CODE_LETTERS[Math.floor(Math.random() * TICKET_CODE_LETTERS.length)]
  );
  return `${TICKET_CODE_PREFIX}${digits.join('')}${letters.join('')}`;
};

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeQuantity = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return parsed <= 0 ? 1 : parsed;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const coerceString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
};

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const coerceBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'si', 'sí'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return null;
};

const coerceRecord = (value: unknown): Record<string, unknown> | null => {
  if (isPlainObject(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
};

const extractAddressRecord = (value: Record<string, unknown> | null) => {
  if (!value) {
    return null;
  }
  const street =
    coerceString(value.street) ??
    coerceString(value.addressLine1) ??
    coerceString((value as Record<string, unknown>).line1);
  const city =
    coerceString(value.city) ??
    coerceString(value.municipality) ??
    coerceString(value.locality);
  const state =
    coerceString(value.state) ??
    coerceString(value.region) ??
    coerceString(value.stateCode);
  const postalCode =
    coerceString(value.postalCode) ??
    coerceString(value.zip) ??
    coerceString(value.cp);
  const reference =
    coerceString(value.reference) ??
    coerceString(value.references) ??
    coerceString(value.note);
  if (street || city || state || postalCode || reference) {
    return {
      street: street ?? undefined,
      city: city ?? undefined,
      state: state ?? undefined,
      postalCode: postalCode ?? undefined,
      reference: reference ?? undefined,
    };
  }
  return null;
};

const parseDeliveryTipSnapshot = (value: unknown) => {
  const record = coerceRecord(value);
  if (record) {
    const amount = coerceNumber(record.amount ?? record.a ?? record.value);
    const percent = coerceNumber(record.percent ?? record.p);
    if (amount !== null || percent !== null) {
      return {
        amount,
        percent,
      };
    }
    return null;
  }
  const amount = coerceNumber(value);
  if (amount !== null) {
    return { amount, percent: null };
  }
  return null;
};

const parseShippingSnapshot = (value: unknown) => {
  const record = coerceRecord(value);
  if (!record) {
    return null;
  }
  const nestedAddress =
    coerceRecord(record.address) ??
    coerceRecord(record.location) ??
    (record.street || record.city || record.state || record.postalCode ? record : null);
  const address = extractAddressRecord(nestedAddress);
  const normalizedLines = (() => {
    const tryLines = (candidate: unknown) => {
      if (!Array.isArray(candidate)) {
        return null;
      }
      const lines = candidate
        .map((line) => (typeof line === 'string' ? line.trim() : ''))
        .filter((line) => Boolean(line));
      return lines.length ? lines : null;
    };
    return (
      tryLines(record.lines) ??
      tryLines((nestedAddress as Record<string, unknown> | null)?.lines) ??
      tryLines(record.addressLines) ??
      tryLines(record.linesArray)
    );
  })();
  const contactPhone =
    coerceString(record.contactPhone) ??
    coerceString(record.contact_phone) ??
    coerceString(record.phone) ??
    coerceString(record.phoneNumber);
  const isWhatsapp =
    coerceBoolean(record.isWhatsapp) ??
    coerceBoolean(record.whatsapp) ??
    coerceBoolean(record.is_whatsapp);
  const addressId =
    coerceString(record.addressId) ??
    coerceString(record.address_id) ??
    coerceString(record.addr) ??
    coerceString(record.id);
  const deliveryTip = parseDeliveryTipSnapshot(record.deliveryTip ?? record.delivery_tip);
  const label =
    coerceString(record.addressLabel) ??
    coerceString(record.label) ??
    coerceString(record.nickname) ??
    coerceString(record.alias) ??
    coerceString(record.id);
  if (!address && !contactPhone && !isWhatsapp && !addressId && !deliveryTip) {
    return null;
  }
  return {
    address,
    label: label ?? null,
    lines: normalizedLines,
    contactPhone: contactPhone ?? null,
    isWhatsapp: isWhatsapp ?? null,
    addressId: addressId ?? null,
    deliveryTip,
  };
};

const parseQrPayloadRecord = (value: unknown) => {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === '[object object]') {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

const extractShippingFromQrPayload = (value: unknown): OrderShippingInfo | null => {
  const payload = parseQrPayloadRecord(value);
  if (!payload) {
    return null;
  }
  const shipRecord = coerceRecord(payload.ship ?? payload.shipping);
  if (!shipRecord) {
    return null;
  }
  const linesFromPayload =
    Array.isArray(shipRecord.lines) && shipRecord.lines.length
      ? shipRecord.lines
          .map((line) => (typeof line === 'string' ? line.trim() : ''))
          .filter((line) => Boolean(line))
      : null;
  const contactPhone =
    toTrimmedString(shipRecord.phone) ??
    toTrimmedString(shipRecord.contact) ??
    toTrimmedString(shipRecord.contactPhone) ??
    null;
  const isWhatsapp =
    typeof shipRecord.isw === 'boolean'
      ? shipRecord.isw
      : typeof shipRecord.isWhatsapp === 'boolean'
        ? shipRecord.isWhatsapp
        : null;
  const qrAddressId =
    toTrimmedString(shipRecord.addr) ??
    toTrimmedString(shipRecord.addressId) ??
    toTrimmedString(shipRecord.address_id) ??
    null;
  const addressRecord = coerceRecord(shipRecord.address ?? shipRecord.location) ?? null;
  const derivedAddress =
    addressRecord ||
    shipRecord.street ||
    shipRecord.city ||
    shipRecord.state ||
    shipRecord.postalCode ||
    shipRecord.ref
      ? {
          street: toTrimmedString(addressRecord?.street) ?? toTrimmedString(shipRecord.street) ?? undefined,
          city: toTrimmedString(addressRecord?.city) ?? toTrimmedString(shipRecord.city) ?? undefined,
          state: toTrimmedString(addressRecord?.state) ?? toTrimmedString(shipRecord.state) ?? undefined,
          postalCode:
            toTrimmedString(addressRecord?.postalCode) ??
            toTrimmedString(shipRecord.postalCode) ??
            undefined,
          reference:
            toTrimmedString(addressRecord?.reference) ??
            toTrimmedString(shipRecord.ref) ??
            toTrimmedString(shipRecord.reference) ??
            undefined,
        }
      : undefined;
  const deliveryTipRecord = coerceRecord(payload.dt ?? shipRecord.deliveryTip);
  const deliveryTip =
    parseDeliveryTipSnapshot(deliveryTipRecord) ??
    (typeof shipRecord.tipAmount === 'number' ||
    typeof shipRecord.tipPercent === 'number'
      ? {
          amount: normalizeNumber(shipRecord.tipAmount) ?? null,
          percent: normalizeNumber(shipRecord.tipPercent) ?? null,
        }
      : null);
  const label =
    toTrimmedString(shipRecord.label) ??
    toTrimmedString(shipRecord.alias) ??
    toTrimmedString(shipRecord.addressLabel) ??
    toTrimmedString(shipRecord.nickname) ??
    null;
  return {
    address: derivedAddress,
    label,
    lines: linesFromPayload ?? undefined,
    contactPhone,
    isWhatsapp,
    addressId: qrAddressId,
    deliveryTip,
  };
};

const mergeShippingDetails = (
  base: OrderShippingInfo | null | undefined,
  incoming: OrderShippingInfo
): OrderShippingInfo => {
  if (!base) {
    return incoming;
  }
  const merged: OrderShippingInfo = {
    address: base.address ?? incoming.address,
    label: base.label ?? incoming.label ?? undefined,
    lines:
      base.lines && base.lines.length
        ? base.lines
        : incoming.lines && incoming.lines.length
          ? incoming.lines
          : undefined,
    contactPhone: base.contactPhone ?? incoming.contactPhone ?? null,
    isWhatsapp:
      typeof base.isWhatsapp === 'boolean'
        ? base.isWhatsapp
        : typeof incoming.isWhatsapp === 'boolean'
          ? incoming.isWhatsapp
          : null,
    addressId: base.addressId ?? incoming.addressId ?? null,
    deliveryTip: base.deliveryTip ?? incoming.deliveryTip ?? null,
  };
  if (base.address && incoming.address) {
    merged.address = {
      street: base.address.street ?? incoming.address.street,
      city: base.address.city ?? incoming.address.city,
      state: base.address.state ?? incoming.address.state,
      postalCode: base.address.postalCode ?? incoming.address.postalCode,
      reference: base.address.reference ?? incoming.address.reference,
    };
  }
  return merged;
};

const parseStoredItemsValue = (value: unknown) => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    return value;
  }
  return null;
};

const normalizeShippingPayload = (value: unknown) => {
  const record = coerceRecord(value);
  if (!record) {
    return null;
  }
  const addressRecord = coerceRecord(record.address) ?? null;
  const normalizedAddress =
    addressRecord &&
    ['street', 'city', 'state', 'postalCode', 'reference'].some((key) => {
      const raw = addressRecord?.[key];
      return typeof raw === 'string' && raw.trim().length > 0;
    })
      ? {
          street: toTrimmedString(addressRecord.street) ?? undefined,
          city: toTrimmedString(addressRecord.city) ?? undefined,
          state: toTrimmedString(addressRecord.state) ?? undefined,
          postalCode: toTrimmedString(addressRecord.postalCode) ?? undefined,
          reference: toTrimmedString(addressRecord.reference) ?? undefined,
        }
      : null;
  const contactPhone =
    toTrimmedString(record.contactPhone) ?? toTrimmedString(record.contact_phone);
  const isWhatsapp =
    typeof record.isWhatsapp === 'boolean'
      ? (record.isWhatsapp as boolean)
      : typeof record.whatsapp === 'boolean'
        ? (record.whatsapp as boolean)
        : null;
  const addressId =
    toTrimmedString(record.addressId) ?? toTrimmedString(record.address_id) ?? null;
  const label =
    toTrimmedString(record.addressLabel) ??
    toTrimmedString(record.label) ??
    toTrimmedString(record.nickname) ??
    toTrimmedString(addressRecord?.label) ??
    null;
  const normalizedLines = (() => {
    const digest = (source: unknown) => {
      if (!Array.isArray(source)) {
        return null;
      }
      const list = source
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => Boolean(entry));
      return list.length ? list : null;
    };
    return digest(record.lines) ?? digest(addressRecord?.lines ?? null);
  })();
  const deliveryTipRecord = coerceRecord(record.deliveryTip) ?? coerceRecord(record.delivery_tip);
  const deliveryTipAmount =
    coerceNumber(deliveryTipRecord?.amount) ??
    coerceNumber(deliveryTipRecord?.a) ??
    null;
  const deliveryTipPercent =
    coerceNumber(deliveryTipRecord?.percent) ??
    coerceNumber(deliveryTipRecord?.p) ??
    null;
  return {
    address: normalizedAddress,
    label,
    lines: normalizedLines ?? undefined,
    addressId,
    contactPhone,
    isWhatsapp,
    deliveryTip:
      deliveryTipAmount !== null || deliveryTipPercent !== null
        ? { amount: deliveryTipAmount, percent: deliveryTipPercent }
        : null,
  };
};

type ProductRecord = {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
};

type CashSaleRecord = {
  metodo_pago?: string | null;
  paymentMethod?: string | null;
  monto_recibido?: number | string | null;
  cambio_entregado?: number | string | null;
};

type EnrichedOrderRecord = Record<string, unknown> & {
  paymentMethod?: string | null;
};

type ShippingAddressDetails = {
  address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    reference?: string | null;
  } | null;
  contactPhone?: string | null;
  isWhatsapp?: boolean | null;
};

type OrdersDataLoader = {
  loadProducts: (productIds: Set<string>) => Promise<Map<string, ProductRecord>>;
  loadTicketsAndCodes: (
    orderIds: string[]
  ) => Promise<{
    ticketMap: Map<string, string | null>;
    codeMap: Map<string, string | null>;
    qrMap: Map<string, unknown>;
  }>;
  loadCashSales?: (orderIds: string[]) => Promise<Map<string, CashSaleRecord>>;
  loadAddresses?: (addressIds: string[]) => Promise<Map<string, ShippingAddressDetails>>;
};

const collectProductIds = (rawItems: unknown, target: Set<string>) => {
  const items = Array.isArray(rawItems) ? rawItems : [];
  items.forEach((item) => {
    const productId = item?.productId ?? item?.product_id;
    if (typeof productId === 'string' && productId.trim()) {
      target.add(productId);
    } else if (typeof productId === 'number' && Number.isFinite(productId)) {
      target.add(String(productId));
    }
  });
};

const toTrimmedString = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
};

const coerceMetadataObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const parseStoredOrderItems = (rawItems: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(rawItems)) {
    return rawItems as Array<Record<string, unknown>>;
  }
  if (typeof rawItems === 'string') {
    try {
      const parsed = JSON.parse(rawItems);
      if (Array.isArray(parsed)) {
        return parsed as Array<Record<string, unknown>>;
      }
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { items?: Array<Record<string, unknown>> }).items)
      ) {
        return (parsed as { items: Array<Record<string, unknown>> }).items;
      }
    } catch {
      return [];
    }
  }
  if (rawItems && typeof rawItems === 'object') {
    const record = rawItems as { items?: unknown };
    if (Array.isArray(record.items)) {
      return record.items as Array<Record<string, unknown>>;
    }
  }
  return [];
};

const mapOrderItems = (rawItems: unknown, productMap?: Map<string, ProductRecord>) => {
  const items = parseStoredOrderItems(rawItems);
  return items.map((item) => {
    const rawProductId = item?.productId ?? item?.product_id ?? null;
    const normalizedProductId =
      typeof rawProductId === 'string'
        ? rawProductId
        : typeof rawProductId === 'number' && Number.isFinite(rawProductId)
          ? String(rawProductId)
          : null;
    const inlineDetails: {
      name: string | null;
      category: string | null;
      subcategory: string | null;
    } = {
      name: typeof item?.name === 'string' ? item.name : null,
      category: typeof item?.category === 'string' ? item.category : null,
      subcategory: typeof item?.subcategory === 'string' ? item.subcategory : null,
    };

    const sizeId =
      toTrimmedString(item?.sizeId) ??
      toTrimmedString(item?.size_id) ??
      toTrimmedString(item?.size);
    const sizeLabel =
      toTrimmedString(item?.sizeLabel) ??
      toTrimmedString(item?.size_label) ??
      toTrimmedString(item?.sizeName) ??
      toTrimmedString(item?.size);
    const packageId =
      toTrimmedString(item?.packageId) ??
      toTrimmedString(item?.package_id) ??
      toTrimmedString(item?.bundleId) ??
      toTrimmedString(item?.package);
    const packageName =
      toTrimmedString(item?.packageName) ??
      toTrimmedString(item?.package_name) ??
      toTrimmedString(item?.bundleName);
    const metadata =
      item?.metadata && typeof item.metadata === 'object'
        ? (item.metadata as Record<string, unknown>)
        : null;

    const safeProduct = item?.product && typeof item.product === 'object'
      ? (item.product as Record<string, unknown>)
      : null;

    const productDetails: ProductRecord | null =
      (safeProduct
        ? ({
            name: typeof safeProduct.name === 'string' ? safeProduct.name : null,
            category: typeof safeProduct.category === 'string' ? safeProduct.category : null,
            subcategory: typeof safeProduct.subcategory === 'string' ? safeProduct.subcategory : null,
          } satisfies ProductRecord)
        : null) ??
      (normalizedProductId ? productMap?.get(normalizedProductId) ?? null : null);

    return {
      id: item?.id ?? null,
      productId: normalizedProductId,
      quantity: normalizeQuantity(item?.quantity),
      price: normalizeNumber(item?.price),
      name: inlineDetails.name ?? productDetails?.name ?? null,
      category: inlineDetails.category ?? productDetails?.category ?? null,
      subcategory: inlineDetails.subcategory ?? productDetails?.subcategory ?? null,
      sizeId,
      sizeLabel,
      packageId,
      packageName,
      variantId: toTrimmedString(item?.variantId) ?? null,
      metadata,
    };
  });
};

const countOrderItems = (items: ReturnType<typeof mapOrderItems>) => {
  const total = items.reduce((acc, item) => {
    const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
    return acc + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);

  return total > 0 ? total : items.length;
};

type IncomingOrderItem = {
  productId: string;
  quantity: number;
  price: number;
  name: string | null;
  category: string | null;
  subcategory: string | null;
  sizeId: string | null;
  sizeLabel: string | null;
  packageId: string | null;
  packageName: string | null;
  variantId: string | null;
  metadata: Record<string, unknown> | null;
};

const normalizeOrderItems = (rawItems: unknown): IncomingOrderItem[] => {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const normalized = items
    .map((item) => {
      const rawProductId = item?.productId ?? item?.product_id ?? item?.id ?? null;
      const productId =
        typeof rawProductId === 'string'
          ? rawProductId.trim()
          : typeof rawProductId === 'number' && Number.isFinite(rawProductId)
            ? String(rawProductId)
            : '';

      if (!productId) {
        return null;
      }

      const quantity = normalizeQuantity(item?.quantity ?? item?.qty);
      const price = normalizeNumber(item?.unitPrice ?? item?.price ?? item?.amount) ?? 0;
      const sizeId =
        toTrimmedString(item?.sizeId) ??
        toTrimmedString(item?.size_id) ??
        toTrimmedString(item?.size);
      const sizeLabel =
        toTrimmedString(item?.sizeLabel) ??
        toTrimmedString(item?.size_label) ??
        toTrimmedString(item?.sizeName) ??
        toTrimmedString(item?.size);
      const packageId =
        toTrimmedString(item?.packageId) ??
        toTrimmedString(item?.package_id) ??
        toTrimmedString(item?.bundleId) ??
        toTrimmedString(item?.package);
      const packageName =
        toTrimmedString(item?.packageName) ??
        toTrimmedString(item?.package_name) ??
        toTrimmedString(item?.bundleName);
      const metadata =
        item?.metadata && typeof item.metadata === 'object'
          ? (item.metadata as Record<string, unknown>)
          : null;
      const variantId =
        toTrimmedString(item?.variantId) ??
        toTrimmedString(item?.variant_id) ??
        (metadata && typeof metadata.variantId === 'string'
          ? toTrimmedString(metadata.variantId)
          : null);

      return {
        productId,
        quantity: typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : 1,
        price: Number.isFinite(price) ? price : 0,
        name: typeof item?.name === 'string' ? item.name : null,
        category: typeof item?.category === 'string' ? item.category : null,
        subcategory: typeof item?.subcategory === 'string' ? item.subcategory : null,
        sizeId,
        sizeLabel,
        packageId,
        packageName,
        variantId,
        metadata,
      };
    })
    .filter(Boolean) as IncomingOrderItem[];

  return normalized;
};

const buildProductUpserts = (items: IncomingOrderItem[]): PendingOperation[] => {
  const uniqueIds = new Set<string>();
  const operations: PendingOperation[] = [];
  items.forEach((item) => {
    if (!item.productId || uniqueIds.has(item.productId)) {
      return;
    }
    uniqueIds.add(item.productId);
    const normalizedPrice =
      typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : 0;
    operations.push({
      type: 'upsert',
      table: PRODUCTS_TABLE,
      payload: {
        id: item.productId,
        productId: item.productId,
        name: item.name ?? item.productId,
        category: item.category,
        subcategory: item.subcategory,
        price: normalizedPrice,
      },
      options: { onConflict: 'id' },
    });
  });
  return operations;
};

const buildPendingOrderOperations = (
  orderRecord: Record<string, unknown>,
  orderItemsPayload: Array<Record<string, unknown>>,
  ticketRecord: Record<string, unknown> | null,
  items: IncomingOrderItem[]
): PendingOperation[] => {
  const operations: PendingOperation[] = [];
  operations.push(...buildProductUpserts(items));
  operations.push({
    type: 'upsert',
    table: ORDERS_TABLE,
    payload: orderRecord,
    options: { onConflict: 'id' },
  });
  if (orderRecord.id) {
    operations.push({
      type: 'delete',
      table: ORDER_ITEMS_TABLE,
      match: { orderId: orderRecord.id },
    });
  }
  if (orderItemsPayload.length) {
    operations.push({
      type: 'insert',
      table: ORDER_ITEMS_TABLE,
      payload: orderItemsPayload,
    });
  }
  if (ticketRecord) {
    operations.push({
      type: 'upsert',
      table: TICKETS_TABLE,
      payload: ticketRecord,
      options: { onConflict: 'orderId' },
    });
  }
  return operations;
};

const queueOfflineOrder = async (
  orderRecord: Record<string, unknown>,
  orderItemsPayload: Array<Record<string, unknown>>,
  ticketRecord: Record<string, unknown> | null,
  items: IncomingOrderItem[]
) => {
  return enqueuePendingOperations(
    'orders:create',
    buildPendingOrderOperations(orderRecord, orderItemsPayload, ticketRecord, items),
    {
      orderId: orderRecord.id,
      ticketCode: ticketRecord?.ticketCode ?? null,
    }
  );
};

const mapOrdersPayload = async (
  ordersData: Array<Record<string, unknown>>,
  loader: OrdersDataLoader
) => {
  const productIds = new Set<string>();
  ordersData.forEach((order) => {
    collectProductIds(order?.order_items, productIds);
    collectProductIds(order?.items, productIds);
  });

  const productMap = await loader.loadProducts(productIds);

  let enriched: EnrichedOrderRecord[] = ordersData.map((order) => {
    const {
      order_items,
      items: rawStoredItems,
      totals: rawTotals,
      total,
      user,
      metadata,
      notes,
      message,
      instructions,
      paymentMethod,
      customer_name,
      pos_customer_id,
      deliveryTipAmount,
      deliveryTipPercent,
      shipping_contact_phone,
      shipping_contact_is_whatsapp,
      shipping_address_id,
      ...rest
    } = order as Record<string, unknown> & {
      id?: string;
      order_items?: unknown;
      items?: unknown;
      totals?: unknown;
      total?: unknown;
      user?: Record<string, unknown> | null;
      metadata?: unknown;
      notes?: unknown;
      message?: unknown;
      instructions?: unknown;
      paymentMethod?: unknown;
      customer_name?: unknown;
      pos_customer_id?: unknown;
      deliveryTipAmount?: unknown;
      deliveryTipPercent?: unknown;
      shipping_contact_phone?: unknown;
      shipping_contact_is_whatsapp?: unknown;
      shipping_address_id?: unknown;
    };
    const storedItemsValue = parseStoredItemsValue(rawStoredItems);
    const storedItemsList =
      Array.isArray(storedItemsValue)
        ? storedItemsValue
        : isPlainObject(storedItemsValue) && Array.isArray((storedItemsValue as { list?: unknown[] }).list)
          ? (storedItemsValue as { list: unknown[] }).list
          : null;
    const sourceItems =
      Array.isArray(storedItemsList) && storedItemsList.length
        ? storedItemsList
        : Array.isArray(order_items)
          ? order_items
          : Array.isArray(rawStoredItems)
            ? rawStoredItems
            : [];
    const items = mapOrderItems(sourceItems, productMap);
    const ticketSnapshot = rawStoredItems ?? storedItemsValue ?? null;
    const metadataObject = coerceMetadataObject(metadata);
    const prepAssignment = metadataObject?.prepAssignment
      ? coerceMetadataObject(metadataObject.prepAssignment)
      : null;
    const paymentMetadata = metadataObject?.payment
      ? coerceMetadataObject(metadataObject.payment)
      : null;
    const metadataDeliveryTipPayload =
      metadataObject?.deliveryTip && isPlainObject(metadataObject.deliveryTip)
        ? (metadataObject.deliveryTip as Record<string, unknown>)
        : null;
    const metadataDeliveryPayload =
      metadataObject?.delivery && isPlainObject(metadataObject.delivery)
        ? (metadataObject.delivery as Record<string, unknown>)
        : null;
    const metadataDeliveryTipAmount = coerceNumber(
      metadataObject?.deliveryTipAmount ??
        metadataDeliveryTipPayload?.amount ??
        metadataDeliveryTipPayload?.a ??
        metadataDeliveryPayload?.tipAmount
    );
    const metadataDeliveryTipPercent = coerceNumber(
      metadataObject?.deliveryTipPercent ??
        metadataDeliveryTipPayload?.percent ??
        metadataDeliveryTipPayload?.p ??
        metadataDeliveryPayload?.tipPercent
    );
    const metadataDeliveryTipSnapshot =
      parseDeliveryTipSnapshot(metadataDeliveryTipPayload) ??
      parseDeliveryTipSnapshot(metadataDeliveryPayload?.tip) ??
      (metadataDeliveryTipAmount !== null || metadataDeliveryTipPercent !== null
        ? {
            amount: metadataDeliveryTipAmount,
            percent: metadataDeliveryTipPercent,
          }
        : null);
    const storedShippingSnapshot =
      isPlainObject(storedItemsValue) && 'shipping' in (storedItemsValue as Record<string, unknown>)
        ? parseShippingSnapshot((storedItemsValue as Record<string, unknown>).shipping)
        : null;
    const metadataShippingSnapshot =
      metadataObject?.shipping && isPlainObject(metadataObject.shipping)
        ? parseShippingSnapshot(metadataObject.shipping)
        : null;
    const metadataDeliverySnapshot =
      metadataObject?.delivery && isPlainObject(metadataObject.delivery)
        ? parseShippingSnapshot(metadataObject.delivery)
        : null;
    const shippingSnapshot =
      storedShippingSnapshot ?? metadataShippingSnapshot ?? metadataDeliverySnapshot ?? null;
    const resolvedContactPhone =
      coerceString(shipping_contact_phone) ?? shippingSnapshot?.contactPhone ?? null;
    const resolvedIsWhatsapp =
      coerceBoolean(shipping_contact_is_whatsapp) ?? shippingSnapshot?.isWhatsapp ?? null;
    const metadataAddressId = coerceString(metadataObject?.deliveryAddressId);
    const shippingAddressId =
      coerceString(shipping_address_id) ?? shippingSnapshot?.addressId ?? metadataAddressId ?? null;
  const shippingPayload =
    shippingSnapshot ||
    shippingAddressId ||
    resolvedContactPhone ||
    resolvedIsWhatsapp !== null ||
    metadataDeliveryTipSnapshot
      ? {
          address: shippingSnapshot?.address ?? undefined,
          label: shippingSnapshot?.label ?? undefined,
          lines: shippingSnapshot?.lines ?? undefined,
          contactPhone: resolvedContactPhone,
          isWhatsapp: resolvedIsWhatsapp,
          addressId: shippingAddressId,
          deliveryTip: shippingSnapshot?.deliveryTip ?? metadataDeliveryTipSnapshot ?? null,
        }
        : null;
    const totalsSnapshot =
      coerceRecord(rawTotals) ??
      (isPlainObject(storedItemsValue) ? coerceRecord((storedItemsValue as Record<string, unknown>).totals) : null);
    const normalizedCustomerName = coerceString(customer_name);
    const normalizedPosCustomerId = coerceString(pos_customer_id);
    const resolvedDeliveryTipAmount =
      normalizeNumber(deliveryTipAmount ?? null) ??
      metadataDeliveryTipAmount ??
      (shippingPayload?.deliveryTip?.amount ?? null);
    const resolvedDeliveryTipPercent =
      normalizeNumber(deliveryTipPercent ?? null) ??
      metadataDeliveryTipPercent ??
      (shippingPayload?.deliveryTip?.percent ?? null);
    return {
      ...rest,
      id: rest.id ?? order.id ?? null,
      total: normalizeNumber(total),
      items,
      itemsCount: countOrderItems(items),
      user: withDecryptedUserNames(user ?? null),
      metadata: metadata ?? null,
      totals: totalsSnapshot ?? null,
      ticketSnapshot,
      notes: toTrimmedString(notes) ?? null,
      message: toTrimmedString(message) ?? null,
      instructions: toTrimmedString(instructions) ?? null,
      customerName: normalizedCustomerName ?? null,
      posCustomerId: normalizedPosCustomerId ?? null,
      shipping: shippingPayload,
      deliveryTipAmount: resolvedDeliveryTipAmount,
      deliveryTipPercent: resolvedDeliveryTipPercent,
      queuedByStaffId: toTrimmedString(prepAssignment?.staffId) ?? null,
      queuedByStaffName: toTrimmedString(prepAssignment?.staffName) ?? null,
      queuedPaymentReference: toTrimmedString(paymentMetadata?.reference) ?? null,
      queuedPaymentReferenceType: toTrimmedString(paymentMetadata?.referenceType) ?? null,
      paymentMethod: typeof paymentMethod === 'string' ? paymentMethod : null,
    };
  });

  if (!enriched.length) {
    return enriched;
  }

  const addressIdsToHydrate = new Set<string>();
  enriched.forEach((order) => {
    const shipping = (order.shipping ?? null) as Record<string, unknown> | null;
    if (!shipping) {
      return;
    }
    const rawAddressId = shipping['addressId'];
    const legacyAddressId = shipping['address_id'];
    const addressId =
      toTrimmedString(
        typeof rawAddressId === 'string'
          ? rawAddressId
          : typeof legacyAddressId === 'string'
            ? legacyAddressId
            : null
      ) ?? null;
    if (!addressId) {
      return;
    }
    const addressObject = isPlainObject(shipping.address) ? (shipping.address as Record<string, unknown>) : null;
    const hasAddressDetails =
      addressObject &&
      ['street', 'city', 'state', 'postalCode', 'reference'].some((key) => {
        const value = addressObject?.[key];
        return typeof value === 'string' && value.trim().length > 0;
      });
    if (!hasAddressDetails) {
      addressIdsToHydrate.add(addressId);
    }
  });

  if (addressIdsToHydrate.size && loader.loadAddresses) {
    try {
      const addressMap = await loader.loadAddresses(Array.from(addressIdsToHydrate));
      if (addressMap.size) {
        enriched = enriched.map((order) => {
          const shipping = (order.shipping ?? null) as Record<string, unknown> | null;
          if (!shipping) {
            return order;
          }
          const rawAddressId = shipping['addressId'];
          const legacyAddressId = shipping['address_id'];
          const addressId =
            toTrimmedString(
              typeof rawAddressId === 'string'
                ? rawAddressId
                : typeof legacyAddressId === 'string'
                  ? legacyAddressId
                  : null
            ) ?? null;
          if (!addressId) {
            return order;
          }
          const lookup = addressMap.get(addressId);
          if (!lookup) {
            return order;
          }
          const shippingAddressValue = shipping['address'];
          const addressObject = isPlainObject(shippingAddressValue)
            ? (shippingAddressValue as Record<string, unknown>)
            : null;
          const fallbackAddress = lookup.address ?? null;
          const normalizedAddress =
            addressObject || fallbackAddress
              ? {
                  street:
                    toTrimmedString(addressObject?.street) ?? toTrimmedString(fallbackAddress?.street),
                  city: toTrimmedString(addressObject?.city) ?? toTrimmedString(fallbackAddress?.city),
                  state: toTrimmedString(addressObject?.state) ?? toTrimmedString(fallbackAddress?.state),
                  postalCode:
                    toTrimmedString(addressObject?.postalCode) ??
                    toTrimmedString(fallbackAddress?.postalCode),
                  reference:
                    toTrimmedString(addressObject?.reference) ??
                    toTrimmedString(fallbackAddress?.reference),
                }
              : undefined;
          const contactPhoneValue =
            typeof shipping['contactPhone'] === 'string'
              ? shipping['contactPhone']
              : typeof shipping['contact_phone'] === 'string'
                ? shipping['contact_phone']
                : null;
          const mergedShipping = {
            ...shipping,
            address: normalizedAddress,
            contactPhone:
              toTrimmedString(contactPhoneValue) ??
              lookup.contactPhone ??
              null,
            isWhatsapp:
              typeof shipping['isWhatsapp'] === 'boolean'
                ? (shipping['isWhatsapp'] as boolean)
                : typeof lookup.isWhatsapp === 'boolean'
                  ? lookup.isWhatsapp
                  : typeof shipping['whatsapp'] === 'boolean'
                    ? (shipping['whatsapp'] as boolean)
                    : null,
            addressId,
          };
          return {
            ...order,
            shipping: mergedShipping,
          };
        });
      }
    } catch (error) {
      console.warn('No pudimos hidratar direcciones de envío:', error);
    }
  }

  const orderIds = enriched
    .map((order) => order.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  const { ticketMap, codeMap, qrMap } = await loader.loadTicketsAndCodes(orderIds);

  enriched = enriched.map((order) => {
    const orderId = typeof order.id === 'string' ? order.id : null;
    const qrPayload = orderId ? qrMap.get(orderId) ?? null : null;
    const qrShipping = extractShippingFromQrPayload(qrPayload);
    let mergedShipping: OrderShippingInfo | null | undefined =
      (order.shipping as OrderShippingInfo | null | undefined) ?? null;
    if (qrShipping) {
      mergedShipping = mergeShippingDetails(mergedShipping, qrShipping);
    }
    const resolvedDeliveryTipAmount =
      order.deliveryTipAmount ?? qrShipping?.deliveryTip?.amount ?? null;
    const resolvedDeliveryTipPercent =
      order.deliveryTipPercent ?? qrShipping?.deliveryTip?.percent ?? null;
    return {
      ...order,
      ticketCode: orderId ? ticketMap.get(orderId) || null : null,
      shortCode: orderId ? codeMap.get(orderId) || null : null,
      qrPayload,
      shipping: mergedShipping ?? order.shipping ?? null,
      deliveryTipAmount: resolvedDeliveryTipAmount,
      deliveryTipPercent: resolvedDeliveryTipPercent,
    };
  });

  const cashSalesMap =
    loader.loadCashSales && enriched.length
      ? await loader.loadCashSales(
          enriched
            .map((order) => order.id)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        )
      : new Map<string, CashSaleRecord>();

  enriched = enriched.map((order) => {
    const orderId = typeof order.id === 'string' ? order.id : null;
    const sale = orderId ? cashSalesMap.get(orderId) : null;
    const saleMethod =
      toTrimmedString(sale?.metodo_pago ?? sale?.paymentMethod) ??
      (typeof order.paymentMethod === 'string' ? order.paymentMethod : null);
    const saleTendered = sale ? normalizeNumber(sale.monto_recibido) : null;
    const saleChange = sale ? normalizeNumber(sale.cambio_entregado) : null;
    return {
      ...order,
      paymentMethod: saleMethod ?? order.paymentMethod ?? null,
      metodoPago: saleMethod ?? null,
      montoRecibido: saleTendered,
      cambioEntregado: saleChange,
    };
  });

  return enriched;
};

const buildSqliteInClause = (values: string[], prefix: string) => {
  const placeholders = values.map((_, index) => `:${prefix}${index}`);
  const bindings: Record<string, string> = {};
  values.forEach((value, index) => {
    bindings[`:${prefix}${index}`] = value;
  });
  return { placeholders, bindings };
};

type SqliteOrderRow = {
  id: string;
  userId?: string | null;
  orderNumber?: string | null;
  status?: string | null;
  total?: number | null;
  currency?: string | null;
  items?: unknown;
  totals?: unknown;
  createdAt?: string | null;
  updatedAt?: string | null;
  queuedPaymentMethod?: string | null;
  tipAmount?: number | null;
  tipPercent?: number | null;
  deliveryTipAmount?: number | null;
  deliveryTipPercent?: number | null;
  metadata?: unknown;
  notes?: unknown;
  message?: unknown;
  instructions?: unknown;
  customer_name?: string | null;
  pos_customer_id?: string | null;
  shipping_contact_phone?: string | null;
  shipping_contact_is_whatsapp?: number | null;
  shipping_address_id?: string | null;
  user_clientId?: string | null;
  user_email?: string | null;
  user_firstNameEncrypted?: string | null;
  user_firstNameIv?: string | null;
  user_firstNameTag?: string | null;
  user_firstNameSalt?: string | null;
  user_lastNameEncrypted?: string | null;
  user_lastNameIv?: string | null;
  user_lastNameTag?: string | null;
  user_lastNameSalt?: string | null;
  user_phoneEncrypted?: string | null;
  user_phoneIv?: string | null;
  user_phoneTag?: string | null;
  user_phoneSalt?: string | null;
};

const parseOrderItemsColumn = (value: unknown) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const buildLocalOrderUser = (row: SqliteOrderRow) => {
  const userPayload = {
    firstNameEncrypted: row.user_firstNameEncrypted ?? null,
    firstNameIv: row.user_firstNameIv ?? null,
    firstNameTag: row.user_firstNameTag ?? null,
    firstNameSalt: row.user_firstNameSalt ?? null,
    lastNameEncrypted: row.user_lastNameEncrypted ?? null,
    lastNameIv: row.user_lastNameIv ?? null,
    lastNameTag: row.user_lastNameTag ?? null,
    lastNameSalt: row.user_lastNameSalt ?? null,
    phoneEncrypted: row.user_phoneEncrypted ?? null,
    phoneIv: row.user_phoneIv ?? null,
    phoneTag: row.user_phoneTag ?? null,
    phoneSalt: row.user_phoneSalt ?? null,
    clientId: row.user_clientId ?? null,
    email: row.user_email ?? null,
  };
  const hasData = Object.values(userPayload).some((value) => Boolean(value));
  return hasData ? userPayload : null;
};

const loadLocalOrderItems = async (orderIds: string[]) => {
  if (!orderIds.length) {
    return new Map<string, Array<Record<string, unknown>>>();
  }
  const { placeholders, bindings } = buildSqliteInClause(orderIds, 'order');
  const rows = await sqlite.all<{
    orderId?: string | null;
    id?: string | null;
    productId?: string | null;
    quantity?: number | null;
    price?: number | null;
  }>(
    `SELECT orderId, id, productId, quantity, price FROM order_items WHERE orderId IN (${placeholders.join(',')})`,
    bindings
  );
  const map = new Map<string, Array<Record<string, unknown>>>();
  rows.forEach((row) => {
    if (!row.orderId) {
      return;
    }
    const normalized: Record<string, unknown> = {
      id: row.id ?? null,
      productId: row.productId ?? null,
      quantity: row.quantity ?? null,
      price: row.price ?? null,
    };
    const current = map.get(row.orderId) ?? [];
    current.push(normalized);
    map.set(row.orderId, current);
  });
  return map;
};

const sqliteOrdersLoader: OrdersDataLoader = {
  loadProducts: async (productIds) => {
    if (!productIds.size) {
      return new Map();
    }
    const values = Array.from(productIds);
    const { placeholders, bindings } = buildSqliteInClause(values, 'prod');
    const rows = await sqlite.all<{
      id?: string | null;
      productId?: string | null;
      name?: string | null;
      category?: string | null;
      subcategory?: string | null;
    }>(
      `SELECT id, productId, name, category, subcategory
       FROM products
       WHERE id IN (${placeholders.join(',')}) OR productId IN (${placeholders.join(',')})`,
      bindings
    );
    const map = new Map<string, ProductRecord>();
    rows.forEach((row) => {
      const record: ProductRecord = {
        id: row.id ?? row.productId ?? null,
        name: row.name ?? null,
        category: row.category ?? null,
        subcategory: row.subcategory ?? null,
      };
      if (row.id) {
        map.set(String(row.id), record);
      }
      if (row.productId) {
        map.set(String(row.productId), record);
      }
    });
    return map;
  },
  loadTicketsAndCodes: async (orderIds) => {
    if (!orderIds.length) {
      return { ticketMap: new Map(), codeMap: new Map(), qrMap: new Map() };
    }
    const { placeholders, bindings } = buildSqliteInClause(orderIds, 'ticket');
    const [tickets, codes] = await Promise.all([
      sqlite.all<{ orderId?: string | null; ticketCode?: string | null; qrPayload?: unknown }>(
        `SELECT orderId, ticketCode, qrPayload FROM tickets WHERE orderId IN (${placeholders.join(',')})`,
        bindings
      ),
      sqlite.all<{ orderId?: string | null; code?: string | null }>(
        `SELECT orderId, code FROM order_codes WHERE orderId IN (${placeholders.join(',')})`,
        bindings
      ),
    ]);
    const ticketMap = new Map<string, string | null>();
    const qrMap = new Map<string, unknown>();
    tickets
      .filter((ticket) => ticket.orderId)
      .forEach((ticket) => {
        const key = String(ticket.orderId);
        ticketMap.set(key, ticket.ticketCode ?? null);
        qrMap.set(key, ticket.qrPayload ?? null);
      });
    return {
      ticketMap,
      codeMap: new Map(
        codes.filter((code) => code.orderId).map((code) => [String(code.orderId), code.code ?? null])
      ),
      qrMap,
    };
  },
  loadCashSales: async () => new Map<string, CashSaleRecord>(),
  loadAddresses: async (addressIds) => {
    const map = new Map<string, ShippingAddressDetails>();
    if (!addressIds.length) {
      return map;
    }
    const { placeholders, bindings } = buildSqliteInClause(addressIds, 'addr');
    const rows = await sqlite.all<{
      id?: string | null;
      userId?: string | null;
      street?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      country?: string | null;
      reference?: string | null;
      additionalInfo?: string | null;
      label?: string | null;
      nickname?: string | null;
      payload?: string | null;
      payload_iv?: string | null;
      payload_tag?: string | null;
      payload_salt?: string | null;
      contactPhone?: string | null;
      isWhatsapp?: number | null;
      createdAt?: string | null;
      updatedAt?: string | null;
      email?: string | null;
    }>(
      `SELECT a.id,
              a.userId,
              a.street,
              a.city,
              a.state,
              a.postalCode,
              a.country,
              a.reference,
              a.additionalInfo,
              a.label,
              a.nickname,
              a.payload,
              a.payload_iv,
              a.payload_tag,
              a.payload_salt,
              a.contactPhone,
              a.isWhatsapp,
              a.createdAt,
              a.updatedAt,
              u.email
       FROM addresses a
       LEFT JOIN users u ON u.id = a.userId
       WHERE a.id IN (${placeholders.join(',')})`,
      bindings
    );
    rows.forEach((row) => {
      if (!row?.id) {
        return;
      }
      const normalized = decryptAddressRow(
        {
          id: row.id,
          userId: row.userId,
          street: row.street,
          city: row.city,
          state: row.state,
          postalCode: row.postalCode,
          country: row.country,
          reference: row.reference,
          additionalInfo: row.additionalInfo,
          label: row.label,
          nickname: row.nickname,
          payload: row.payload,
          payload_iv: row.payload_iv,
          payload_tag: row.payload_tag,
          payload_salt: row.payload_salt,
          contactPhone: row.contactPhone,
          isWhatsapp:
            typeof row.isWhatsapp === 'number' ? row.isWhatsapp === 1 : row.isWhatsapp ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        row.email ?? null
      );
      if (!normalized) {
        return;
      }
      map.set(row.id, {
        address: {
          street: normalized.street ?? null,
          city: normalized.city ?? null,
          state: normalized.state ?? null,
          postalCode: normalized.postalCode ?? null,
          reference: normalized.reference ?? null,
        },
        contactPhone: normalized.contactPhone ?? null,
        isWhatsapp: normalized.isWhatsapp ?? null,
      });
    });
    return map;
  },
};

const supabaseOrdersLoader: OrdersDataLoader = {
  loadProducts: async (productIds) => {
    if (!productIds.size) {
      return new Map();
    }
    const { data: products, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .select('id,name,category,subcategory')
      .in('id', Array.from(productIds));
    if (error) {
      console.error('Error fetching products for orders:', error);
      return new Map();
    }
    return new Map(
      (products ?? [])
        .filter((product) => product?.id)
        .map((product) => [String(product.id), product as ProductRecord])
    );
  },
  loadTicketsAndCodes: async (orderIds) => {
    if (!orderIds.length) {
      return { ticketMap: new Map(), codeMap: new Map(), qrMap: new Map() };
    }
    const [{ data: tickets, error: ticketsError }, { data: codes, error: codesError }] = await Promise.all([
      supabaseAdmin.from(TICKETS_TABLE).select('"orderId","ticketCode","qrPayload"').in('orderId', orderIds),
      supabaseAdmin.from(ORDER_CODES_TABLE).select('"orderId",code').in('orderId', orderIds),
    ]);

    if (ticketsError) {
      console.error('Error fetching tickets:', ticketsError);
    }
    if (codesError) {
      console.error('Error fetching order codes:', codesError);
    }

    const ticketMap = new Map<string, string | null>();
    const qrMap = new Map<string, unknown>();
    (tickets ?? []).forEach((ticket) => {
      if (ticket?.orderId) {
        ticketMap.set(ticket.orderId, ticket.ticketCode ?? null);
        qrMap.set(ticket.orderId, ticket.qrPayload ?? null);
      }
    });

    return {
      ticketMap,
      codeMap: new Map((codes ?? []).map((code) => [code.orderId, code.code ?? null])),
      qrMap,
    };
  },
  loadCashSales: async (orderIds) => {
    const map = new Map<string, CashSaleRecord>();
    if (!orderIds.length) {
      return map;
    }
    const { data, error } = await supabaseAdmin
      .from(VENTAS_TABLE)
      .select('order_id,metodo_pago,monto_recibido,cambio_entregado')
      .in('order_id', orderIds);

    if (error) {
      throw new Error(`Failed to fetch ventas: ${error.message}`);
    }

    (data ?? []).forEach((row) => {
      const orderId = typeof row.order_id === 'string' ? row.order_id : null;
      if (orderId) {
        map.set(orderId, {
          metodo_pago: row.metodo_pago,
          monto_recibido: row.monto_recibido,
          cambio_entregado: row.cambio_entregado,
        });
      }
    });
    return map;
  },
  loadAddresses: async (addressIds) => {
    const map = new Map<string, ShippingAddressDetails>();
    if (!addressIds.length) {
      return map;
    }
    type AddressRowResponse = Record<string, unknown> & {
      id: string;
      userId?: string | null;
      user?:
        | { id?: string | null; email?: string | null }
        | { id?: string | null; email?: string | null }[]
        | null;
    };
    let { data, error } = await supabaseAdmin
      .from(ADDRESSES_TABLE)
      .select('*,user:users(id,email)')
      .in('id', addressIds)
      .returns<AddressRowResponse[] | null>();

    if (error) {
      console.error('No pudimos recuperar direcciones de envío:', error);
      return map;
    }
    (data ?? []).forEach((row) => {
      if (!row?.id) {
        return;
      }
      const userRecord = Array.isArray(row?.user) ? row.user[0] : row?.user ?? null;
      const email = typeof userRecord?.email === 'string' ? userRecord.email : null;
      const normalized = decryptAddressRow(
        {
          id: row.id,
          userId: row.userId ?? (typeof userRecord?.id === 'string' ? userRecord.id : null),
          label: typeof row.label === 'string' ? row.label : null,
          nickname: typeof row.nickname === 'string' ? row.nickname : null,
          type: typeof row.type === 'string' ? row.type : null,
          street: typeof row.street === 'string' ? row.street : null,
          city: typeof row.city === 'string' ? row.city : null,
          state: typeof row.state === 'string' ? row.state : null,
          postalCode:
            typeof row.postalCode === 'string'
              ? row.postalCode
              : typeof (row as { postalcode?: string }).postalcode === 'string'
                ? (row as { postalcode?: string }).postalcode
                : null,
          country: typeof row.country === 'string' ? row.country : null,
          reference: typeof row.reference === 'string' ? row.reference : null,
          additionalInfo:
            typeof row.additionalInfo === 'string' ? row.additionalInfo : null,
          payload: typeof row.payload === 'string' ? row.payload : null,
          payload_iv: typeof row.payload_iv === 'string' ? row.payload_iv : null,
          payload_tag: typeof row.payload_tag === 'string' ? row.payload_tag : null,
          payload_salt: typeof row.payload_salt === 'string' ? row.payload_salt : null,
          isDefault:
            typeof row.isDefault === 'boolean'
              ? row.isDefault
              : typeof (row as { isdefault?: boolean }).isdefault === 'boolean'
                ? (row as { isdefault?: boolean }).isdefault
                : null,
          contactPhone:
            typeof row.contactPhone === 'string'
              ? row.contactPhone
              : typeof (row as { contactphone?: string }).contactphone === 'string'
                ? (row as { contactphone?: string }).contactphone
                : null,
          isWhatsapp:
            typeof row.isWhatsapp === 'boolean'
              ? row.isWhatsapp
              : typeof (row as { iswhatsapp?: boolean }).iswhatsapp === 'boolean'
                ? (row as { iswhatsapp?: boolean }).iswhatsapp
                : null,
          createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
          updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
        },
        email
      );
      if (!normalized) {
        return;
      }
      map.set(row.id, {
        address: {
          street: normalized.street ?? null,
          city: normalized.city ?? null,
          state: normalized.state ?? null,
          postalCode: normalized.postalCode ?? null,
          reference: normalized.reference ?? null,
        },
        contactPhone: normalized.contactPhone ?? null,
        isWhatsapp: normalized.isWhatsapp ?? null,
      });
    });
    return map;
  },
};

const loadOrdersFromSupabase = async (status: string | null) => {
  const orderSelectFields = [
    'id',
    '"userId"',
    '"orderNumber"',
    'status',
    'total',
    'currency',
    '"items"',
    '"totals"',
    '"createdAt"',
    '"updatedAt"',
    '"queuedPaymentMethod"',
    '"tipAmount"',
    '"tipPercent"',
    '"deliveryTipAmount"',
    '"deliveryTipPercent"',
    '"metadata"',
    '"notes"',
    '"message"',
    '"instructions"',
    '"customer_name"',
    '"pos_customer_id"',
    '"shipping_contact_phone"',
    '"shipping_contact_is_whatsapp"',
    '"shipping_address_id"',
  ];
  if (ORDER_CLIENT_ID_COLUMN) {
    orderSelectFields.push(`clientId:${ORDER_CLIENT_ID_COLUMN}`);
  }
  orderSelectFields.push(
    [
      'user:users(',
      [
        '"firstNameEncrypted"',
        '"firstNameIv"',
        '"firstNameTag"',
        '"firstNameSalt"',
        '"lastNameEncrypted"',
        '"lastNameIv"',
        '"lastNameTag"',
        '"lastNameSalt"',
        '"phoneEncrypted"',
        '"phoneIv"',
        '"phoneTag"',
        '"phoneSalt"',
        '"clientId"',
        '"email"',
      ].join(','),
      ')',
    ].join('')
  );
  orderSelectFields.push(`order_items:${ORDER_ITEMS_TABLE}(id,"productId",quantity,price)`);

  let query = supabaseAdmin
    .from(ORDERS_TABLE)
    .select(orderSelectFields.join(','))
    .order('createdAt', { ascending: false })
    .limit(MAX_RESULTS);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const ordersData = (
    Array.isArray(data) ? data.filter((row) => !!row && typeof row === 'object' && !('error' in row)) : []
  ) as Array<Record<string, unknown>>;

  return mapOrdersPayload(ordersData, supabaseOrdersLoader);
};

const loadOrdersFromSqlite = async (status: string | null) => {
  const bindings: Record<string, string | number> = { ':limit': MAX_RESULTS };
  const conditions: string[] = [];
  if (status) {
    conditions.push('o.status = :status');
    bindings[':status'] = status;
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await sqlite.all<SqliteOrderRow>(
    `SELECT
      o.id,
      o.userId,
      o.orderNumber,
      o.status,
      o.total,
      o.currency,
      o.items,
      o.totals,
      o.createdAt,
      o.updatedAt,
      o.queuedPaymentMethod,
      o.tipAmount,
      o.tipPercent,
      o.deliveryTipAmount,
      o.deliveryTipPercent,
      o.metadata,
      o.notes,
      o.message,
      o.instructions,
      o.customer_name,
      o.pos_customer_id,
      o.shipping_contact_phone,
      o.shipping_contact_is_whatsapp,
      o.shipping_address_id,
      u.clientId AS user_clientId,
      u.email AS user_email,
      u.firstNameEncrypted AS user_firstNameEncrypted,
      u.firstNameIv AS user_firstNameIv,
      u.firstNameTag AS user_firstNameTag,
      u.firstNameSalt AS user_firstNameSalt,
      u.lastNameEncrypted AS user_lastNameEncrypted,
      u.lastNameIv AS user_lastNameIv,
      u.lastNameTag AS user_lastNameTag,
      u.lastNameSalt AS user_lastNameSalt,
      u.phoneEncrypted AS user_phoneEncrypted,
      u.phoneIv AS user_phoneIv,
      u.phoneTag AS user_phoneTag,
      u.phoneSalt AS user_phoneSalt
    FROM orders o
    LEFT JOIN users u ON u.id = o.userId
    ${whereClause}
    ORDER BY o.createdAt DESC
    LIMIT :limit`,
    bindings
  );

  if (!rows.length) {
    return [];
  }

  const orderIds = rows.map((row) => row.id);
  const orderItemsMap = await loadLocalOrderItems(orderIds);

  const normalizedRows = rows.map((row) => {
    const payload: Record<string, unknown> = {
      id: row.id,
      userId: row.userId ?? null,
      orderNumber: row.orderNumber ?? null,
      status: row.status ?? null,
      total: row.total ?? null,
      currency: row.currency ?? null,
      items: parseOrderItemsColumn(row.items),
      totals: row.totals ?? null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      queuedPaymentMethod: row.queuedPaymentMethod ?? null,
      tipAmount: row.tipAmount ?? null,
      tipPercent: row.tipPercent ?? null,
      deliveryTipAmount: row.deliveryTipAmount ?? null,
      deliveryTipPercent: row.deliveryTipPercent ?? null,
      metadata: row.metadata ?? null,
      notes: row.notes ?? null,
      message: row.message ?? null,
      instructions: row.instructions ?? null,
      customer_name: row.customer_name ?? null,
      pos_customer_id: row.pos_customer_id ?? null,
      shipping_contact_phone: row.shipping_contact_phone ?? null,
      shipping_contact_is_whatsapp: row.shipping_contact_is_whatsapp ?? null,
      shipping_address_id: row.shipping_address_id ?? null,
      order_items: orderItemsMap.get(row.id) ?? [],
      user: buildLocalOrderUser(row),
    };
    if (!payload.clientId && row.user_clientId) {
      payload.clientId = row.user_clientId;
    }
    return payload;
  });

  return mapOrdersPayload(normalizedRows, sqliteOrdersLoader);
};

const ensureProducts = async (items: IncomingOrderItem[]) => {
  const productIds = Array.from(new Set(items.map((item) => item.productId))).filter(Boolean);
  if (!productIds.length) {
    return;
  }

  const [existingByIdResult, existingByProductIdResult] = await Promise.all([
    supabaseAdmin.from(PRODUCTS_TABLE).select('id,"productId"').in('id', productIds),
    supabaseAdmin.from(PRODUCTS_TABLE).select('id,"productId"').in('productId', productIds),
  ]);

  const { data: existingById, error: existingByIdError } = existingByIdResult;
  if (existingByIdError) {
    throw new Error(`Failed to fetch products: ${existingByIdError.message}`);
  }

  const { data: existingByProductId, error: existingByProductIdError } = existingByProductIdResult;
  if (existingByProductIdError) {
    throw new Error(`Failed to fetch products by productId: ${existingByProductIdError.message}`);
  }

  const existingIds = new Set<string>();
  [...(existingById ?? []), ...(existingByProductId ?? [])].forEach((product) => {
    if (product.id) {
      existingIds.add(String(product.id));
    }
    if (product.productId) {
      existingIds.add(String(product.productId));
    }
  });
  const insertsMap = new Map<string, IncomingOrderItem>();
  items.forEach((item) => {
    if (!existingIds.has(item.productId) && !insertsMap.has(item.productId)) {
      insertsMap.set(item.productId, item);
    }
  });

  if (!insertsMap.size) {
    return;
  }

  const newProducts = Array.from(insertsMap.values()).map((item) => ({
    id: item.productId,
    productId: item.productId,
    name: item.name ?? item.productId,
    category: item.category,
    subcategory: item.subcategory,
    price: Number.isFinite(item.price) ? item.price : 0,
  }));

  const { error: insertError } = await supabaseAdmin.from(PRODUCTS_TABLE).insert(newProducts);
  if (insertError) {
    throw new Error(`Failed to insert products: ${insertError.message}`);
  }
};

export async function GET(request: Request) {
  try {
    await flushPendingOperations();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    try {
      const remoteData = await loadOrdersFromSupabase(status);
      markSupabaseHealthy();
      return NextResponse.json({ success: true, data: remoteData });
    } catch (error) {
      if (!isLikelyNetworkError(error)) {
        throw error;
      }
      markSupabaseFailure(error);
      const localData = await loadOrdersFromSqlite(status);
      return NextResponse.json({ success: true, data: localData });
    }
  } catch (error) {
    if (isLikelyNetworkError(error)) {
      markSupabaseFailure(error);
      return NextResponse.json(
        { success: false, error: 'Supabase no disponible. Intentaremos sincronizar en cuanto vuelva.' },
        { status: 503 }
      );
    }
    console.error('Error fetching orders:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await flushPendingOperations();

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }

    const providedOrderId =
      typeof payload.orderId === 'string' && payload.orderId.trim() ? payload.orderId.trim() : null;
    const fallbackTicketCode =
      typeof payload.ticketCode === 'string' && payload.ticketCode.trim()
        ? payload.ticketCode.trim()
        : null;
    const ticketCode = fallbackTicketCode ?? generateTicketCode();
    const orderId = providedOrderId ?? fallbackTicketCode ?? randomUUID();

    const status = typeof payload.status === 'string' ? payload.status : 'pending';
    const currency = typeof payload.currency === 'string' ? payload.currency : 'MXN';
    const paymentMethod =
      typeof payload.paymentMethod === 'string'
        ? payload.paymentMethod
        : payload?.ticket?.paymentMethod ?? null;

    const subtotal = normalizeNumber(payload?.totals?.subtotal);
    const tax = normalizeNumber(payload?.totals?.tax);
    const total = normalizeNumber(payload?.totals?.total) ?? subtotal ?? 0;
    const tipAmount =
      normalizeNumber(payload?.totals?.tip) ??
      normalizeNumber(payload?.tip?.amount) ??
      null;
    const tipPercent = normalizeNumber(payload?.tip?.percent);
    const payloadUserId =
      typeof payload.userId === 'string' && payload.userId.trim() ? payload.userId.trim() : null;
    const clientId =
      typeof payload.clientId === 'string' && payload.clientId.trim() ? payload.clientId.trim() : null;
    const userId =
      payloadUserId ??
      (clientId &&
      PUBLIC_SALE_CLIENT_ID &&
      PUBLIC_SALE_USER_ID &&
      clientId.toLowerCase() === PUBLIC_SALE_CLIENT_ID.toLowerCase()
        ? PUBLIC_SALE_USER_ID
        : null);

    const normalizedClientId = clientId?.toLowerCase() ?? null;
    const normalizedPublicClient = PUBLIC_SALE_CLIENT_ID?.toLowerCase() ?? null;
    const normalizedPublicUserId = PUBLIC_SALE_USER_ID?.toLowerCase() ?? null;
    const isPublicSaleContext =
      (normalizedClientId && normalizedPublicClient && normalizedClientId === normalizedPublicClient) ||
      (payloadUserId && normalizedPublicUserId && payloadUserId.toLowerCase() === normalizedPublicUserId);

    const items = normalizeOrderItems(payload?.items);

    if (!items.length) {
      return NextResponse.json(
        { success: false, error: 'At least one order item is required' },
        { status: 400 }
      );
    }

    const orderItemsSnapshot = items.map((item) => ({
      productId: item.productId,
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      quantity: item.quantity,
      price: item.price,
      sizeId: item.sizeId,
      sizeLabel: item.sizeLabel,
      variantId: item.variantId,
      packageId: item.packageId,
      packageName: item.packageName,
      metadata: item.metadata ?? null,
    }));
    const orderRecord: Record<string, unknown> = {
      id: orderId,
      status,
      currency,
      total,
      items: orderItemsSnapshot,
      queuedPaymentMethod: paymentMethod ?? null,
      orderNumber: ticketCode,
    };

    if (userId) {
      orderRecord.userId = userId;
    }
    if (clientId && ORDER_CLIENT_ID_COLUMN) {
      orderRecord[ORDER_CLIENT_ID_COLUMN] = clientId;
    }

    const totalsPayload: Record<string, number | null> = {};
    if (subtotal !== null) totalsPayload.subtotal = subtotal;
    if (tax !== null) totalsPayload.tax = tax;
    if (tipAmount !== null) totalsPayload.tip = tipAmount;
    if (total !== null) totalsPayload.total = total;

    if (Object.keys(totalsPayload).length) {
      orderRecord.totals = totalsPayload;
    }

    if (tipAmount !== null) {
      orderRecord.tipAmount = tipAmount;
    }
    if (tipPercent !== null) {
      orderRecord.tipPercent = tipPercent;
    }

    const noteValue = toTrimmedString(
      payload.notes ??
        payload.message ??
        payload.instructions ??
        (typeof payload.metadata === 'string' ? payload.metadata : null)
    );
    let metadataPayload =
      payload.metadata && typeof payload.metadata === 'object'
        ? { ...(payload.metadata as Record<string, unknown>) }
        : null;
    let shippingSnapshot: Record<string, unknown> | null = null;

    const paymentMetadata =
      metadataPayload?.payment && typeof metadataPayload.payment === 'object'
        ? (metadataPayload.payment as Record<string, unknown>)
        : null;
    const legacyPaymentMetadata =
      metadataPayload?.paymentReference && typeof metadataPayload.paymentReference === 'object'
        ? (metadataPayload.paymentReference as Record<string, unknown>)
        : null;
    const paymentReference =
      toTrimmedString(payload.paymentReference) ??
      toTrimmedString(paymentMetadata?.reference) ??
      toTrimmedString(legacyPaymentMetadata?.value) ??
      toTrimmedString(legacyPaymentMetadata?.reference) ??
      null;
    const paymentReferenceType =
      toTrimmedString(payload.paymentReferenceType) ??
      toTrimmedString(paymentMetadata?.referenceType) ??
      toTrimmedString(legacyPaymentMetadata?.type) ??
      null;

    if (paymentReference) {
      orderRecord.queuedPaymentReference = paymentReference;
    }
    if (paymentReferenceType) {
      orderRecord.queuedPaymentReferenceType = paymentReferenceType;
    }

    if (!metadataPayload && paymentReference) {
      metadataPayload = {};
    }
    if (metadataPayload && paymentReference) {
      const paymentObject = {
        reference: paymentReference,
        referenceType: paymentReferenceType,
        method: paymentMethod,
      };
      if (metadataPayload.payment && typeof metadataPayload.payment === 'object') {
        metadataPayload.payment = { ...(metadataPayload.payment as Record<string, unknown>), ...paymentObject };
      } else {
        metadataPayload.payment = paymentObject;
      }
    }

    const incomingShipping = normalizeShippingPayload(payload.shipping);
    if (incomingShipping) {
      shippingSnapshot = {};
      if (incomingShipping.address) {
        shippingSnapshot.address = incomingShipping.address;
      }
      if (incomingShipping.addressId) {
        shippingSnapshot.addressId = incomingShipping.addressId;
        orderRecord.shipping_address_id = incomingShipping.addressId;
      }
      if (incomingShipping.contactPhone) {
        shippingSnapshot.contactPhone = incomingShipping.contactPhone;
        orderRecord.shipping_contact_phone = incomingShipping.contactPhone;
      }
      if (typeof incomingShipping.isWhatsapp === 'boolean') {
        shippingSnapshot.isWhatsapp = incomingShipping.isWhatsapp;
        orderRecord.shipping_contact_is_whatsapp = incomingShipping.isWhatsapp;
      }
      if (incomingShipping.deliveryTip) {
        shippingSnapshot.deliveryTip = incomingShipping.deliveryTip;
      }
      if (!metadataPayload) {
        metadataPayload = {};
      }
      metadataPayload.shipping = shippingSnapshot;
      if (incomingShipping.deliveryTip) {
        metadataPayload.deliveryTip = incomingShipping.deliveryTip;
        metadataPayload.deliveryTipAmount = incomingShipping.deliveryTip.amount;
        metadataPayload.deliveryTipPercent = incomingShipping.deliveryTip.percent;
      }
      const normalizedDeliveryTipAmount =
        normalizeNumber(incomingShipping.deliveryTip?.amount) ?? null;
      const normalizedDeliveryTipPercent =
        normalizeNumber(incomingShipping.deliveryTip?.percent) ?? null;
      if (normalizedDeliveryTipAmount !== null) {
        orderRecord.deliveryTipAmount = normalizedDeliveryTipAmount;
      }
      if (normalizedDeliveryTipPercent !== null) {
        orderRecord.deliveryTipPercent = normalizedDeliveryTipPercent;
      }
    }

    if (metadataPayload) {
      orderRecord.metadata = metadataPayload;
    } else if (typeof payload.metadata === 'string' && payload.metadata.trim()) {
      orderRecord.metadata = payload.metadata.trim();
    }

    if (shippingSnapshot) {
      orderRecord.items = {
        list: orderItemsSnapshot,
        shipping: shippingSnapshot,
      };
    }

    if (noteValue) {
      orderRecord.notes = noteValue;
    }

    const orderItemsPayload = items.map((item) => ({
      orderId,
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
    }));

    const ticketRecord =
      ticketCode || paymentMethod
        ? {
            orderId,
            ticketCode,
            paymentMethod,
          }
        : null;

    const preferSupabase = shouldPreferSupabase();
    let attemptedSupabase = false;

    if (preferSupabase) {
      try {
        if (isPublicSaleContext) {
          await ensurePublicSaleUser();
        }

        await ensureProducts(items);

        const { error: orderError } = await supabaseAdmin.from(ORDERS_TABLE).upsert(orderRecord);
        if (orderError) {
          throw orderError;
        }

        const { error: deleteItemsError } = await supabaseAdmin
          .from(ORDER_ITEMS_TABLE)
          .delete()
          .eq('orderId', orderId);
        if (deleteItemsError) {
          throw deleteItemsError;
        }

        const { error: insertItemsError } = await supabaseAdmin
          .from(ORDER_ITEMS_TABLE)
          .insert(orderItemsPayload);
        if (insertItemsError) {
          throw insertItemsError;
        }

        if (ticketRecord) {
          const { error: ticketError } = await supabaseAdmin.from(TICKETS_TABLE).upsert(ticketRecord);
          if (ticketError) {
            throw ticketError;
          }
        }

        markSupabaseHealthy();
        return NextResponse.json({
          success: true,
          data: {
            orderId,
            ticketCode,
            items: orderItemsPayload.length,
            pendingSync: false,
          },
        });
      } catch (error) {
        attemptedSupabase = true;
        if (!isLikelyNetworkError(error)) {
          console.error('Error creating order:', error);
          const message = error instanceof Error ? error.message : 'Failed to process order';
          return NextResponse.json({ success: false, error: message }, { status: 500 });
        }
        markSupabaseFailure(error);
      }
    }

    const queueId = await queueOfflineOrder(orderRecord, orderItemsPayload, ticketRecord, items);
    return NextResponse.json(
      {
        success: true,
        data: {
          orderId,
          ticketCode,
          items: orderItemsPayload.length,
          pendingSync: true,
          queueId,
        },
      },
      { status: attemptedSupabase ? 202 : 201 }
    );
  } catch (error) {
    console.error('Error processing order webhook:', error);
    const message = error instanceof Error ? error.message : 'Failed to process order';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
