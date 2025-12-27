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

import { supabaseAdmin } from '@/lib/supabase-server';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const LOYALTY_PUNCHES_TABLE = process.env.SUPABASE_LOYALTY_PUNCHES_TABLE ?? 'loyalty_points';
const MEXICAN_COFFEE_KEYWORDS = ['cafe mexicano', 'café mexicano', 'mexicano'];
const HOT_BEVERAGE_KEYWORDS = ['bebida caliente', 'bebidas calientes', 'bebida', 'cafe', 'café', 'coffee'];
const PACKAGE_KEYWORDS = ['paquete', 'combo', 'kit'];
const PUBLIC_SALE_IDENTIFIERS = [
  process.env.SUPABASE_PUBLIC_SALE_USER_ID,
  process.env.NEXT_PUBLIC_PUBLIC_SALE_USER_ID,
  process.env.SUPABASE_PUBLIC_SALE_CLIENT_ID,
  process.env.NEXT_PUBLIC_PUBLIC_SALE_CLIENT_ID,
]
  .map((value) => value?.trim().toLowerCase())
  .filter(Boolean);

const normalizeText = (value?: string | null) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const LOYALTY_FLAG_KEYS = ['loyaltyEnrolled', 'loyalty_enrolled'];
const LOYALTY_META_KEYS = ['metadata', 'profile', 'appMetadata'];

const extractBooleanFlag = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
};

const resolveNestedBooleanFlag = (source: Record<string, unknown>, containerKey: string) => {
  const nested = source[containerKey];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return null;
  }
  const nestedRecord = nested as Record<string, unknown>;
  for (const flagKey of LOYALTY_FLAG_KEYS) {
    const flag = extractBooleanFlag(nestedRecord, flagKey);
    if (flag !== null) {
      return flag;
    }
  }
  return null;
};

const resolveLoyaltyEnrollmentFlag = (source: Record<string, unknown>): boolean | null => {
  for (const key of LOYALTY_FLAG_KEYS) {
    const flag = extractBooleanFlag(source, key);
    if (flag !== null) {
      return flag;
    }
  }
  for (const container of LOYALTY_META_KEYS) {
    const nestedFlag = resolveNestedBooleanFlag(source, container);
    if (nestedFlag !== null) {
      return nestedFlag;
    }
  }
  return null;
};

type ItemSnapshot = {
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  productId?: string | null;
  product?: { name?: string | null; category?: string | null; subcategory?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  packageId?: string | null;
  packageName?: string | null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isPackageItem = (item: ItemSnapshot) => {
  const haystack = [
    normalizeText(item.category),
    normalizeText(item.subcategory),
    normalizeText(item.name),
    normalizeText(item.product?.category),
    normalizeText(item.product?.subcategory),
    normalizeText(item.product?.name),
    typeof item.packageName === 'string' ? normalizeText(item.packageName) : '',
  ].join(' ');
  if (PACKAGE_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return true;
  }
  if (item.packageId || (item.metadata && typeof item.metadata.packageId === 'string')) {
    return true;
  }
  return false;
};

const isHotBeverageItem = (item: ItemSnapshot) => {
  const haystack = [
    normalizeText(item.category),
    normalizeText(item.subcategory),
    normalizeText(item.product?.category),
    normalizeText(item.product?.subcategory),
  ].join(' ');
  return HOT_BEVERAGE_KEYWORDS.some((keyword) => haystack.includes(keyword));
};

const itemContainsMexicanCoffee = (item: ItemSnapshot) => {
  const haystack = [
    normalizeText(item.name),
    normalizeText(item.product?.name),
    normalizeText(item.category),
    normalizeText(item.subcategory),
    normalizeText(item.product?.category),
    normalizeText(item.product?.subcategory),
    normalizeText(item.productId),
  ].join(' ');
  return MEXICAN_COFFEE_KEYWORDS.some((keyword) => haystack.includes(keyword));
};

const qualifiesForMexicanCoffee = (item: ItemSnapshot) =>
  itemContainsMexicanCoffee(item) && !isPackageItem(item);

const mapSnapshotItems = (items: unknown): ItemSnapshot[] =>
  Array.isArray(items)
    ? items.map((raw) => {
        if (!isPlainObject(raw)) {
          return {
            name: null,
            category: null,
            subcategory: null,
            productId: null,
            product: null,
            metadata: null,
            packageId: null,
            packageName: null,
          };
        }

        const record = raw as Record<string, unknown>;
        const metadata = isPlainObject(record.metadata) ? (record.metadata as Record<string, unknown>) : null;
        const metadataPackageId = metadata && typeof metadata.packageId === 'string' ? (metadata.packageId as string) : null;
        const metadataPackageName =
          metadata && typeof metadata.packageName === 'string' ? (metadata.packageName as string) : null;
        const packageId =
          typeof record.packageId === 'string'
            ? (record.packageId as string)
            : metadataPackageId;
        const packageName =
          typeof record.packageName === 'string'
            ? (record.packageName as string)
            : metadataPackageName;

        return {
          name: typeof record.name === 'string' ? (record.name as string) : null,
          category: typeof record.category === 'string' ? (record.category as string) : null,
          subcategory: typeof record.subcategory === 'string' ? (record.subcategory as string) : null,
          productId: typeof record.productId === 'string' ? (record.productId as string) : null,
          product: isPlainObject(record.product)
            ? (record.product as { name?: string | null; category?: string | null; subcategory?: string | null })
            : null,
          metadata,
          packageId,
          packageName,
        };
      })
    : [];

const fetchItemsFromDatabase = async (orderId: string): Promise<ItemSnapshot[]> => {
  const { data: orderItems, error: orderItemsError } = await supabaseAdmin
    .from(ORDER_ITEMS_TABLE)
    .select('productId')
    .eq('orderId', orderId);

  if (orderItemsError) {
    console.warn('No se pudieron obtener los artículos del pedido para lealtad:', orderItemsError);
    return [];
  }

  const productIds = (orderItems ?? [])
    .map((item) => item.productId)
    .filter((value): value is string => typeof value === 'string' && Boolean(value));

  if (!productIds.length) {
    return [];
  }

  const { data: products, error: productsError } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('id,name,category,subcategory')
    .in('id', productIds);

  if (productsError) {
    console.warn('No se pudieron obtener los productos para lealtad:', productsError);
    return [];
  }

  const productMap = new Map((products ?? []).map((product) => [product.id, product]));

  return productIds.map((productId) => {
    const product = productMap.get(productId) ?? null;
    return {
      productId,
      name: product?.name ?? null,
      category: product?.category ?? null,
      subcategory: product?.subcategory ?? null,
      product,
      metadata: null,
      packageId: null,
      packageName: null,
    };
  });
};

const getWeekBounds = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
};

const loadOrderItems = async (orderId: string, snapshot: unknown): Promise<ItemSnapshot[]> => {
  const inline = mapSnapshotItems(snapshot);
  if (inline.length) {
    return inline;
  }
  return fetchItemsFromDatabase(orderId);
};

const isPublicSaleUser = (userId?: string | null) => {
  if (!userId) {
    return false;
  }
  const normalized = userId.trim().toLowerCase();
  return PUBLIC_SALE_IDENTIFIERS.includes(normalized);
};

const isUserEnrolledInLoyalty = async (userId: string) => {
  try {
    const { data, error } = await supabaseAdmin
      .from(USERS_TABLE)
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('No se pudo verificar la inscripción de lealtad:', error);
      return false;
    }

    if (!data || typeof data !== 'object') {
      return false;
    }

    const flag = resolveLoyaltyEnrollmentFlag(data as Record<string, unknown>);
    return flag ?? true;
  } catch (error) {
    console.warn('Error inesperado al consultar inscripción de lealtad:', error);
    return true;
  }
};

export const maybeAwardDailyCoffee = async (
  orderId: string,
  userId?: string | null,
  snapshotItems?: unknown
) => {
  if (!userId) {
    return;
  }

  if (isPublicSaleUser(userId)) {
    return;
  }

  const enrolled = await isUserEnrolledInLoyalty(userId);
  if (!enrolled) {
    return;
  }

  try {
    const items = await loadOrderItems(orderId, snapshotItems);
    const qualifyingItems = items.filter(qualifiesForMexicanCoffee);
    if (!qualifyingItems.length) {
      return;
    }

    await supabaseAdmin.from(LOYALTY_PUNCHES_TABLE).delete().eq('orderId', orderId);

    const rows = qualifyingItems.map((_, index) => ({
      orderId,
      userId,
      points: 1,
      reason: 'weekly_coffee',
      createdAt: new Date(Date.now() + index).toISOString(),
    }));

    const { error: insertError } = await supabaseAdmin.from(LOYALTY_PUNCHES_TABLE).insert(rows);

    if (insertError) {
      console.warn('No se pudo registrar el sello de lealtad:', insertError);
    } else {
      const { start, end } = getWeekBounds();
      const { data: weekPunches, error: countError } = await supabaseAdmin
        .from(LOYALTY_PUNCHES_TABLE)
        .select('id')
        .eq('userId', userId)
        .gte('createdAt', start.toISOString())
        .lt('createdAt', end.toISOString());

      if (countError) {
        console.warn('No pudimos contar los sellos semanales:', countError);
      } else {
        const normalizedCount = Array.isArray(weekPunches) ? weekPunches.length : 0;
        const { error: updateWeeklyError } = await supabaseAdmin
          .from(USERS_TABLE)
          .update({ weeklyCoffeeCount: normalizedCount })
          .eq('id', userId);
        if (updateWeeklyError) {
          console.warn('No pudimos actualizar el contador semanal del cliente:', updateWeeklyError);
        }
      }
    }
  } catch (error) {
    console.warn('Error inesperado al otorgar sello de lealtad:', error);
  }
};

export const revertLoyaltyCoffee = async (orderId: string) => {
  try {
    const { error } = await supabaseAdmin
      .from(LOYALTY_PUNCHES_TABLE)
      .delete()
      .eq('orderId', orderId);
    if (error) {
      console.warn('No se pudo revertir el sello de lealtad:', error);
    }
  } catch (error) {
    console.warn('Error inesperado al revertir sello de lealtad:', error);
  }
};
