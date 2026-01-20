/*
 * --------------------------------------------------------------------
 *  Xoco POS — Staff delivery availability endpoint
 * --------------------------------------------------------------------
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { sqlite } from '@/lib/sqlite';

const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';
const MAX_NOTE_LENGTH = 320;

const sanitizeStaffId = (value?: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const sanitizeBoolean = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
  }
  return null;
};

const sanitizeNote = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, MAX_NOTE_LENGTH);
};

const mapRecord = (record: {
  id: string;
  branchId?: string | null;
  delivery_paused?: boolean | null;
  delivery_pause_note?: string | null;
  delivery_paused_at?: string | null;
  updatedAt?: string | null;
}) => ({
  staffId: record.id,
  branchId: record.branchId ?? null,
  paused: Boolean(record.delivery_paused),
  note: record.delivery_pause_note ?? null,
  pausedAt: record.delivery_paused_at ?? null,
  updatedAt: record.updatedAt ?? null,
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const staffId = sanitizeStaffId(searchParams.get('staffId'));
    const branchId = sanitizeStaffId(searchParams.get('branchId'));

    let query = supabaseAdmin
      .from(STAFF_TABLE)
      .select('id,"branchId",delivery_paused,delivery_pause_note,delivery_paused_at,"updatedAt"')
      .order('updatedAt', { ascending: false })
      .limit(200);

    if (staffId) {
      query = query.eq('id', staffId);
    }
    if (branchId) {
      query = query.eq('branchId', branchId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    const records = (data ?? []).map(mapRecord);

    return NextResponse.json({ success: true, data: records });
  } catch (error) {
    console.error('Error fetching delivery status:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos obtener el status de entregas.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { staffId?: string; paused?: boolean; note?: string | null };
    const staffId = sanitizeStaffId(payload?.staffId);
    const paused = sanitizeBoolean(payload?.paused);

    if (!staffId || paused === null) {
      return NextResponse.json(
        { success: false, error: 'Necesitamos el identificador del staff y el estado deseado.' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const note = paused ? sanitizeNote(payload?.note) : null;
    const pausedAt = paused ? now : null;

    const { data, error } = await supabaseAdmin
      .from(STAFF_TABLE)
      .update({
        delivery_paused: paused,
        delivery_pause_note: note,
        delivery_paused_at: pausedAt,
        updatedAt: now,
      })
      .eq('id', staffId)
      .select('id,"branchId",delivery_paused,delivery_pause_note,delivery_paused_at,"updatedAt"')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      return NextResponse.json(
        { success: false, error: 'No encontramos al colaborador solicitado.' },
        { status: 404 }
      );
    }

    try {
      await sqlite.run(
        `UPDATE staff_users
         SET delivery_paused = :paused,
             delivery_pause_note = :note,
             delivery_paused_at = :pausedAt,
             updatedAt = :updatedAt
         WHERE id = :staffId`,
        {
          ':paused': paused ? 1 : 0,
          ':note': note ?? null,
          ':pausedAt': pausedAt,
          ':updatedAt': now,
          ':staffId': staffId,
        }
      );
    } catch (sqliteError) {
      console.warn('No pudimos reflejar el estado en SQLite:', sqliteError);
    }

    return NextResponse.json({
      success: true,
      data: mapRecord({
        ...data,
        delivery_paused: paused,
        delivery_pause_note: note,
        delivery_paused_at: pausedAt,
        updatedAt: data.updatedAt ?? now,
      }),
    });
  } catch (error) {
    console.error('Error updating delivery status:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'No pudimos actualizar el status de entregas.',
      },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
