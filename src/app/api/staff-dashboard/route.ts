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
import { supabaseAdmin } from '@/lib/supabase-server';

const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';
const SESSIONS_TABLE = process.env.SUPABASE_STAFF_SESSIONS_TABLE ?? 'staff_sessions';
const MAX_STAFF = Number(process.env.STAFF_DASHBOARD_LIMIT ?? 200);
const MAX_SESSIONS = Number(process.env.STAFF_SESSION_LIMIT ?? 100);

export async function GET() {
  try {
    const [{ data: staff, error: staffError }, { data: sessions, error: sessionsError }] =
      await Promise.all([
        supabaseAdmin
          .from(STAFF_TABLE)
          .select(
            'id,email,role,"branchId",is_active,"createdAt","updatedAt","lastLoginAt","firstNameEncrypted","lastNameEncrypted"'
          )
          .order('createdAt', { ascending: false })
          .limit(MAX_STAFF),
        supabaseAdmin
          .from(SESSIONS_TABLE)
          .select(
            'id,"staffId","sessionStart","sessionEnd","durationSeconds","ipAddress","deviceType","createdAt","updatedAt"'
          )
          .order('sessionStart', { ascending: false })
          .limit(MAX_SESSIONS),
      ]);

    if (staffError || sessionsError) {
      const message = staffError?.message || sessionsError?.message || 'Failed to fetch staff data';
      throw new Error(message);
    }

    const normalizedStaff = (staff ?? []).map((member) => ({
      id: member.id,
      email: member.email,
      role: member.role,
      branchId: member.branchId,
      isActive: member.is_active ?? (member as { isActive?: boolean }).isActive ?? true,
      firstNameEncrypted: member.firstNameEncrypted ?? null,
      lastNameEncrypted: member.lastNameEncrypted ?? null,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      lastLoginAt: member.lastLoginAt,
    }));

    const staffMap = new Map(normalizedStaff.map((member) => [member.id, member]));

    const normalizedSessions = (sessions ?? []).map((session) => ({
      ...session,
      staff: session.staffId ? staffMap.get(session.staffId) ?? null : null,
      isActive: !session.sessionEnd,
    }));

    const totalStaff = normalizedStaff.length;
    const activeStaff = normalizedStaff.filter((member) => member.isActive).length;
    const roleMap = new Map<string, number>();

    normalizedStaff.forEach((member) => {
      const key = member.role || 'desconocido';
      roleMap.set(key, (roleMap.get(key) || 0) + 1);
    });

    const roles = Array.from(roleMap.entries()).map(([role, count]) => ({ role, count }));
    const activeSessions = normalizedSessions.filter((session) => session.isActive);

    return NextResponse.json({
      success: true,
      data: {
        staff: normalizedStaff,
        sessions: normalizedSessions,
        metrics: {
          totalStaff,
          activeStaff,
          roles,
          activeSessions: activeSessions.length,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching staff dashboard:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch staff dashboard' },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-dynamic';
