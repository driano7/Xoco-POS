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
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-server';
import { verifyToken } from '@/lib/jwt';

const RedeemSchema = z.object({
  code: z.string().min(3),
});

const errorResponse = (message: string, status = 400) =>
  NextResponse.json({ success: false, message }, { status });

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return errorResponse('Token no proporcionado', 401);
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return errorResponse('Token inválido', 401);
    }

    const body = await request.json();
    const payload = RedeemSchema.parse(body);
    const normalizedCode = payload.code.trim().toUpperCase();

    const { data: promo, error: promoError } = await supabaseAdmin
      .from('promo_codes')
      .select('*')
      .eq('code', normalizedCode)
      .maybeSingle();

    if (promoError) {
      throw new Error(promoError.message);
    }

    if (!promo || !promo.isActive) {
      return errorResponse('El código no es válido o está inactivo.');
    }

    const now = Date.now();
    if (promo.validFrom && new Date(promo.validFrom).getTime() > now) {
      return errorResponse('El código aún no está activo.');
    }
    if (promo.expiresAt && new Date(promo.expiresAt).getTime() < now) {
      return errorResponse('El código ha expirado.');
    }

    if (promo.maxRedemptions) {
      const { count: totalCount, error: totalError } = await supabaseAdmin
        .from('promo_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('promoCodeId', promo.id)
        .eq('status', 'redeemed');

      if (totalError) {
        throw new Error(totalError.message);
      }
      if (typeof totalCount === 'number' && totalCount >= promo.maxRedemptions) {
        return errorResponse('Este código alcanzó el número máximo de usos.');
      }
    }

    const perUserLimit = promo.perUserLimit ?? 1;
    if (perUserLimit > 0) {
      const { count: userCount, error: userError } = await supabaseAdmin
        .from('promo_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('promoCodeId', promo.id)
        .eq('userId', decoded.userId)
        .eq('status', 'redeemed');

      if (userError) {
        throw new Error(userError.message);
      }
      if (typeof userCount === 'number' && userCount >= perUserLimit) {
        return errorResponse('Ya usaste este código.');
      }
    }

    const redemptionId = randomUUID();
    const { error: insertError } = await supabaseAdmin.from('promo_redemptions').insert({
      id: redemptionId,
      promoCodeId: promo.id,
      userId: decoded.userId,
      status: 'redeemed',
      context: {
        source: 'client_app',
        redeemedAt: new Date().toISOString(),
      },
    });

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({
      success: true,
      data: {
        redemptionId,
        code: promo.code,
        appliesTo: promo.appliesTo,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        durationDays: promo.durationDays,
        metadata: promo.metadata,
      },
      message: 'Código aplicado correctamente.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse('Datos inválidos', 400);
    }
    console.error('Error redimiendo código promocional:', error);
    return errorResponse('No pudimos validar tu código en este momento.', 500);
  }
}
