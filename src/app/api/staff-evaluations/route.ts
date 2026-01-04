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

const TABLE = process.env.SUPABASE_STAFF_EVALS_TABLE ?? 'staff_evaluations';
const MAX_LIMIT = Number(process.env.STAFF_EVALS_LIMIT ?? 100);

const normalizeEmail = (value?: string | null) =>
  typeof value === 'string' ? value.trim().toLowerCase() : null;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') ?? MAX_LIMIT), MAX_LIMIT);
    const employee = normalizeEmail(searchParams.get('employeeEmail'));
    const reviewer = normalizeEmail(searchParams.get('reviewerEmail'));

    let query = supabaseAdmin.from(TABLE).select('*').order('created_at', { ascending: false }).limit(limit);
    if (employee) {
      query = query.ilike('employee_email', employee);
    }
    if (reviewer) {
      query = query.ilike('reviewer_email', reviewer);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error('GET /api/staff-evaluations failed:', error);
    return NextResponse.json({ success: false, error: 'No pudimos obtener evaluaciones' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      employeeEmail?: string;
      reviewerEmail?: string;
      encryptedComment?: string;
      score?: number | null;
    };

    const employeeEmail = normalizeEmail(payload.employeeEmail);
    const reviewerEmail = normalizeEmail(payload.reviewerEmail);
    const encryptedComment =
      typeof payload.encryptedComment === 'string' && payload.encryptedComment.trim()
        ? payload.encryptedComment.trim()
        : null;
    const score =
      typeof payload.score === 'number' && Number.isFinite(payload.score) ? Number(payload.score) : null;

    if (!employeeEmail || !reviewerEmail || !encryptedComment) {
      return NextResponse.json(
        { success: false, error: 'employeeEmail, reviewerEmail y encryptedComment son obligatorios.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert({
        employee_email: employeeEmail,
        reviewer_email: reviewerEmail,
        encrypted_comment: encryptedComment,
        score,
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/staff-evaluations failed:', error);
    return NextResponse.json({ success: false, error: 'No pudimos registrar la evaluación.' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
