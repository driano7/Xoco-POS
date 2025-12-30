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
import { sqlite } from '@/lib/sqlite';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const TICKETS_TABLE = process.env.SUPABASE_TICKETS_TABLE ?? 'tickets';
const ORDER_CODES_TABLE = process.env.SUPABASE_ORDER_CODES_TABLE ?? 'order_codes';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
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

type ProductRecord = {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
};

type OrdersDataLoader = {
  loadProducts: (productIds: Set<string>) => Promise<Map<string, ProductRecord>>;
  loadTicketsAndCodes: (
    orderIds: string[]
  ) => Promise<{
    ticketMap: Map<string, string | null>;
    codeMap: Map<string, string | null>;
  }>;
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

const mapOrderItems = (rawItems: unknown, productMap?: Map<string, ProductRecord>) => {
  const items = Array.isArray(rawItems) ? rawItems : [];
  return items.map((item) => {
    const rawProductId = item?.productId ?? item?.product_id ?? null;
    const normalizedProductId =
      typeof rawProductId === 'string'
        ? rawProductId
        : typeof rawProductId === 'number' && Number.isFinite(rawProductId)
          ? String(rawProductId)
          : null;
    const inlineDetails = {
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

    const productDetails =
      item?.product ??
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

  let enriched = ordersData.map((order) => {
    const {
      order_items,
      items: rawStoredItems,
      total,
      user,
      metadata,
      notes,
      message,
      instructions,
      ...rest
    } = order as Record<string, unknown> & {
      id?: string;
      order_items?: unknown;
      items?: unknown;
      total?: unknown;
      user?: Record<string, unknown> | null;
      metadata?: unknown;
      notes?: unknown;
      message?: unknown;
      instructions?: unknown;
    };
    const sourceItems =
      Array.isArray(rawStoredItems) && rawStoredItems.length
        ? rawStoredItems
        : Array.isArray(order_items)
          ? order_items
          : [];
    const items = mapOrderItems(sourceItems, productMap);
    const metadataObject = coerceMetadataObject(metadata);
    const prepAssignment = metadataObject?.prepAssignment
      ? coerceMetadataObject(metadataObject.prepAssignment)
      : null;
    const paymentMetadata = metadataObject?.payment
      ? coerceMetadataObject(metadataObject.payment)
      : null;
    return {
      ...rest,
      id: rest.id ?? order.id ?? null,
      total: normalizeNumber(total),
      items,
      itemsCount: countOrderItems(items),
      user: withDecryptedUserNames(user ?? null),
      metadata: metadata ?? null,
      notes: toTrimmedString(notes) ?? null,
      message: toTrimmedString(message) ?? null,
      instructions: toTrimmedString(instructions) ?? null,
      queuedByStaffId: toTrimmedString(prepAssignment?.staffId) ?? null,
      queuedByStaffName: toTrimmedString(prepAssignment?.staffName) ?? null,
      queuedPaymentReference: toTrimmedString(paymentMetadata?.reference) ?? null,
      queuedPaymentReferenceType: toTrimmedString(paymentMetadata?.referenceType) ?? null,
    };
  });

  if (!enriched.length) {
    return enriched;
  }

  const orderIds = enriched
    .map((order) => order.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  const { ticketMap, codeMap } = await loader.loadTicketsAndCodes(orderIds);

  enriched = enriched.map((order) => {
    const orderId = typeof order.id === 'string' ? order.id : null;
    return {
      ...order,
      ticketCode: orderId ? ticketMap.get(orderId) || null : null,
      shortCode: orderId ? codeMap.get(orderId) || null : null,
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
  createdAt?: string | null;
  updatedAt?: string | null;
  queuedPaymentMethod?: string | null;
  tipAmount?: number | null;
  tipPercent?: number | null;
  metadata?: unknown;
  notes?: unknown;
  message?: unknown;
  instructions?: unknown;
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
      return { ticketMap: new Map(), codeMap: new Map() };
    }
    const { placeholders, bindings } = buildSqliteInClause(orderIds, 'ticket');
    const [tickets, codes] = await Promise.all([
      sqlite.all<{ orderId?: string | null; ticketCode?: string | null }>(
        `SELECT orderId, ticketCode FROM tickets WHERE orderId IN (${placeholders.join(',')})`,
        bindings
      ),
      sqlite.all<{ orderId?: string | null; code?: string | null }>(
        `SELECT orderId, code FROM order_codes WHERE orderId IN (${placeholders.join(',')})`,
        bindings
      ),
    ]);
    return {
      ticketMap: new Map(
        tickets.filter((ticket) => ticket.orderId).map((ticket) => [String(ticket.orderId), ticket.ticketCode ?? null])
      ),
      codeMap: new Map(
        codes.filter((code) => code.orderId).map((code) => [String(code.orderId), code.code ?? null])
      ),
    };
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
      return { ticketMap: new Map(), codeMap: new Map() };
    }
    const [{ data: tickets, error: ticketsError }, { data: codes, error: codesError }] = await Promise.all([
      supabaseAdmin.from(TICKETS_TABLE).select('"orderId","ticketCode"').in('orderId', orderIds),
      supabaseAdmin.from(ORDER_CODES_TABLE).select('"orderId",code').in('orderId', orderIds),
    ]);

    if (ticketsError) {
      console.error('Error fetching tickets:', ticketsError);
    }
    if (codesError) {
      console.error('Error fetching order codes:', codesError);
    }

    return {
      ticketMap: new Map((tickets ?? []).map((ticket) => [ticket.orderId, ticket.ticketCode ?? null])),
      codeMap: new Map((codes ?? []).map((code) => [code.orderId, code.code ?? null])),
    };
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
    '"createdAt"',
    '"updatedAt"',
    '"queuedPaymentMethod"',
    '"tipAmount"',
    '"tipPercent"',
    '"metadata"',
    '"notes"',
    '"message"',
    '"instructions"',
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
      o.createdAt,
      o.updatedAt,
      o.queuedPaymentMethod,
      o.tipAmount,
      o.tipPercent,
      o.metadata,
      o.notes,
      o.message,
      o.instructions,
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
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      queuedPaymentMethod: row.queuedPaymentMethod ?? null,
      tipAmount: row.tipAmount ?? null,
      tipPercent: row.tipPercent ?? null,
      metadata: row.metadata ?? null,
      notes: row.notes ?? null,
      message: row.message ?? null,
      instructions: row.instructions ?? null,
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

    const preferSupabase = shouldPreferSupabase();

    if (!preferSupabase) {
      const localData = await loadOrdersFromSqlite(status);
      return NextResponse.json({ success: true, data: localData });
    }

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

    if (metadataPayload) {
      orderRecord.metadata = metadataPayload;
    } else if (typeof payload.metadata === 'string' && payload.metadata.trim()) {
      orderRecord.metadata = payload.metadata.trim();
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
