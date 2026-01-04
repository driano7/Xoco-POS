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

const TABLE = process.env.SUPABASE_STAFF_GOV_REQUESTS_TABLE ?? 'staff_governance_requests';
const MAX_LIMIT = Number(process.env.GOVERNANCE_REQUESTS_LIMIT ?? 100);

const normalizeEmail = (value?: string | null) =>
  typeof value === 'string' ? value.trim().toLowerCase() : null;

const ALLOWED_TYPES = new Set([
  'salary',
  'role',
  'branch',
  'manager',
  'termination',
  'branch-edit',
  'inventory',
  'evaluation',
]);

const ALLOWED_STATUS = new Set(['pending', 'requires_changes', 'approved', 'declined']);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') ?? MAX_LIMIT), MAX_LIMIT);
    const statusFilter = searchParams.get('status');
    const typeFilter = searchParams.get('type');
    const employeeEmail = normalizeEmail(searchParams.get('employeeEmail'));

    let query = supabaseAdmin.from(TABLE).select('*').order('created_at', { ascending: false }).limit(limit);

    if (statusFilter && ALLOWED_STATUS.has(statusFilter)) {
      query = query.eq('status', statusFilter);
    }
    if (typeFilter && ALLOWED_TYPES.has(typeFilter)) {
      query = query.eq('type', typeFilter);
    }
    if (employeeEmail) {
      query = query.ilike('employee_email', employeeEmail);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error('GET /api/staff-governance/requests failed:', error);
    return NextResponse.json({ success: false, error: 'No pudimos obtener las solicitudes.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      employeeEmail?: string;
      branchId?: string | null;
      type?: string;
      payload?: unknown;
      createdBy?: string;
      deadline?: string | null;
      status?: string | null;
    };

    const employeeEmail = normalizeEmail(payload.employeeEmail);
    const createdBy = normalizeEmail(payload.createdBy);
    const type = payload.type && ALLOWED_TYPES.has(payload.type) ? payload.type : null;
    const requestedStatus = payload.status && ALLOWED_STATUS.has(payload.status) ? payload.status : 'pending';
    const requestPayload =
      payload.payload && typeof payload.payload === 'object' ? payload.payload : { note: payload.payload ?? null };

    if (!employeeEmail || !createdBy || !type) {
      return NextResponse.json(
        { success: false, error: 'employeeEmail, createdBy y type son obligatorios.' },
        { status: 400 }
      );
    }

    const deadline =
      typeof payload.deadline === 'string' && !Number.isNaN(Date.parse(payload.deadline))
        ? new Date(payload.deadline).toISOString()
        : null;

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert({
        employee_email: employeeEmail,
        branch_id: payload.branchId ?? null,
        type,
        payload: requestPayload,
        created_by: createdBy,
        status: requestedStatus,
        deadline,
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/staff-governance/requests failed:', error);
    return NextResponse.json({ success: false, error: 'No pudimos registrar la solicitud.' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
