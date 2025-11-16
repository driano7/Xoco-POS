import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const PREP_QUEUE_TABLE = process.env.SUPABASE_PREP_QUEUE_TABLE ?? 'prep_queue';

export async function POST(_: Request, context: { params: { taskId?: string } }) {
  const taskId = context.params?.taskId?.trim();

  if (!taskId) {
    return NextResponse.json({ success: false, error: 'Falta el ID de la tarea' }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const {
      data,
      error,
    } = await supabaseAdmin
      .from(PREP_QUEUE_TABLE)
      .update({ status: 'completed', updatedAt: now, completedAt: now })
      .eq('id', taskId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'No encontramos la tarea' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { id: data.id } });
  } catch (error) {
    console.error('Error completando tarea de preparación:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos cerrar la tarea de preparación' },
      { status: 500 }
    );
  }
}
