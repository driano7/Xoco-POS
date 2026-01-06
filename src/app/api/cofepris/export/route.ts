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
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '@/lib/supabase-server';
import { sqlite } from '@/lib/sqlite';
import {
  isLikelyNetworkError,
  markSupabaseFailure,
  markSupabaseHealthy,
  shouldPreferSupabase,
} from '@/lib/offline-sync';

const HYGIENE_TABLE = process.env.SUPABASE_HYGIENE_TABLE ?? 'hygiene_logs';
const PEST_TABLE = process.env.SUPABASE_PEST_CONTROL_TABLE ?? 'pest_control_logs';
const WASTE_TABLE = process.env.SUPABASE_WASTE_TABLE ?? 'waste_logs';

type HygieneArea = 'BAÑO' | 'COCINA' | 'BARRA' | 'MESAS';

const monthKeyFromParam = (value: string | null): string => {
  const now = new Date();
  if (!value) {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return value;
};

const resolveMonthRange = (monthKey: string) => {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10) - 1;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    label: start.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
  };
};

const normalizeHygiene = (record: Record<string, unknown>) => ({
  id: String(record.id ?? ''),
  area: ((record.area as string | null) ?? 'BAÑO') as HygieneArea,
  staffId: (record.staffId as string | null) ?? (record.staff_id as string | null) ?? null,
  isClean: Boolean(record.is_clean ?? record.isClean ?? true),
  suppliesRefilled: Boolean(record.supplies_refilled ?? record.suppliesRefilled ?? true),
  observations: (record.observations as string | null) ?? null,
  createdAt:
    (record.createdAt as string | null) ??
    (record.created_at as string | null) ??
    new Date().toISOString(),
});

const normalizePest = (record: Record<string, unknown>) => ({
  id: String(record.id ?? ''),
  providerName: (record.provider_name as string | null) ?? (record.providerName as string | null) ?? null,
  certificateNumber:
    (record.certificate_number as string | null) ?? (record.certificateNumber as string | null) ?? null,
  serviceDate:
    (record.service_date as string | null) ??
    (record.serviceDate as string | null) ??
    new Date().toISOString(),
  nextServiceDate:
    (record.next_service_date as string | null) ??
    (record.nextServiceDate as string | null) ??
    null,
  observations: (record.observations as string | null) ?? null,
  staffId: (record.staffId as string | null) ?? (record.staff_id as string | null) ?? null,
  createdAt:
    (record.createdAt as string | null) ??
    (record.created_at as string | null) ??
    new Date().toISOString(),
});

const normalizeWaste = (record: Record<string, unknown>) => ({
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

const loadHygieneFromSqlite = async (startIso: string, endIso: string) => {
  const rows = await sqlite.all<Record<string, unknown>>(
    `
    SELECT id, area, staffId, is_clean, supplies_refilled, observations, createdAt
    FROM ${HYGIENE_TABLE}
    WHERE createdAt >= :start AND createdAt < :end
    ORDER BY createdAt ASC
  `,
    { ':start': startIso, ':end': endIso }
  );
  return rows.map((row) => normalizeHygiene(row));
};

const loadPestFromSqlite = async (startIso: string, endIso: string) => {
  const rows = await sqlite.all<Record<string, unknown>>(
    `
    SELECT id, service_date, provider_name, certificate_number, next_service_date, staffId, observations, createdAt
    FROM ${PEST_TABLE}
    WHERE createdAt >= :start AND createdAt < :end
    ORDER BY service_date DESC
  `,
    { ':start': startIso, ':end': endIso }
  );
  return rows.map((row) => normalizePest(row));
};

const loadWasteFromSqlite = async (startIso: string, endIso: string) => {
  const rows = await sqlite.all<Record<string, unknown>>(
    `
    SELECT id, organicBeveragesKg, organicFoodsKg, inorganicKg, trashRemoved, binsWashed, branchId, staffId, createdAt
    FROM ${WASTE_TABLE}
    WHERE createdAt >= :start AND createdAt < :end
    ORDER BY createdAt DESC
  `,
    { ':start': startIso, ':end': endIso }
  );
  return rows.map((row) => normalizeWaste(row));
};

const toCsvValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return '""';
  }
  const normalized = String(value).replace(/"/g, '""');
  return `"${normalized}"`;
};

const buildCsv = (
  hygiene: ReturnType<typeof normalizeHygiene>[],
  pest: ReturnType<typeof normalizePest>[],
  waste: ReturnType<typeof normalizeWaste>[]
) => {
  const headers = [
    'module',
    'timestamp',
    'area',
    'staffId',
    'status',
    'notes',
    'provider',
    'certificate',
    'nextServiceDate',
    'organicBeveragesKg',
    'organicFoodsKg',
    'inorganicKg',
    'trashRemoved',
    'binsWashed',
  ];
  const lines = [headers.join(',')];
  hygiene.forEach((entry) => {
    lines.push(
      [
        'hygiene',
        entry.createdAt,
        entry.area,
        entry.staffId ?? '',
        entry.isClean ? 'Limpio' : 'Pendiente',
        entry.observations ?? '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]
        .map(toCsvValue)
        .join(',')
    );
  });
  pest.forEach((entry) => {
    lines.push(
      [
        'pest_control',
        entry.serviceDate,
        '',
        entry.staffId ?? '',
        '',
        entry.observations ?? '',
        entry.providerName ?? '',
        entry.certificateNumber ?? '',
        entry.nextServiceDate ?? '',
        '',
        '',
        '',
        '',
        '',
      ]
        .map(toCsvValue)
        .join(',')
    );
  });
  waste.forEach((entry) => {
    lines.push(
      [
        'waste',
        entry.createdAt,
        '',
        entry.staffId ?? '',
        '',
        '',
        '',
        '',
        '',
        entry.organicBeveragesKg,
        entry.organicFoodsKg,
        entry.inorganicKg,
        entry.trashRemoved ? 'Sí' : 'No',
        entry.binsWashed ? 'Sí' : 'No',
      ]
        .map(toCsvValue)
        .join(',')
    );
  });
  return lines.join('\n');
};

const buildWorkbook = (
  hygiene: ReturnType<typeof normalizeHygiene>[],
  pest: ReturnType<typeof normalizePest>[],
  waste: ReturnType<typeof normalizeWaste>[],
  label: string
) => {
  const workbook = XLSX.utils.book_new();
  const hygieneSheet = XLSX.utils.json_to_sheet(
    hygiene.map((entry) => ({
      Area: entry.area,
      Responsable: entry.staffId ?? '—',
      'Área limpia': entry.isClean ? 'Sí' : 'No',
      'Insumos repuestos': entry.suppliesRefilled ? 'Sí' : 'No',
      Observaciones: entry.observations ?? '',
      'Fecha y hora': new Date(entry.createdAt).toLocaleString('es-MX'),
    }))
  );
  const pestSheet = XLSX.utils.json_to_sheet(
    pest.map((entry) => ({
      Proveedor: entry.providerName ?? '—',
      Certificado: entry.certificateNumber ?? '—',
      'Servicio realizado': entry.serviceDate
        ? new Date(entry.serviceDate).toLocaleDateString('es-MX')
        : '—',
      'Próximo servicio': entry.nextServiceDate
        ? new Date(entry.nextServiceDate).toLocaleDateString('es-MX')
        : '—',
      Observaciones: entry.observations ?? '',
      Responsable: entry.staffId ?? '—',
    }))
  );
  const wasteSheet = XLSX.utils.json_to_sheet(
    waste.map((entry) => ({
      'Bebidas orgánicas (kg)': entry.organicBeveragesKg,
      'Alimentos orgánicos (kg)': entry.organicFoodsKg,
      'Inorgánicos (kg)': entry.inorganicKg,
      'Basura retirada': entry.trashRemoved ? 'Sí' : 'No',
      'Botes lavados': entry.binsWashed ? 'Sí' : 'No',
      Responsable: entry.staffId ?? '—',
      'Fecha y hora': new Date(entry.createdAt).toLocaleString('es-MX'),
    }))
  );
  XLSX.utils.book_append_sheet(workbook, hygieneSheet, 'Higiene');
  XLSX.utils.book_append_sheet(workbook, pestSheet, 'Plagas');
  XLSX.utils.book_append_sheet(workbook, wasteSheet, 'Residuos');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true, Props: { Title: `COFEPRIS ${label}` } });
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') ?? 'json').toLowerCase();
    const monthParam = searchParams.get('month');
    const monthKey = monthKeyFromParam(monthParam);
    const { startIso, endIso, label } = resolveMonthRange(monthKey);

    const respond = (
      hygieneEntries: ReturnType<typeof normalizeHygiene>[],
      pestEntries: ReturnType<typeof normalizePest>[],
      wasteEntries: ReturnType<typeof normalizeWaste>[]
    ) => {
      if (format === 'csv') {
        const csv = buildCsv(hygieneEntries, pestEntries, wasteEntries);
        return new NextResponse(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="cofepris-${monthKey}.csv"`,
          },
        });
      }
      if (format === 'xlsx') {
        const buffer = buildWorkbook(hygieneEntries, pestEntries, wasteEntries, label);
        return new NextResponse(buffer, {
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="cofepris-${monthKey}.xlsx"`,
          },
        });
      }
      return NextResponse.json({
        success: true,
        data: {
          month: monthKey,
          hygiene: hygieneEntries,
          pest: pestEntries,
          waste: wasteEntries,
        },
      });
    };

    const loadFromSqlite = async () => {
      const [hygieneEntries, pestEntries, wasteEntries] = await Promise.all([
        loadHygieneFromSqlite(startIso, endIso),
        loadPestFromSqlite(startIso, endIso),
        loadWasteFromSqlite(startIso, endIso),
      ]);
      return respond(hygieneEntries, pestEntries, wasteEntries);
    };

    const preferSupabase = shouldPreferSupabase();
    if (!preferSupabase) {
      return loadFromSqlite();
    }

    try {
      const [hygieneResponse, pestResponse, wasteResponse] = await Promise.all([
        supabaseAdmin
          .from(HYGIENE_TABLE)
          .select('id,area,"staffId","is_clean","supplies_refilled",observations,"createdAt"')
          .gte('createdAt', startIso)
          .lt('createdAt', endIso)
          .order('createdAt', { ascending: true }),
        supabaseAdmin
          .from(PEST_TABLE)
          .select(
            'id,"provider_name","certificate_number","service_date","next_service_date","observations","staffId","createdAt"'
          )
          .gte('createdAt', startIso)
          .lt('createdAt', endIso)
          .order('service_date', { ascending: true }),
        supabaseAdmin
          .from(WASTE_TABLE)
          .select(
            'id,"organicBeveragesKg","organicFoodsKg","inorganicKg","trashRemoved","binsWashed","branchId","staffId","createdAt"'
          )
          .gte('createdAt', startIso)
          .lt('createdAt', endIso)
          .order('createdAt', { ascending: true }),
      ]);

      if (hygieneResponse.error || pestResponse.error || wasteResponse.error) {
        const error =
          hygieneResponse.error ?? pestResponse.error ?? wasteResponse.error ?? new Error('Export failed');
        throw new Error(error.message);
      }

      const hygieneEntries = (hygieneResponse.data ?? []).map(normalizeHygiene);
      const pestEntries = (pestResponse.data ?? []).map(normalizePest);
      const wasteEntries = (wasteResponse.data ?? []).map(normalizeWaste);
      markSupabaseHealthy();
      return respond(hygieneEntries, pestEntries, wasteEntries);
    } catch (error) {
      if (!isLikelyNetworkError(error)) {
        throw error;
      }
      markSupabaseFailure(error);
      return loadFromSqlite();
    }
  } catch (error) {
    console.error('Error exporting COFEPRIS data:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos exportar los datos sanitarios.' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
