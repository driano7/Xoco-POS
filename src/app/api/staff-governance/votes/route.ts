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

const TABLE = process.env.SUPABASE_STAFF_GOV_VOTES_TABLE ?? 'staff_governance_votes';
const REQUESTS_TABLE = process.env.SUPABASE_STAFF_GOV_REQUESTS_TABLE ?? 'staff_governance_requests';
const MAX_LIMIT = Number(process.env.GOVERNANCE_VOTES_LIMIT ?? 100);

const normalizeEmail = (value?: string | null) =>
  typeof value === 'string' ? value.trim().toLowerCase() : null;

const ALLOWED_DECISIONS = new Set(['pending', 'approved', 'declined']);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') ?? MAX_LIMIT), MAX_LIMIT);
    const requestId = searchParams.get('requestId');
    const reviewerEmail = normalizeEmail(searchParams.get('reviewerEmail'));

    let query = supabaseAdmin.from(TABLE).select('*').order('decided_at', { ascending: false }).limit(limit);
    if (requestId) {
      query = query.eq('request_id', requestId);
    }
    if (reviewerEmail) {
      query = query.ilike('reviewer_email', reviewerEmail);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error('GET /api/staff-governance/votes failed:', error);
    return NextResponse.json({ success: false, error: 'No pudimos obtener los votos.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      requestId?: string;
      reviewerEmail?: string;
      decision?: string;
      comment?: string | null;
    };

    const requestId = payload.requestId?.trim();
    const reviewerEmail = normalizeEmail(payload.reviewerEmail);
    const decision = payload.decision && ALLOWED_DECISIONS.has(payload.decision) ? payload.decision : 'pending';
    const comment = typeof payload.comment === 'string' ? payload.comment.trim() : null;

    if (!requestId || !reviewerEmail) {
      return NextResponse.json(
        { success: false, error: 'requestId y reviewerEmail son obligatorios.' },
        { status: 400 }
      );
    }

    const { data: requestExists, error: requestError } = await supabaseAdmin
      .from(REQUESTS_TABLE)
      .select('id')
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) {
      throw requestError;
    }
    if (!requestExists) {
      return NextResponse.json({ success: false, error: 'La solicitud no existe.' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .upsert(
        {
          request_id: requestId,
          reviewer_email: reviewerEmail,
          decision,
          comment,
          decided_at: decision === 'pending' ? null : new Date().toISOString(),
        },
        { onConflict: 'request_id,reviewer_email' }
      )
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/staff-governance/votes failed:', error);
    return NextResponse.json({ success: false, error: 'No pudimos registrar el voto.' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
