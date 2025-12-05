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

import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-server';
import { meetsPasswordPolicy, PASSWORD_POLICY_MESSAGE } from '@/lib/password-policy';

const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';
const PASSWORD_RESET_TABLE = process.env.SUPABASE_PASSWORD_RESETS_TABLE ?? 'staff_password_resets';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function POST(request: Request) {
  try {
    const { token, newPassword } = (await request.json()) as {
      token?: string;
      newPassword?: string;
    };

    if (!token || !newPassword) {
      return NextResponse.json(
        { success: false, error: 'Falta información para restablecer la contraseña.' },
        { status: 400 }
      );
    }

    const hashedToken = hashToken(token);

    const { data: resetRecord, error: resetError } = await supabaseAdmin
      .from(PASSWORD_RESET_TABLE)
      .select('id,email,staff_id,expires_at,used_at')
      .eq('token_hash', hashedToken)
      .maybeSingle();

    if (resetError) {
      throw resetError;
    }

    if (!resetRecord || resetRecord.used_at) {
      return NextResponse.json(
        { success: false, error: 'El enlace que usaste ya no es válido.' },
        { status: 400 }
      );
    }

    if (new Date(resetRecord.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { success: false, error: 'El enlace ha expirado. Solicita uno nuevo.' },
        { status: 400 }
      );
    }

    const staffQuery = supabaseAdmin.from(STAFF_TABLE).select('id,email');
    const staffFilter =
      resetRecord.staff_id != null
        ? staffQuery.eq('id', resetRecord.staff_id)
        : staffQuery.ilike('email', resetRecord.email);

    const { data: staffRecord, error: staffError } = await staffFilter.maybeSingle();

    if (staffError) {
      throw staffError;
    }

    if (!staffRecord) {
      return NextResponse.json(
        { success: false, error: 'No encontramos al usuario asociado al enlace.' },
        { status: 404 }
      );
    }

    if (!meetsPasswordPolicy(newPassword, staffRecord.email ?? resetRecord.email)) {
      return NextResponse.json(
        { success: false, error: PASSWORD_POLICY_MESSAGE },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const { error: updateError } = await supabaseAdmin
      .from(STAFF_TABLE)
      .update({ passwordHash: hashedPassword })
      .eq('id', staffRecord.id);

    if (updateError) {
      throw updateError;
    }

    await supabaseAdmin
      .from(PASSWORD_RESET_TABLE)
      .update({ used_at: new Date().toISOString() })
      .eq('id', resetRecord.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error al confirmar reset de contraseña:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos actualizar tu contraseña.' },
      { status: 500 }
    );
  }
}
