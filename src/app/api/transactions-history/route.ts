import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { withDecryptedUserNames } from '@/lib/customer-decrypt';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const TICKETS_TABLE = process.env.SUPABASE_TICKETS_TABLE ?? 'tickets';
const PAYMENTS_TABLE = process.env.SUPABASE_PAYMENTS_TABLE ?? 'payments';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const MAX_RESULTS = Number(process.env.TRANSACTIONS_HISTORY_LIMIT ?? 200);

const normalizeNumber = (value: unknown, fallback: number | null = 0) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeQuantity = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return parsed <= 0 ? 1 : parsed;
};

type ProductRecord = {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
};

const collectProductIds = (rawItems: unknown, target: Set<string>) => {
  const items = Array.isArray(rawItems) ? rawItems : [];
  items.forEach((item) => {
    const productId = item?.productId ?? item?.product_id;
    if (typeof productId === 'string' && productId.trim()) {
      target.add(productId);
    } else if (typeof productId === 'number' && Number.isFinite(productId)) {
      target.add(String(productId));
    }
  });
};

const mapOrderItems = (rawItems: unknown, productMap?: Map<string, ProductRecord>) => {
  const items = Array.isArray(rawItems) ? rawItems : [];
  return items.map((item) => {
    const rawProductId = item?.productId ?? item?.product_id ?? null;
    const normalizedProductId =
      typeof rawProductId === 'string'
        ? rawProductId
        : typeof rawProductId === 'number' && Number.isFinite(rawProductId)
          ? String(rawProductId)
          : null;
    const productDetails =
      item?.product ??
      (normalizedProductId ? productMap?.get(normalizedProductId) ?? null : null);

    return {
      id: item?.id ?? null,
      productId: rawProductId ?? null,
      quantity: normalizeQuantity(item?.quantity),
      price: normalizeNumber(item?.price, null),
      name: productDetails?.name ?? null,
      category: productDetails?.category ?? null,
      subcategory: productDetails?.subcategory ?? null,
    };
  });
};

const countOrderItems = (items: ReturnType<typeof mapOrderItems>) => {
  const total = items.reduce((acc, item) => {
    const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
    return acc + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);

  return total > 0 ? total : items.length;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const days = Number(searchParams.get('days')) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let orderQuery = supabaseAdmin
      .from(ORDERS_TABLE)
      .select(
        [
          'id',
          '"orderNumber"',
          '"userId"',
          'status',
          'total',
          'currency',
          '"createdAt"',
          '"updatedAt"',
          [
            'user:users(',
            [
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
              '"clientId"',
              '"email"',
            ].join(','),
            ')',
          ].join(''),
          `order_items:${ORDER_ITEMS_TABLE}(id,"productId",quantity,price)`,
        ].join(',')
      )
      .gte('createdAt', since)
      .order('createdAt', { ascending: false })
      .limit(MAX_RESULTS);

    if (status) {
      orderQuery = orderQuery.eq('status', status);
    }

    const [{ data: orders, error: ordersError }, { data: tickets, error: ticketsError }] =
      await Promise.all([
        orderQuery,
        supabaseAdmin
          .from(TICKETS_TABLE)
          .select('id,"orderId","ticketCode","createdAt","tipAmount","tipPercent","paymentMethod"')
          .gte('createdAt', since)
          .order('createdAt', { ascending: false }),
      ]);

    if (ordersError || ticketsError) {
      const message = ordersError?.message || ticketsError?.message || 'Failed to fetch orders';
      throw new Error(message);
    }

    const orderRows = (
      Array.isArray(orders) ? orders.filter((row) => !!row && typeof row === 'object' && !('error' in row)) : []
    ) as Array<Record<string, unknown> & { order_items?: unknown }>;

    const productIds = new Set<string>();
    orderRows.forEach((order) => collectProductIds(order?.order_items, productIds));

    let productMap = new Map<string, ProductRecord>();
    if (productIds.size > 0) {
      const { data: products, error: productsError } = await supabaseAdmin
        .from(PRODUCTS_TABLE)
        .select('id,name,category,subcategory')
        .in('id', Array.from(productIds));
      if (productsError) {
        console.error('Error fetching products for transactions history:', productsError);
      } else if (products) {
        productMap = new Map(
          products
            .filter((product) => product?.id)
            .map((product) => [String(product.id), product as ProductRecord])
        );
      }
    }

    const normalizedOrders = orderRows.map((order) => {
      const { order_items, total, user, ...rest } = order as Record<string, unknown> & {
        id?: string;
        status?: string | null;
        createdAt?: string | null;
        order_items?: unknown;
        total?: unknown;
        user?: Record<string, unknown> | null;
      };
      const items = mapOrderItems(order_items, productMap);
      return {
        ...rest,
        id: rest.id ?? order.id ?? null,
        status: typeof rest.status === 'string' ? rest.status : null,
        total: normalizeNumber(total, null),
        items,
        itemsCount: countOrderItems(items),
        user: withDecryptedUserNames(user ?? null),
        createdAt: typeof rest.createdAt === 'string' ? rest.createdAt : null,
      };
    });

    const orderMap = new Map(normalizedOrders.map((order) => [order.id, order]));
    const ticketMap = new Map((tickets ?? []).map((ticket) => [ticket.orderId, ticket]));

    let payments: Array<{
      id: string;
      orderId: string;
      method?: string | null;
      amount?: number | null;
      currency?: string | null;
      status?: string | null;
      tipAmount?: number | null;
      createdAt?: string | null;
    }> = [];

    if (orderMap.size > 0) {
      const orderIds = Array.from(orderMap.keys());
      const { data: paymentsData, error: paymentsError } = await supabaseAdmin
        .from(PAYMENTS_TABLE)
        .select('id,"orderId",method,amount,currency,status,"tipAmount","createdAt"')
        .in('orderId', orderIds);

      if (paymentsError) {
        console.error('Error fetching payments for transactions history:', paymentsError);
      } else if (paymentsData) {
        payments = paymentsData;
      }
    }

    const paymentMap = new Map(
      (payments ?? [])
        .filter((payment) => typeof payment.orderId === 'string')
        .map((payment) => [payment.orderId as string, payment])
    );

    const transactions = Array.from(orderMap.values()).map((order) => {
      const normalizedOrderId = typeof order.id === 'string' ? order.id : null;
      const ticket = normalizedOrderId ? ticketMap.get(normalizedOrderId) ?? null : null;
      const payment = normalizedOrderId ? paymentMap.get(normalizedOrderId) ?? null : null;
      return {
        order,
        ticket,
        payment,
        total: normalizeNumber(order.total),
        tip: normalizeNumber(ticket?.tipAmount ?? payment?.tipAmount),
        status: order.status,
        createdAt: order.createdAt,
      };
    });

    return NextResponse.json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    console.error('Error fetching transactions history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch transactions history' },
      { status: 500 }
    );
  }
}
