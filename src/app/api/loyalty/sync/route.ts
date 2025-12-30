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

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { LOYALTY_STAMPS_TARGET, getCurrentWeekBounds, normalizeWeeklyPunches } from '@/lib/loyalty';
import { LOYALTY_PRODUCTS_REQUIRED_ERROR, countEligiblePunchesFromSnapshot, ensureLoyaltyProductsConfigured } from '@/lib/loyalty-sync';

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const LOYALTY_SYNC_KEY = process.env.LOYALTY_SYNC_KEY?.trim() ?? null;
const LOYALTY_SYNC_BATCH = Number(process.env.LOYALTY_SYNC_BATCH ?? 200);
const LOYALTY_SYNC_USER_BATCH = Number(process.env.LOYALTY_SYNC_USER_BATCH ?? 500);
const MIN_COMPLETED_MINUTES = Number(process.env.LOYALTY_COMPLETED_DELAY_MINUTES ?? 60);
const ELIGIBLE_STATUSES = (process.env.LOYALTY_ELIGIBLE_STATUSES || 'completed')
  .split(',')
  .map((status) => status.trim())
  .filter(Boolean);

const MIN_COMPLETED_MS = MIN_COMPLETED_MINUTES * 60 * 1000;

const buildError = (message: string, status = 400) =>
  NextResponse.json({ success: false, error: message }, { status });

const orderHasEligibleProduct = (order: Record<string, unknown>) =>
  countEligiblePunchesFromSnapshot(order.items) > 0;

const orderCompletedLongEnough = (order: Record<string, unknown>) => {
  const timestamp =
    (typeof order.completedAt === 'string' && order.completedAt) ||
    (typeof order.updatedAt === 'string' && order.updatedAt) ||
    (typeof order.createdAt === 'string' && order.createdAt) ||
    null;
  if (!timestamp) {
    return false;
  }
  const completedAt = Date.parse(timestamp);
  if (!Number.isFinite(completedAt)) {
    return false;
  }
  return Date.now() - completedAt >= MIN_COMPLETED_MS;
};

const countPunchesPerUser = (orders: Array<Record<string, unknown>>) => {
  const punches = new Map<string, number>();
  const perDay = new Map<string, Set<string>>();

  for (const order of orders) {
    const userId = typeof order.userId === 'string' ? order.userId.trim() : null;
    if (!userId) {
      continue;
    }
    if (!orderCompletedLongEnough(order)) {
      continue;
    }
    if (!orderHasEligibleProduct(order)) {
      continue;
    }

    const timestamp =
      (typeof order.completedAt === 'string' && order.completedAt) ||
      (typeof order.createdAt === 'string' && order.createdAt) ||
      null;
    if (!timestamp) {
      continue;
    }
    const dayKey = new Date(timestamp).toISOString().slice(0, 10);
    let days = perDay.get(userId);
    if (!days) {
      days = new Set<string>();
      perDay.set(userId, days);
    }
    if (days.has(dayKey)) {
      continue;
    }
    days.add(dayKey);
    const current = punches.get(userId) ?? 0;
    if (current >= LOYALTY_STAMPS_TARGET) {
      continue;
    }
    punches.set(userId, Math.min(LOYALTY_STAMPS_TARGET, current + 1));
  }

  return punches;
};

const fetchWeeklyOrders = async () => {
  const { start } = getCurrentWeekBounds();
  const orders: Array<Record<string, unknown>> = [];
  let from = 0;
  while (true) {
    const to = from + LOYALTY_SYNC_BATCH - 1;
    const query = supabaseAdmin
      .from(ORDERS_TABLE)
      .select('id,"userId",status,"items","createdAt","updatedAt","completedAt"')
      .gte('createdAt', start.toISOString())
      .order('createdAt', { ascending: false })
      .range(from, to);

    if (ELIGIBLE_STATUSES.length) {
      query.in('status', ELIGIBLE_STATUSES);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    if (!data || !data.length) {
      break;
    }

    orders.push(...data);
    if (data.length < LOYALTY_SYNC_BATCH) {
      break;
    }
    from += LOYALTY_SYNC_BATCH;
  }

  return orders;
};

const fetchAllUserIds = async () => {
  const ids: string[] = [];
  let from = 0;
  while (true) {
    const to = from + LOYALTY_SYNC_USER_BATCH - 1;
    const { data, error } = await supabaseAdmin
      .from(USERS_TABLE)
      .select('id')
      .range(from, to);

    if (error) {
      throw error;
    }

    if (!data || !data.length) {
      break;
    }

    ids.push(...data.map((record) => record.id).filter((id): id is string => typeof id === 'string'));

    if (data.length < LOYALTY_SYNC_USER_BATCH) {
      break;
    }
    from += LOYALTY_SYNC_USER_BATCH;
  }
  return ids;
};

export async function POST(request: NextRequest) {
  try {
    if (!LOYALTY_SYNC_KEY) {
      return buildError('Configura LOYALTY_SYNC_KEY para habilitar este endpoint.', 500);
    }
    try {
      ensureLoyaltyProductsConfigured();
    } catch (err) {
      if (err instanceof Error && err.message === LOYALTY_PRODUCTS_REQUIRED_ERROR) {
        return buildError('Define LOYALTY_ELIGIBLE_PRODUCTS antes de sincronizar.', 500);
      }
      throw err;
    }
    const providedKey = request.headers.get('x-loyalty-sync-key');
    if (!providedKey || providedKey !== LOYALTY_SYNC_KEY) {
      return buildError('Cabecera x-loyalty-sync-key inválida o ausente.', 401);
    }

    const [orders, userIds] = await Promise.all([fetchWeeklyOrders(), fetchAllUserIds()]);
    const punchesMap = countPunchesPerUser(orders);

    const updates = userIds.map((userId) => {
      const punches = punchesMap.get(userId) ?? 0;
      const normalized = normalizeWeeklyPunches(punches);
      return {
        id: userId,
        weeklyCoffeeCount: normalized.weeklyCoffeeCount,
        rewardEarned: normalized.rewardEarned,
      };
    });

    const chunkSize = Number(process.env.LOYALTY_SYNC_UPDATE_BATCH ?? 200);
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      if (!chunk.length) {
        continue;
      }
      const { error } = await supabaseAdmin.from(USERS_TABLE).upsert(chunk, { onConflict: 'id' });
      if (error) {
        throw error;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        processedOrders: orders.length,
        updatedUsers: updates.length,
        maxStamps: LOYALTY_STAMPS_TARGET,
      },
    });
  } catch (error) {
    console.error('POST /api/loyalty/sync falló', error);
    return buildError('No pudimos sincronizar los sellos esta vez.', 502);
  }
}

export const dynamic = 'force-dynamic';
