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

const TABLE = process.env.SUPABASE_HYGIENE_TABLE ?? 'hygiene_logs';

type HygieneArea = 'BAÑO' | 'COCINA' | 'BARRA' | 'MESAS';

const ALLOWED_AREAS: HygieneArea[] = ['BAÑO', 'COCINA', 'BARRA', 'MESAS'];

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

const escapePdfText = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const buildPdfBuffer = (
  entries: Array<{
    area: HygieneArea;
    createdAt: string;
    staffId?: string | null;
    isClean: boolean;
    suppliesRefilled: boolean;
    observations?: string | null;
  }>,
  monthLabel: string
) => {
  const heading = `HOJA DE CONTROL DE LIMPIEZA · ${monthLabel.toUpperCase()}`;
  const lines = [
    heading,
    'Cumplimiento NOM-251 · Registro automático de personal y horarios.',
    '',
    'Fecha · Hora | Área | Responsable | Estado · Insumos | Observaciones',
  ];
  entries.forEach((entry) => {
    const dateLabel = new Date(entry.createdAt).toLocaleString('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const summary = [
      entry.isClean ? 'Área OK' : 'Área pendiente',
      entry.suppliesRefilled ? 'Suministros OK' : 'Reponer suministros',
    ].join(' · ');
    lines.push(
      `${dateLabel} | ${entry.area} | ${entry.staffId ?? '—'} | ${summary} | ${
        entry.observations ?? 'Sin observaciones'
      }`
    );
  });
  if (entries.length === 0) {
    lines.push('Sin registros en el mes seleccionado.');
  }
  const content = [
    'BT',
    '/F1 10 Tf',
    '14 TL',
    '72 760 Td',
    ...lines.map((line, index) => {
      const escaped = escapePdfText(line);
      if (index === 0) {
        return `(${escaped}) Tj`;
      }
      return `T*\n(${escaped}) Tj`;
    }),
    'ET',
  ].join('\n');
  const contentLength = Buffer.byteLength(content, 'utf8');
  const parts: string[] = [];
  let offset = 0;
  const offsets: number[] = [0];
  const push = (chunk: string) => {
    parts.push(chunk);
    offset += Buffer.byteLength(chunk, 'utf8');
  };
  push('%PDF-1.4\n');
  const register = (body: string) => {
    const index = offsets.length;
    const chunk = `${index} 0 obj\n${body}\nendobj\n`;
    offsets.push(offset);
    push(chunk);
    return index;
  };
  const fontIndex = register('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentsIndex = register(`<< /Length ${contentLength} >>\nstream\n${content}\nendstream`);
  const pageIndex = register(
    `<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Contents ${contentsIndex} 0 R /Resources << /Font << /F1 ${fontIndex} 0 R >> >> >>`
  );
  const pagesIndex = register(`<< /Type /Pages /Kids [${pageIndex} 0 R] /Count 1 >>`);
  const catalogIndex = register(`<< /Type /Catalog /Pages ${pagesIndex} 0 R >>`);
  const xrefStart = offset;
  const totalObjects = offsets.length;
  push(`xref\n0 ${totalObjects}\n`);
  push('0000000000 65535 f \n');
  for (let i = 1; i < totalObjects; i += 1) {
    const entryOffset = offsets[i];
    push(`${entryOffset.toString().padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${totalObjects} /Root ${catalogIndex} 0 R >>\n`);
  push(`startxref\n${xrefStart}\n%%EOF`);
  return Buffer.from(parts.join(''), 'utf8');
};

const normalizeArea = (value?: string | null): HygieneArea => {
  const normalized = (value ?? '').toUpperCase();
  if ((ALLOWED_AREAS as string[]).includes(normalized)) {
    return normalized as HygieneArea;
  }
  return 'BAÑO';
};

const normalizeRecord = (record: Record<string, unknown>) => ({
  id: String(record.id ?? ''),
  area: normalizeArea(record.area as string | null),
  staffId: (record.staffId as string | null) ?? (record.staff_id as string | null) ?? null,
  isClean: Boolean(record.is_clean ?? record.isClean ?? true),
  suppliesRefilled: Boolean(record.supplies_refilled ?? record.suppliesRefilled ?? true),
  observations: (record.observations as string | null) ?? null,
  createdAt:
    (record.createdAt as string | null) ??
    (record.created_at as string | null) ??
    new Date().toISOString(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get('month');
    const format = searchParams.get('format');
    const monthKey = monthKeyFromParam(monthParam);
    const { startIso, endIso, label } = resolveMonthRange(monthKey);

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('id,area,"staffId","is_clean","supplies_refilled",observations,"createdAt"')
      .gte('createdAt', startIso)
      .lt('createdAt', endIso)
      .order('createdAt', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    const entries = (data ?? []).map((record) => normalizeRecord(record));

    if (format === 'pdf') {
      const pdfBuffer = buildPdfBuffer(entries, label);
      return new NextResponse(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="higiene-${monthKey}.pdf"`,
          'Content-Length': String(pdfBuffer.length),
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        month: monthKey,
        entries,
        summary: {
          total: entries.length,
          lastEntry: entries[entries.length - 1] ?? null,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching hygiene checklist:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos cargar el checklist de higiene.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      area?: HygieneArea;
      isClean?: boolean;
      suppliesRefilled?: boolean;
      observations?: string;
      staffId?: string;
    };

    const area = payload.area ? normalizeArea(payload.area) : 'BAÑO';
    if (!ALLOWED_AREAS.includes(area)) {
      return NextResponse.json(
        { success: false, error: 'Área de checklist no válida.' },
        { status: 400 }
      );
    }

    const insertPayload = {
      area,
      staffId: payload.staffId ?? null,
      is_clean: payload.isClean ?? true,
      supplies_refilled: payload.suppliesRefilled ?? true,
      observations: payload.observations?.trim() || null,
    };

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert(insertPayload)
      .select('id,area,"staffId","is_clean","supplies_refilled",observations,"createdAt"')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      data: normalizeRecord(data),
    });
  } catch (error) {
    console.error('Error storing hygiene checklist:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos guardar el registro de higiene.' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
