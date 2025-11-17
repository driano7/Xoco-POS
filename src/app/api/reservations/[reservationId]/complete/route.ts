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
