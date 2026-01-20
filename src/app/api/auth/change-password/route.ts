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

import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-server';
import { meetsPasswordPolicy, PASSWORD_POLICY_MESSAGE } from '@/lib/password-policy';
import { sendPasswordChangedEmail } from '@/lib/mailer';

const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';

export async function POST(request: Request) {
  try {
    const { userId, email, currentPassword, newPassword } = (await request.json()) as {
      userId?: string;
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    };

    if (!userId || !email || !currentPassword || !newPassword) {
      return NextResponse.json(
        { success: false, error: 'Falta información para validar el cambio.' },
        { status: 400 }
      );
    }

    const { data: staffRecord, error: staffError } = await supabaseAdmin
      .from(STAFF_TABLE)
      .select('id,email,"passwordHash"')
      .or(`id.eq.${userId},email.eq.${email}`)
      .maybeSingle();

    if (staffError) {
      throw new Error(staffError.message);
    }

    if (!staffRecord || !staffRecord.passwordHash) {
      return NextResponse.json(
        { success: false, error: 'No encontramos al usuario solicitado.' },
        { status: 404 }
      );
    }

    const matches = await bcrypt.compare(currentPassword, staffRecord.passwordHash);
    if (!matches) {
      return NextResponse.json(
        { success: false, error: 'La contraseña actual no coincide.' },
        { status: 401 }
      );
    }

    if (!meetsPasswordPolicy(newPassword, staffRecord.email ?? email)) {
      return NextResponse.json(
        {
          success: false,
          error: PASSWORD_POLICY_MESSAGE,
        },
        { status: 400 }
      );
    }

    const hashed = await bcrypt.hash(newPassword, 12);

    const changedAt = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from(STAFF_TABLE)
      .update({ passwordHash: hashed, updatedAt: changedAt })
      .eq('id', staffRecord.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    const requestIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const requestAgent = request.headers.get('user-agent');
    if (staffRecord.email) {
      void sendPasswordChangedEmail({
        to: staffRecord.email,
        displayName: staffRecord.email,
        changedAt,
        ip: requestIp,
        userAgent: requestAgent,
      }).catch((error) => {
        console.error('Error sending password change email:', error);
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error al actualizar contraseña de staff:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos actualizar la contraseña.' },
      { status: 500 }
    );
  }
}
