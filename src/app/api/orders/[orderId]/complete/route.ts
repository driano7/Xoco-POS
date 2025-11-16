import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { maybeAwardDailyCoffee } from '../../loyalty-utils';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';

export async function POST(_: Request, context: { params: { orderId?: string } }) {
  const orderId = context.params?.orderId?.trim();

  if (!orderId) {
    return NextResponse.json({ success: false, error: 'Falta el ID del pedido' }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const {
      data,
      error,
    } = await supabaseAdmin
      .from(ORDERS_TABLE)
      .update({ status: 'completed', updatedAt: now })
      .eq('id', orderId)
      .select('id,"userId",items')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'No encontramos el pedido' },
        { status: 404 }
      );
    }

    await maybeAwardDailyCoffee(orderId, data.userId ?? null, data.items ?? null);

    return NextResponse.json({ success: true, data: { id: data.id } });
  } catch (error) {
    console.error('Error completando pedido:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos marcar el pedido como completado' },
      { status: 500 }
    );
  }
}
