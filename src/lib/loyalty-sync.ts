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
import {
  LOYALTY_ELIGIBLE_PRODUCTS,
  LOYALTY_STAMPS_TARGET,
  addWeeklyPunches,
  getCurrentWeekBounds,
  isLoyaltyEligibleProduct,
  normalizeWeeklyPunches,
} from '@/lib/loyalty';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const LOYALTY_RECALC_LIMIT = Number(process.env.LOYALTY_RECALC_LIMIT ?? 200);
const ELIGIBLE_STATUSES = (process.env.LOYALTY_ELIGIBLE_STATUSES || 'completed')
  .split(',')
  .map((status) => status.trim())
  .filter(Boolean);

export const LOYALTY_PRODUCTS_REQUIRED_ERROR = 'LOYALTY_PRODUCTS_MISSING';

const ensureEligibleProductsConfigured = () => {
  if (!LOYALTY_ELIGIBLE_PRODUCTS.length) {
    throw new Error(LOYALTY_PRODUCTS_REQUIRED_ERROR);
  }
};

const normalizeQuantity = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return parsed <= 0 ? 1 : Math.floor(parsed);
};

export const parseOrderItems = (raw: unknown) => {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const countEligiblePunchesFromSnapshot = (snapshot: unknown) => {
  const items = parseOrderItems(snapshot);
  if (!items.length) {
    return 0;
  }
  return items.reduce((total, item) => {
    if (!item || typeof item !== 'object') {
      return total;
    }
    const record = item as Record<string, unknown>;
    const productIdValue = record.productId ?? record.product_id;
    if (typeof productIdValue !== 'string') {
      return total;
    }
    if (!isLoyaltyEligibleProduct(productIdValue)) {
      return total;
    }
    return total + normalizeQuantity(record.quantity ?? record.qty ?? 1);
  }, 0);
};

export const loadOrderItemsSnapshot = async (orderId: string, snapshot: unknown) => {
  const inline = parseOrderItems(snapshot);
  if (inline.length) {
    return inline;
  }
  const { data, error } = await supabaseAdmin
    .from(ORDER_ITEMS_TABLE)
    .select('productId,quantity')
    .eq('orderId', orderId);
  if (error) {
    console.warn('No pudimos cargar los artículos del pedido para lealtad:', error);
    return [];
  }
  if (!data) {
    return [];
  }
  return data.map((item) => ({
    productId: item.productId ?? null,
    quantity: item.quantity ?? 1,
  }));
};

export const recalculateWeeklyCoffeeCount = async (userId: string) => {
  ensureEligibleProductsConfigured();
  const { start } = getCurrentWeekBounds();

  const query = supabaseAdmin
    .from(ORDERS_TABLE)
    .select('id,status,"items","createdAt"')
    .eq('userId', userId)
    .gte('createdAt', start.toISOString())
    .order('createdAt', { ascending: false })
    .limit(LOYALTY_RECALC_LIMIT);

  if (ELIGIBLE_STATUSES.length) {
    query.in('status', ELIGIBLE_STATUSES);
  }

  const { data: orders, error } = await query;
  if (error) {
    throw error;
  }

  const punches = (orders ?? []).reduce(
    (total, order) => total + countEligiblePunchesFromSnapshot(order.items),
    0
  );
  const normalized = normalizeWeeklyPunches(punches);

  const { error: updateError } = await supabaseAdmin
    .from(USERS_TABLE)
    .update({
      weeklyCoffeeCount: normalized.weeklyCoffeeCount,
      rewardEarned: normalized.rewardEarned,
    })
    .eq('id', userId);

  if (updateError) {
    throw updateError;
  }

  return {
    userId,
    weeklyCoffeeCount: normalized.weeklyCoffeeCount,
    rewardEarned: normalized.rewardEarned,
    punches,
    maxStamps: LOYALTY_STAMPS_TARGET,
  };
};

export const applyPunchesForUser = async (userId: string, punches: number) => {
  const { data, error } = await supabaseAdmin
    .from(USERS_TABLE)
    .select('id,"weeklyCoffeeCount","rewardEarned"')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('USER_NOT_FOUND');
  }
  if (data.rewardEarned) {
    return { weeklyCoffeeCount: data.weeklyCoffeeCount ?? 0, rewardEarned: true };
  }
  const nextState = addWeeklyPunches(data.weeklyCoffeeCount ?? 0, punches);
  const { error: updateError } = await supabaseAdmin
    .from(USERS_TABLE)
    .update({
      weeklyCoffeeCount: nextState.weeklyCoffeeCount,
      rewardEarned: nextState.rewardEarned,
    })
    .eq('id', userId);
  if (updateError) {
    throw updateError;
  }
  return nextState;
};

export const ensureLoyaltyProductsConfigured = () => {
  ensureEligibleProductsConfigured();
};
