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

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { sqlite } from '@/lib/sqlite';
import {
  enqueuePendingOperations,
  flushPendingOperations,
  isLikelyNetworkError,
  markSupabaseFailure,
  markSupabaseHealthy,
  shouldPreferSupabase,
} from '@/lib/offline-sync';

const TABLE = process.env.SUPABASE_PEST_CONTROL_TABLE ?? 'pest_control_logs';
const SQLITE_TABLE = 'pest_control_logs';
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

const upsertSqliteRecord = async (record: PestRecord) => {
  await sqlite.run(
    `
    INSERT INTO ${SQLITE_TABLE} (
      id,
      service_date,
      provider_name,
      certificate_number,
      next_service_date,
      staffId,
      observations,
      createdAt
    ) VALUES (
      :id,
      :service_date,
      :provider_name,
      :certificate_number,
      :next_service_date,
      :staffId,
      :observations,
      :createdAt
    )
    ON CONFLICT(id) DO UPDATE SET
      service_date = excluded.service_date,
      provider_name = excluded.provider_name,
      certificate_number = excluded.certificate_number,
      next_service_date = excluded.next_service_date,
      staffId = excluded.staffId,
      observations = excluded.observations,
      createdAt = excluded.createdAt
  `,
    {
      ':id': record.id,
      ':service_date': record.serviceDate,
      ':provider_name': record.providerName ?? null,
      ':certificate_number': record.certificateNumber ?? null,
      ':next_service_date': record.nextServiceDate ?? null,
      ':staffId': record.staffId ?? null,
      ':observations': record.observations ?? null,
      ':createdAt': record.createdAt,
    }
  );
};

const loadLatestFromSqlite = async (): Promise<PestRecord | null> => {
  const row = await sqlite.get<Record<string, unknown>>(
    `
    SELECT
      id,
      service_date,
      provider_name,
      certificate_number,
      next_service_date,
      staffId,
      observations,
      createdAt
    FROM ${SQLITE_TABLE}
    ORDER BY service_date DESC
    LIMIT 1
  `
  );
  return row ? normalizeRecord(row) : null;
};

const queuePestInsert = async (payload: Record<string, unknown>) => {
  await enqueuePendingOperations('pest_control:insert', [
    {
      type: 'insert',
      table: TABLE,
      payload,
    },
  ]);
};

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
    const respond = (latest: PestRecord | null) => {
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
    };

    const preferSupabase = shouldPreferSupabase();

    const loadFromSqlite = async () => {
      const latest = await loadLatestFromSqlite();
      return respond(latest);
    };

    if (!preferSupabase) {
      return loadFromSqlite();
    }

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
      markSupabaseHealthy();
      if (latest) {
        await upsertSqliteRecord(latest);
      }
      return respond(latest);
    } catch (error) {
      if (!isLikelyNetworkError(error)) {
        throw error;
      }
      markSupabaseFailure(error);
      return loadFromSqlite();
    }
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
    await flushPendingOperations();
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

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const insertPayload = {
      id,
      service_date: new Date(payload.serviceDate).toISOString(),
      provider_name: payload.providerName?.trim() || null,
      certificate_number: payload.certificateNumber?.trim() || null,
      next_service_date: payload.nextServiceDate ? new Date(payload.nextServiceDate).toISOString() : null,
      staffId: payload.staffId ?? null,
      observations: payload.observations?.trim() || null,
      createdAt,
    };
    const localRecord = normalizeRecord(insertPayload);
    const preferSupabase = shouldPreferSupabase();
    let attemptedSupabase = false;

    if (preferSupabase) {
      try {
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

        const normalized = normalizeRecord(data);
        await upsertSqliteRecord(normalized);
        markSupabaseHealthy();
        return NextResponse.json(
          {
            success: true,
            data: normalized,
            pendingSync: false,
          },
          { status: 201 }
        );
      } catch (error) {
        attemptedSupabase = true;
        if (!isLikelyNetworkError(error)) {
          console.error('Error saving pest control log:', error);
          return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'No pudimos guardar el certificado de fumigación.' },
            { status: 500 }
          );
        }
        markSupabaseFailure(error);
      }
    }

    await upsertSqliteRecord(localRecord);
    await queuePestInsert(insertPayload);
    return NextResponse.json(
      {
        success: true,
        data: localRecord,
        pendingSync: true,
      },
      { status: attemptedSupabase ? 202 : 201 }
    );
  } catch (error) {
    console.error('Error saving pest control log:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos guardar el certificado de fumigación.' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
