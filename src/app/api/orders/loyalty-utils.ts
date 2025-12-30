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
  LOYALTY_PRODUCTS_REQUIRED_ERROR,
  applyPunchesForUser,
  countEligiblePunchesFromSnapshot,
  ensureLoyaltyProductsConfigured,
  loadOrderItemsSnapshot,
  recalculateWeeklyCoffeeCount,
} from '@/lib/loyalty-sync';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';

const fetchOrderUser = async (orderId: string) => {
  const { data, error } = await supabaseAdmin
    .from(ORDERS_TABLE)
    .select('id,"userId","items"')
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data || typeof data.userId !== 'string') {
    return null;
  }
  return { userId: data.userId, snapshot: data.items ?? null };
};

export const maybeAwardDailyCoffee = async (
  orderId: string,
  userId?: string | null,
  snapshotItems?: unknown
) => {
  const resolvedUserId = userId?.trim() || null;
  if (!resolvedUserId) {
    return;
  }

  try {
    ensureLoyaltyProductsConfigured();
  } catch (error) {
    if (error instanceof Error && error.message === LOYALTY_PRODUCTS_REQUIRED_ERROR) {
      console.warn('Programa de lealtad deshabilitado: faltan LOYALTY_ELIGIBLE_PRODUCTS.');
      return;
    }
    throw error;
  }

  try {
    const items = await loadOrderItemsSnapshot(orderId, snapshotItems);
    const punches = countEligiblePunchesFromSnapshot(items);
    if (!punches) {
      return;
    }

    await applyPunchesForUser(resolvedUserId, punches);
  } catch (error) {
    console.warn('No pudimos otorgar sellos de lealtad para el pedido:', orderId, error);
  }
};

export const revertLoyaltyCoffee = async (orderId: string) => {
  try {
    const order = await fetchOrderUser(orderId);
    if (!order) {
      return;
    }
    await recalculateWeeklyCoffeeCount(order.userId);
  } catch (error) {
    console.warn('No pudimos recalcular el contador de lealtad tras revertir el pedido:', error);
  }
};
