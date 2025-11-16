import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { type RawUserRecord, withDecryptedUserNames } from '@/lib/customer-decrypt';

const TICKETS_TABLE = process.env.SUPABASE_TICKETS_TABLE ?? 'tickets';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';

const TICKET_FIELDS =
  'id,"ticketCode","orderId","userId","paymentMethod","tipAmount","tipPercent",currency,"createdAt"';

export async function GET(
  _: Request,
  context: {
    params: { identifier?: string };
  }
) {
  const identifier = context.params?.identifier ? decodeURIComponent(context.params.identifier) : '';
  const trimmedIdentifier = identifier.trim();

  if (!trimmedIdentifier) {
    return NextResponse.json({ success: false, error: 'Falta el identificador del ticket' }, { status: 400 });
  }

  try {
    let ticketRecord:
      | {
          id?: string | null;
          ticketCode?: string | null;
          orderId?: string | null;
          userId?: string | null;
          paymentMethod?: string | null;
          tipAmount?: number | null;
          tipPercent?: number | null;
          currency?: string | null;
          createdAt?: string | null;
        }
      | null = null;

    const { data: ticketByCode, error: ticketByCodeError } = await supabaseAdmin
      .from(TICKETS_TABLE)
      .select(TICKET_FIELDS)
      .eq('ticketCode', trimmedIdentifier)
      .maybeSingle();

    if (ticketByCodeError) {
      throw new Error(ticketByCodeError.message);
    }

    ticketRecord = ticketByCode ?? null;

    let orderId = ticketRecord?.orderId ?? trimmedIdentifier;

    if (!ticketRecord) {
      const { data: ticketByOrder, error: ticketByOrderError } = await supabaseAdmin
        .from(TICKETS_TABLE)
        .select(TICKET_FIELDS)
        .eq('orderId', trimmedIdentifier)
        .maybeSingle();

      if (ticketByOrderError) {
        throw new Error(ticketByOrderError.message);
      }

      ticketRecord = ticketByOrder ?? null;
      orderId = ticketByOrder?.orderId ?? trimmedIdentifier;
    }

    const orderSelectFields =
      'id,"orderNumber",status,total,currency,"createdAt","userId","items"';

    const {
      data: orderById,
      error: orderError,
    } = await supabaseAdmin
      .from(ORDERS_TABLE)
      .select(orderSelectFields)
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      throw new Error(orderError.message);
    }

    let order = orderById ?? null;

    if (!order) {
      const {
        data: orderByNumber,
        error: orderByNumberError,
      } = await supabaseAdmin
        .from(ORDERS_TABLE)
        .select(orderSelectFields)
        .eq('orderNumber', trimmedIdentifier)
        .maybeSingle();

      if (orderByNumberError) {
        throw new Error(orderByNumberError.message);
      }

      order = orderByNumber ?? null;
      if (order) {
        orderId = order.id;
      }
    }

    if (!order) {
      return NextResponse.json(
        { success: false, error: 'No encontramos el pedido relacionado' },
        { status: 404 }
      );
    }

    if (!ticketRecord && order?.id) {
      const {
        data: ticketByResolvedOrder,
        error: ticketByResolvedOrderError,
      } = await supabaseAdmin
        .from(TICKETS_TABLE)
        .select(TICKET_FIELDS)
        .eq('orderId', order.id)
        .maybeSingle();

      if (ticketByResolvedOrderError) {
        throw new Error(ticketByResolvedOrderError.message);
      }

      ticketRecord = ticketByResolvedOrder ?? null;
    }

    const effectiveTicket = {
      id: ticketRecord?.id ?? order.id,
      ticketCode: ticketRecord?.ticketCode ?? order.orderNumber ?? order.id,
      orderId: order.id,
      userId: ticketRecord?.userId ?? order.userId ?? '',
      paymentMethod: ticketRecord?.paymentMethod ?? null,
      tipAmount: ticketRecord?.tipAmount ?? null,
      tipPercent: ticketRecord?.tipPercent ?? null,
      currency: ticketRecord?.currency ?? order.currency ?? 'MXN',
      createdAt: ticketRecord?.createdAt ?? order.createdAt ?? new Date().toISOString(),
    };

    const normalizeQuantity = (value: unknown) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return 1;
      }
      return parsed <= 0 ? 1 : parsed;
    };

    const normalizePrice = (value: unknown) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const {
      data: orderItems,
      error: orderItemsError,
    } = await supabaseAdmin
      .from(ORDER_ITEMS_TABLE)
      .select('id,"productId",quantity,price')
      .eq('orderId', order.id);

    if (orderItemsError) {
      throw new Error(orderItemsError.message);
    }

    const productIds = Array.from(
      new Set(
        (orderItems ?? [])
          .map((item) => item.productId)
          .filter((value): value is string => Boolean(value))
      )
    );

    let productMap = new Map<string, { name?: string | null; category?: string | null; subcategory?: string | null }>();

    if (productIds.length) {
      const { data: products, error: productsError } = await supabaseAdmin
        .from(PRODUCTS_TABLE)
        .select('id,name,category,subcategory')
        .in('id', productIds);

      if (productsError) {
        throw new Error(productsError.message);
      }

      productMap = new Map(
        (products ?? [])
          .filter((product) => product?.id)
          .map((product) => [String(product.id), product])
      );
    }

    let items =
      orderItems?.map((item) => ({
        id: item.id,
        productId: item.productId ?? null,
        quantity: item.quantity ?? 0,
        price: item.price ?? null,
        product: item.productId ? productMap.get(String(item.productId)) ?? null : null,
      })) ?? [];

    if (!items.length && Array.isArray(order.items)) {
      const fallbackItems = (order.items as Array<Record<string, unknown>>).map((rawItem, index) => {
        const productId =
          typeof rawItem.productId === 'string'
            ? rawItem.productId
            : typeof rawItem.id === 'string'
              ? rawItem.id
              : null;
        const quantity = normalizeQuantity(rawItem.quantity ?? rawItem.qty ?? rawItem.amount);
        const price = normalizePrice(rawItem.price ?? rawItem.amount ?? rawItem.unitPrice);
        const category =
          typeof rawItem.category === 'string'
            ? rawItem.category
            : typeof rawItem.type === 'string'
              ? rawItem.type
              : null;
        const subcategory =
          typeof rawItem.subcategory === 'string'
            ? rawItem.subcategory
            : typeof rawItem.group === 'string'
              ? rawItem.group
              : null;
        const name =
          typeof rawItem.name === 'string'
            ? rawItem.name
            : typeof rawItem.title === 'string'
              ? rawItem.title
              : productId;
        return {
          id: rawItem.id ?? `${order.id}-snapshot-${index}`,
          productId,
          quantity,
          price,
          product: {
            name: typeof name === 'string' ? name : null,
            category,
            subcategory,
          },
        };
      });
      items = fallbackItems.filter((item) => item.quantity > 0);
    }

    const customerId = order.userId ?? ticketRecord?.userId ?? null;
    let customerRecord: ReturnType<typeof withDecryptedUserNames> | null = null;

    if (customerId) {
      const {
        data: customer,
        error: customerError,
      } = await supabaseAdmin
        .from(USERS_TABLE)
        .select(
          [
            '"id"',
            '"clientId"',
            '"email"',
            '"firstNameEncrypted"',
            '"firstNameIv"',
            '"firstNameTag"',
            '"firstNameSalt"',
            '"lastNameEncrypted"',
            '"lastNameIv"',
            '"lastNameTag"',
            '"lastNameSalt"',
            '"phoneEncrypted"',
            '"phoneIv"',
            '"phoneTag"',
            '"phoneSalt"',
          ].join(',')
        )
        .eq('id', customerId)
        .maybeSingle();

      if (customerError) {
        throw new Error(customerError.message);
      }

      const normalizedCustomer =
        customer && typeof customer === 'object' && !('error' in customer) ? (customer as RawUserRecord) : null;
      customerRecord = normalizedCustomer ? withDecryptedUserNames(normalizedCustomer) : null;
    }

    const customerPayload = customerRecord
      ? {
          id: customerRecord.id ?? null,
          clientId: customerRecord.clientId ?? null,
          email: customerRecord.email ?? null,
          name: [customerRecord.firstName, customerRecord.lastName].filter(Boolean).join(' ').trim() || null,
          firstName: customerRecord.firstName ?? null,
          lastName: customerRecord.lastName ?? null,
          phone: customerRecord.phone ?? null,
        }
      : {
          id: customerId ?? null,
          clientId: null,
          email: null,
          name: null,
          firstName: null,
          lastName: null,
          phone: null,
        };

    return NextResponse.json({
      success: true,
      data: {
        ticket: effectiveTicket,
        order: {
          id: order.id,
          status: order.status ?? 'pending',
          total: order.total ?? null,
          currency: order.currency ?? null,
          createdAt: order.createdAt ?? null,
          userId: order.userId ?? null,
        },
        customer: customerPayload,
        items,
      },
    });
  } catch (error) {
    console.error('Error al obtener ticket:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos obtener los datos del ticket' },
      { status: 500 }
    );
  }
}
