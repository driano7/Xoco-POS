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

const APPLY_TARGETS = ['product', 'membership', 'both'] as const;
const DISCOUNT_TYPES = ['percentage', 'amount', 'trial'] as const;

const ManagePromoSchema = z.object({
  code: z.string().min(4).max(32),
  description: z.string().max(280).optional().nullable(),
  appliesTo: z.enum(APPLY_TARGETS).default('product'),
  discountType: z.enum(DISCOUNT_TYPES).default('percentage'),
  discountValue: z.number().nonnegative().optional().nullable(),
  durationDays: z.number().int().positive().optional().nullable(),
  maxRedemptions: z.number().int().positive().optional().nullable(),
  perUserLimit: z.number().int().positive().optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
  validFrom: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  isActive: z.boolean().optional().nullable(),
});

const requireAdminKey = (request: NextRequest) => {
  const adminKey = process.env.PROMO_ADMIN_KEY;
  if (!adminKey) {
    throw new Error('PROMO_ADMIN_KEY is not configured on the server');
  }
  const provided = request.headers.get('x-xoco-promo-key');
  if (!provided || provided !== adminKey) {
    return false;
  }
  return true;
};

export async function POST(request: NextRequest) {
  try {
    if (!requireAdminKey(request)) {
      return NextResponse.json(
        { success: false, message: 'Acceso no autorizado' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const payload = ManagePromoSchema.parse(body);
    const uppercaseCode = payload.code.trim().toUpperCase();

    const nowISO = new Date().toISOString();
    const validFrom = payload.validFrom ? new Date(payload.validFrom).toISOString() : nowISO;
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt).toISOString() : null;

    const { data: existing } = await supabaseAdmin
      .from('promo_codes')
      .select('id')
      .eq('code', uppercaseCode)
      .maybeSingle();

    const promoRecord = {
      code: uppercaseCode,
      description: payload.description ?? null,
      appliesTo: payload.appliesTo,
      discountType: payload.discountType,
      discountValue: payload.discountValue ?? null,
      durationDays: payload.durationDays ?? null,
      maxRedemptions: payload.maxRedemptions ?? null,
      perUserLimit: payload.perUserLimit ?? 1,
      metadata: payload.metadata ?? null,
      validFrom,
      expiresAt,
      isActive: payload.isActive ?? true,
      updatedAt: nowISO,
    };

    if (existing?.id) {
      const { data, error } = await supabaseAdmin
        .from('promo_codes')
        .update(promoRecord)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return NextResponse.json({ success: true, data });
    }

    const newRecord = {
      ...promoRecord,
      id: randomUUID(),
      createdBy: payload.metadata?.createdBy ?? 'pos',
      createdAt: nowISO,
    };

    const { data, error } = await supabaseAdmin
      .from('promo_codes')
      .insert(newRecord)
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: 'Datos inválidos', errors: error.issues },
        { status: 400 }
      );
    }
    console.error('Error creando/actualizando promoción:', error);
    return NextResponse.json(
      { success: false, message: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
