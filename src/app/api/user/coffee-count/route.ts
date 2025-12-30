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
import { LOYALTY_STAMPS_TARGET, addWeeklyPunches } from '@/lib/loyalty';
import {
  LOYALTY_PRODUCTS_REQUIRED_ERROR,
  ensureLoyaltyProductsConfigured,
  recalculateWeeklyCoffeeCount,
} from '@/lib/loyalty-sync';

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';

type UserIdentifier = { userId?: string | null; clientId?: string | null };

const buildErrorResponse = (message: string, status = 400) =>
  NextResponse.json({ success: false, error: message }, { status });

const extractUserIdentifier = (request: NextRequest, payload?: Record<string, unknown> | null): UserIdentifier => {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const userId = payload?.userId ?? payload?.user_id ?? searchParams.get('userId') ?? searchParams.get('user_id');
  const clientId =
    payload?.clientId ??
    payload?.client_id ??
    payload?.token ??
    searchParams.get('clientId') ??
    searchParams.get('client_id') ??
    searchParams.get('token');
  return {
    userId: typeof userId === 'string' && userId.trim() ? userId.trim() : null,
    clientId: typeof clientId === 'string' && clientId.trim() ? clientId.trim() : null,
  };
};

const fetchUserRecord = async (identifier: UserIdentifier) => {
  const filters = [];
  if (identifier.userId) {
    filters.push(`id.eq.${identifier.userId}`);
  }
  if (identifier.clientId) {
    filters.push(`"clientId".eq.${identifier.clientId}`);
  }

  if (!filters.length) {
    throw new Error('IDENTIFIER_MISSING');
  }

  const { data, error } = await supabaseAdmin
    .from(USERS_TABLE)
    .select('id,"clientId","weeklyCoffeeCount","rewardEarned"')
    .or(filters.join(','))
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('USER_NOT_FOUND');
  }
  return data as {
    id: string;
    clientId?: string | null;
    weeklyCoffeeCount?: number | null;
    rewardEarned?: boolean | null;
  };
};

export async function GET(request: NextRequest) {
  try {
    ensureLoyaltyProductsConfigured();
    const identifier = extractUserIdentifier(request);
    const user = await fetchUserRecord(identifier);
    const result = await recalculateWeeklyCoffeeCount(user.id);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === LOYALTY_PRODUCTS_REQUIRED_ERROR) {
        return buildErrorResponse('Define LOYALTY_ELIGIBLE_PRODUCTS para usar este endpoint.', 500);
      }
      if (error.message === 'IDENTIFIER_MISSING') {
        return buildErrorResponse('Proporciona userId o clientId para recalcular el contador.');
      }
      if (error.message === 'USER_NOT_FOUND') {
        return buildErrorResponse('No encontramos al cliente indicado.', 404);
      }
    }
    console.error('GET /api/user/coffee-count falló', error);
    return buildErrorResponse('No pudimos recalcular el contador semanal.', 502);
  }
}

export async function POST(request: NextRequest) {
  try {
    ensureLoyaltyProductsConfigured();
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const identifier = extractUserIdentifier(request, payload);
    const punches = Number(payload?.punches ?? 1);
    const increment = Number.isFinite(punches) ? Math.max(1, Math.floor(punches)) : 1;

    const user = await fetchUserRecord(identifier);
    if (user.rewardEarned) {
      return buildErrorResponse('El cliente tiene un Americano pendiente de canje. Resetea antes de sumar más.', 409);
    }

    const nextState = addWeeklyPunches(user.weeklyCoffeeCount ?? 0, increment);
    const { error: updateError } = await supabaseAdmin
      .from(USERS_TABLE)
      .update({
        weeklyCoffeeCount: nextState.weeklyCoffeeCount,
        rewardEarned: nextState.rewardEarned,
      })
      .eq('id', user.id)
      .select('weeklyCoffeeCount,rewardEarned')
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      data: {
        userId: user.id,
        weeklyCoffeeCount: nextState.weeklyCoffeeCount,
        rewardEarned: nextState.rewardEarned,
        maxStamps: LOYALTY_STAMPS_TARGET,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === LOYALTY_PRODUCTS_REQUIRED_ERROR) {
        return buildErrorResponse('Define LOYALTY_ELIGIBLE_PRODUCTS antes de consumir este endpoint.', 500);
      }
      if (error.message === 'IDENTIFIER_MISSING') {
        return buildErrorResponse('Envía userId o clientId en la petición.');
      }
      if (error.message === 'USER_NOT_FOUND') {
        return buildErrorResponse('No encontramos al cliente indicado.', 404);
      }
    }
    console.error('POST /api/user/coffee-count falló', error);
    return buildErrorResponse('No pudimos sumar sellos esta vez.', 502);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const identifier = extractUserIdentifier(request, payload);
    const user = await fetchUserRecord(identifier);

    const { error } = await supabaseAdmin
      .from(USERS_TABLE)
      .update({ weeklyCoffeeCount: 0, rewardEarned: false })
      .eq('id', user.id);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      data: { userId: user.id, weeklyCoffeeCount: 0, rewardEarned: false },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'IDENTIFIER_MISSING') {
        return buildErrorResponse('Envía userId o clientId para reiniciar el contador.');
      }
      if (error.message === 'USER_NOT_FOUND') {
        return buildErrorResponse('No encontramos al cliente indicado.', 404);
      }
    }
    console.error('PUT /api/user/coffee-count falló', error);
    return buildErrorResponse('No pudimos reiniciar el contador.', 502);
  }
}

export const dynamic = 'force-dynamic';
