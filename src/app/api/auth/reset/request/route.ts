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

import { createHash, randomBytes, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { sendPasswordResetEmail } from '@/lib/mailer';
import {
  invalidateResetRecordsForEmail,
  isResetTableAvailable,
  markResetTableUnavailable,
  upsertResetRecord,
} from '@/lib/password-reset-store';

const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';
const PASSWORD_RESET_TABLE = process.env.SUPABASE_PASSWORD_RESETS_TABLE ?? 'staff_password_resets';
const RESET_TOKEN_TTL_MINUTES = Number(process.env.POS_PASSWORD_RESET_TTL_MINUTES ?? 30);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const isMissingTableError = (error: { message?: string } | null) =>
  Boolean(error?.message && error.message.toLowerCase().includes(PASSWORD_RESET_TABLE));

const resolveOrigin = (request: Request) => {
  const headerOrigin = request.headers.get('origin');
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    (headerOrigin?.startsWith('http') ? headerOrigin : null) ||
    'http://localhost:8000'
  );
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export async function POST(request: Request) {
  try {
    const { email } = (await request.json()) as { email?: string };

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { success: false, error: 'Indica un correo válido.' },
        { status: 400 }
      );
    }

    const normalizedEmail = normalizeEmail(email);

    const { data: staffRecord, error: staffError } = await supabaseAdmin
      .from(STAFF_TABLE)
      .select('id,email')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (staffError) {
      throw staffError;
    }

    if (!staffRecord) {
      return NextResponse.json({ success: true });
    }

    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
    const resetId = randomUUID();
    const cleanupTimestamp = new Date().toISOString();

    if (isResetTableAvailable()) {
      const { error: cleanupError } = await supabaseAdmin
        .from(PASSWORD_RESET_TABLE)
        .delete()
        .eq('email', normalizedEmail)
        .is('used_at', null);
      if (cleanupError) {
        if (isMissingTableError(cleanupError)) {
          markResetTableUnavailable();
        } else {
          throw cleanupError;
        }
      }
    }

    invalidateResetRecordsForEmail(normalizedEmail, cleanupTimestamp);

    const requestIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const requestAgent = request.headers.get('user-agent');

    const insertPayload = {
      id: resetId,
      staff_id: staffRecord.id,
      email: normalizedEmail,
      token_hash: hashedToken,
      requested_ip: requestIp,
      requested_user_agent: requestAgent,
      expires_at: expiresAt,
    };

    if (isResetTableAvailable()) {
      const { error: insertError } = await supabaseAdmin
        .from(PASSWORD_RESET_TABLE)
        .insert(insertPayload);
      if (insertError) {
        if (isMissingTableError(insertError)) {
          markResetTableUnavailable();
        } else {
          throw insertError;
        }
      }
    }

    upsertResetRecord({
      id: resetId,
      staffId: staffRecord.id ?? null,
      email: normalizedEmail,
      tokenHash: hashedToken,
      expiresAt,
      requestedIp: requestIp ?? null,
      requestedUserAgent: requestAgent ?? null,
      usedAt: null,
    });

    const origin = resolveOrigin(request);
    const resetUrl = new URL('/reset-password', origin);
    resetUrl.searchParams.set('token', rawToken);

    const requester = [requestIp, requestAgent].filter(Boolean).join(' · ');

    await sendPasswordResetEmail({
      to: staffRecord.email ?? normalizedEmail,
      resetUrl: resetUrl.toString(),
      expiresMinutes: RESET_TOKEN_TTL_MINUTES,
      requester,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error al generar reset de contraseña:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos procesar la solicitud. Intenta más tarde.' },
      { status: 500 }
    );
  }
}
