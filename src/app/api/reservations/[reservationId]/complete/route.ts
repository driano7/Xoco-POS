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

const RESERVATIONS_TABLE = process.env.SUPABASE_RESERVATIONS_TABLE ?? 'reservations';
const ALLOWED_STATUSES = new Set(['completed', 'cancelled']);

export async function POST(request: Request, context: { params: { reservationId?: string } }) {
  const reservationId = context.params?.reservationId?.trim();

  if (!reservationId) {
    return NextResponse.json(
      { success: false, error: 'Falta el ID de la reservación' },
      { status: 400 }
    );
  }

  try {
    let requestedStatus: string | null = null;
    try {
      const payload = await request.json();
      if (payload && typeof payload.status === 'string') {
        requestedStatus = payload.status.trim().toLowerCase();
      }
    } catch {
      requestedStatus = null;
    }

    const status = requestedStatus && ALLOWED_STATUSES.has(requestedStatus)
      ? requestedStatus
      : 'completed';

    const now = new Date().toISOString();
    const {
      data,
      error,
    } = await supabaseAdmin
      .from(RESERVATIONS_TABLE)
      .update({ status, updatedAt: now })
      .eq('id', reservationId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'No encontramos la reservación' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { id: data.id, status } });
  } catch (error) {
    console.error('Error actualizando reservación:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos actualizar la reservación' },
      { status: 500 }
    );
  }
}
