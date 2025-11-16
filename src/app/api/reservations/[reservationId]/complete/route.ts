import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const RESERVATIONS_TABLE = process.env.SUPABASE_RESERVATIONS_TABLE ?? 'reservations';

export async function POST(_: Request, context: { params: { reservationId?: string } }) {
  const reservationId = context.params?.reservationId?.trim();

  if (!reservationId) {
    return NextResponse.json(
      { success: false, error: 'Falta el ID de la reservación' },
      { status: 400 }
    );
  }

  try {
    const now = new Date().toISOString();
    const {
      data,
      error,
    } = await supabaseAdmin
      .from(RESERVATIONS_TABLE)
      .update({ status: 'completed', updatedAt: now })
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

    return NextResponse.json({ success: true, data: { id: data.id } });
  } catch (error) {
    console.error('Error confirmando reservación:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos confirmar la reservación' },
      { status: 500 }
    );
  }
}
