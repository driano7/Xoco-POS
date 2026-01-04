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

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const TABLE = process.env.SUPABASE_PEST_CONTROL_TABLE ?? 'pest_control_logs';
const ALERT_DAYS = Number(process.env.PEST_CONTROL_ALERT_DAYS ?? 80);

type PestRecord = {
  id: string;
  serviceDate: string;
  providerName?: string | null;
  certificateNumber?: string | null;
  nextServiceDate?: string | null;
  staffId?: string | null;
  observations?: string | null;
  createdAt: string;
};

const normalizeRecord = (record: Record<string, unknown>): PestRecord => ({
  id: String(record.id ?? ''),
  serviceDate:
    (record.serviceDate as string | null) ??
    (record.service_date as string | null) ??
    new Date().toISOString(),
  providerName:
    (record.providerName as string | null) ?? (record.provider_name as string | null) ?? null,
  certificateNumber:
    (record.certificateNumber as string | null) ??
    (record.certificate_number as string | null) ??
    null,
  nextServiceDate:
    (record.nextServiceDate as string | null) ??
    (record.next_service_date as string | null) ??
    null,
  staffId: (record.staffId as string | null) ?? (record.staff_id as string | null) ?? null,
  observations: (record.observations as string | null) ?? null,
  createdAt:
    (record.createdAt as string | null) ??
    (record.created_at as string | null) ??
    new Date().toISOString(),
});

const buildAlertMessage = (daysSince: number | null, nextServiceDate?: string | null) => {
  if (daysSince === null) {
    return 'Sin registros de fumigación · actualiza cuanto antes.';
  }
  if (daysSince > ALERT_DAYS) {
    return 'RENOVAR FUMIGACIÓN - REQUERIMIENTO COFEPRIS';
  }
  if (nextServiceDate && Date.parse(nextServiceDate) <= Date.now()) {
    return 'Fumigación vencida · reagenda servicio.';
  }
  if (daysSince >= ALERT_DAYS - 10) {
    return 'Fumigación por vencer · agenda servicio preventivo.';
  }
  return null;
};

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select(
        'id,"service_date","provider_name","certificate_number","next_service_date","staffId",observations,"createdAt"'
      )
      .order('service_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    const latest = data ? normalizeRecord(data) : null;
    const daysSince =
      latest?.serviceDate && !Number.isNaN(Date.parse(latest.serviceDate))
        ? Math.floor((Date.now() - Date.parse(latest.serviceDate)) / 86400000)
        : null;
    const alertMessage = buildAlertMessage(daysSince, latest?.nextServiceDate ?? null);

    return NextResponse.json({
      success: true,
      data: {
        latest,
        daysSince,
        alertMessage,
        alert: Boolean(alertMessage && alertMessage.includes('RENOVAR FUMIGACIÓN')),
      },
    });
  } catch (error) {
    console.error('Error fetching pest control log:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos cargar el control de plagas.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      serviceDate?: string;
      providerName?: string;
      certificateNumber?: string;
      nextServiceDate?: string;
      staffId?: string;
      observations?: string;
    };
    if (!payload.serviceDate) {
      return NextResponse.json(
        { success: false, error: 'Necesitamos la fecha del servicio de fumigación.' },
        { status: 400 }
      );
    }

    const insertPayload = {
      service_date: new Date(payload.serviceDate).toISOString(),
      provider_name: payload.providerName?.trim() || null,
      certificate_number: payload.certificateNumber?.trim() || null,
      next_service_date: payload.nextServiceDate
        ? new Date(payload.nextServiceDate).toISOString()
        : null,
      staffId: payload.staffId ?? null,
      observations: payload.observations?.trim() || null,
    };

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert(insertPayload)
      .select(
        'id,"service_date","provider_name","certificate_number","next_service_date","staffId",observations,"createdAt"'
      )
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      data: normalizeRecord(data),
    });
  } catch (error) {
    console.error('Error saving pest control log:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos guardar el certificado de fumigación.' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
