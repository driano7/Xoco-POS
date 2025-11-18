import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { revertLoyaltyCoffee } from '../../loyalty-utils';

const PREP_QUEUE_TABLE = process.env.SUPABASE_PREP_QUEUE_TABLE ?? 'prep_queue';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';

const normalizeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function POST(request: Request, context: { params: { orderId?: string } }) {
  const orderId = context.params?.orderId?.trim();

  if (!orderId) {
    return NextResponse.json({ success: false, error: 'Falta el ID del pedido' }, { status: 400 });
  }

  try {
    let assignedStaffId: string | null = null;
    try {
      const body = (await request.json()) as { staffId?: string | null };
      if (body?.staffId && typeof body.staffId === 'string') {
        assignedStaffId = body.staffId.trim() || null;
      }
    } catch {
      assignedStaffId = null;
    }

    const ensureOrderItemsSnapshot = async () => {
      const {
        data: existingItems,
        error: existingItemsError,
      } = await supabaseAdmin.from(ORDER_ITEMS_TABLE).select('id').eq('orderId', orderId);

      if (existingItemsError) {
        throw new Error(existingItemsError.message);
      }

      if (existingItems?.length) {
        return existingItems;
      }

      const {
        data: orderRecord,
        error: orderRecordError,
      } = await supabaseAdmin.from(ORDERS_TABLE).select('items').eq('id', orderId).maybeSingle();

      if (orderRecordError) {
        throw new Error(orderRecordError.message);
      }

      const storedItems = Array.isArray(orderRecord?.items) ? orderRecord.items : [];
      const normalizedItems = storedItems
        .map((item) => {
          const payload = item as Record<string, unknown>;
          const quantity = normalizeNumber(payload.quantity);
          const rawPrice = payload.price;
          const normalizedPrice =
            typeof rawPrice === 'number' ? rawPrice : normalizeNumber(rawPrice);
          return {
            orderId,
            productId: typeof payload.productId === 'string' ? payload.productId : null,
            quantity: quantity > 0 ? quantity : 1,
            price: normalizedPrice > 0 ? normalizedPrice : null,
          };
        })
        .filter((item) => item.quantity > 0);

      if (!normalizedItems.length) {
        return [];
      }

      const { error: snapshotError } = await supabaseAdmin
        .from(ORDER_ITEMS_TABLE)
        .insert(normalizedItems);
      if (snapshotError) {
        throw new Error(snapshotError.message);
      }

      const {
        data: refreshedItems,
        error: refreshedError,
      } = await supabaseAdmin.from(ORDER_ITEMS_TABLE).select('id').eq('orderId', orderId);

      if (refreshedError) {
        throw new Error(refreshedError.message);
      }

      return refreshedItems ?? [];
    };

    const orderItems = await ensureOrderItemsSnapshot();

    if (!orderItems.length) {
      return NextResponse.json(
        { success: false, error: 'No encontramos artículos para este pedido' },
        { status: 404 }
      );
    }

    const orderItemIds = orderItems.map((item) => item.id).filter((id): id is string => Boolean(id));

    let tasksToCreate = orderItemIds;

    let existingTasks: { id: string | null; orderItemId: string | null; status?: string | null }[] = [];

    if (orderItemIds.length) {
      const {
        data: existing,
        error: existingError,
      } = await supabaseAdmin
        .from(PREP_QUEUE_TABLE)
        .select('id,"orderItemId",status')
        .in('orderItemId', orderItemIds);

      if (existingError) {
        throw new Error(existingError.message);
      }

      existingTasks = existing ?? [];

      const existingIds = new Set(
        existingTasks
          .map((task) => task.orderItemId)
          .filter((value): value is string => Boolean(value))
      );

      tasksToCreate = orderItemIds.filter((itemId) => !existingIds.has(itemId));

      const tasksNeedingReset = existingTasks.filter(
        (task) => task.id && task.status && task.status !== 'pending'
      );
      if (tasksNeedingReset.length) {
        const resetIds = tasksNeedingReset.map((task) => task.id).filter(Boolean);
        const now = new Date().toISOString();
        const { error: resetError } = await supabaseAdmin
          .from(PREP_QUEUE_TABLE)
          .update({
            status: 'pending',
            handledByStaffId: assignedStaffId ?? null,
            updatedAt: now,
            completedAt: null,
          })
          .in('id', resetIds);
        if (resetError) {
          console.error('No se pudo reactivar tareas en la cola:', resetError);
        }
      }
    }

    if (!tasksToCreate.length) {
      return NextResponse.json({
        success: true,
        data: { created: 0, skipped: orderItemIds.length },
        message: 'Los artículos ya se encuentran en la cola',
      });
    }

    const payload = tasksToCreate.map((itemId) => ({
      orderItemId: itemId,
      status: 'pending',
      handledByStaffId: assignedStaffId ?? null,
    }));

    const {
      data: inserted,
      error: insertError,
    } = await supabaseAdmin.from(PREP_QUEUE_TABLE).insert(payload).select('id');

    if (insertError) {
      throw new Error(insertError.message);
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from(ORDERS_TABLE)
      .update({ status: 'pending', updatedAt: now })
      .eq('id', orderId);

    if (updateError) {
      console.warn('No se pudo actualizar el estatus del pedido al moverlo a la cola:', updateError);
    }

    await revertLoyaltyCoffee(orderId);

    return NextResponse.json({
      success: true,
      data: { created: inserted?.length ?? tasksToCreate.length },
    });
  } catch (error) {
    console.error('Error encolando pedido:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'No pudimos mover el pedido a la cola de producción',
      },
      { status: 500 }
    );
  }
}
