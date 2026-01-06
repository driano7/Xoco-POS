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

const TABLE = process.env.SUPABASE_WASTE_TABLE ?? 'waste_logs';
const SQLITE_TABLE = 'waste_logs';

type WasteRecord = {
  id: string;
  organicBeveragesKg: number;
  organicFoodsKg: number;
  inorganicKg: number;
  trashRemoved: boolean;
  binsWashed: boolean;
  branchId?: string | null;
  staffId?: string | null;
  createdAt: string;
};

const normalizeRecord = (record: Record<string, unknown>): WasteRecord => ({
  id: String(record.id ?? ''),
  organicBeveragesKg: Number(record.organicBeveragesKg ?? record.organic_beverages_kg ?? 0),
  organicFoodsKg: Number(record.organicFoodsKg ?? record.organic_foods_kg ?? 0),
  inorganicKg: Number(record.inorganicKg ?? record.inorganic_kg ?? 0),
  trashRemoved: Boolean(record.trashRemoved ?? record.trash_removed ?? false),
  binsWashed: Boolean(record.binsWashed ?? record.bins_washed ?? false),
  branchId: (record.branchId as string | null) ?? (record.branch_id as string | null) ?? null,
  staffId: (record.staffId as string | null) ?? (record.staff_id as string | null) ?? null,
  createdAt:
    (record.createdAt as string | null) ??
    (record.created_at as string | null) ??
    new Date().toISOString(),
});

const upsertSqliteRecord = async (record: WasteRecord) => {
  await sqlite.run(
    `
    INSERT INTO ${SQLITE_TABLE} (
      id,
      organicBeveragesKg,
      organicFoodsKg,
      inorganicKg,
      trashRemoved,
      binsWashed,
      branchId,
      staffId,
      createdAt
    ) VALUES (
      :id,
      :organicBeveragesKg,
      :organicFoodsKg,
      :inorganicKg,
      :trashRemoved,
      :binsWashed,
      :branchId,
      :staffId,
      :createdAt
    )
    ON CONFLICT(id) DO UPDATE SET
      organicBeveragesKg = excluded.organicBeveragesKg,
      organicFoodsKg = excluded.organicFoodsKg,
      inorganicKg = excluded.inorganicKg,
      trashRemoved = excluded.trashRemoved,
      binsWashed = excluded.binsWashed,
      branchId = excluded.branchId,
      staffId = excluded.staffId,
      createdAt = excluded.createdAt
  `,
    {
      ':id': record.id,
      ':organicBeveragesKg': record.organicBeveragesKg,
      ':organicFoodsKg': record.organicFoodsKg,
      ':inorganicKg': record.inorganicKg,
      ':trashRemoved': record.trashRemoved ? 1 : 0,
      ':binsWashed': record.binsWashed ? 1 : 0,
      ':branchId': record.branchId ?? null,
      ':staffId': record.staffId ?? null,
      ':createdAt': record.createdAt,
    }
  );
};

const loadSqliteLogs = async (): Promise<WasteRecord[]> => {
  const rows = await sqlite.all<Record<string, unknown>>(
    `
    SELECT
      id,
      organicBeveragesKg,
      organicFoodsKg,
      inorganicKg,
      trashRemoved,
      binsWashed,
      branchId,
      staffId,
      createdAt
    FROM ${SQLITE_TABLE}
    ORDER BY createdAt DESC
    LIMIT 15
  `
  );
  return rows.map((row) => normalizeRecord(row));
};

const queueWasteInsert = async (payload: Record<string, unknown>) => {
  await enqueuePendingOperations('waste_logs:insert', [
    {
      type: 'insert',
      table: TABLE,
      payload,
    },
  ]);
};

export async function GET() {
  try {
    const preferSupabase = shouldPreferSupabase();
    const loadFromSqlite = async () => {
      const logs = await loadSqliteLogs();
      return NextResponse.json({
        success: true,
        data: { logs },
      });
    };

    if (!preferSupabase) {
      return loadFromSqlite();
    }

    try {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select(
          'id,"organicBeveragesKg","organicFoodsKg","inorganicKg","trashRemoved","binsWashed","branchId","staffId","createdAt"'
        )
        .order('createdAt', { ascending: false })
        .limit(15);
      if (error) {
        throw new Error(error.message);
      }
      const logs = (data ?? []).map(normalizeRecord);
      await Promise.all(logs.map((log) => upsertSqliteRecord(log)));
      markSupabaseHealthy();
      return NextResponse.json({
        success: true,
        data: { logs },
      });
    } catch (error) {
      if (!isLikelyNetworkError(error)) {
        throw error;
      }
      markSupabaseFailure(error);
      return loadFromSqlite();
    }
  } catch (error) {
    console.error('Error fetching waste logs:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos cargar el historial de residuos.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await flushPendingOperations();
    const payload = (await request.json()) as {
      organicBeverages: number;
      organicFoods: number;
      inorganic: number;
      trashRemoved: boolean;
      binsWashed: boolean;
      branchId?: string;
      staffId?: string;
    };
    if (!payload.trashRemoved || !payload.binsWashed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Confirma el retiro de basura y lavado de botes para cerrar el turno.',
        },
        { status: 422 }
      );
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const insertPayload = {
      id,
      organicBeveragesKg: Number(payload.organicBeverages ?? 0),
      organicFoodsKg: Number(payload.organicFoods ?? 0),
      inorganicKg: Number(payload.inorganic ?? 0),
      trashRemoved: Boolean(payload.trashRemoved),
      binsWashed: Boolean(payload.binsWashed),
      branchId: payload.branchId ?? null,
      staffId: payload.staffId ?? null,
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
            'id,"organicBeveragesKg","organicFoodsKg","inorganicKg","trashRemoved","binsWashed","branchId","staffId","createdAt"'
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
          console.error('Error recording waste log:', error);
          return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'No pudimos guardar el cierre sanitario.' },
            { status: 500 }
          );
        }
        markSupabaseFailure(error);
      }
    }

    await upsertSqliteRecord(localRecord);
    await queueWasteInsert(insertPayload);
    return NextResponse.json(
      {
        success: true,
        data: localRecord,
        pendingSync: true,
      },
      { status: attemptedSupabase ? 202 : 201 }
    );
  } catch (error) {
    console.error('Error recording waste log:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos guardar el cierre sanitario.' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
