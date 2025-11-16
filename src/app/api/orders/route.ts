import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { withDecryptedUserNames } from '@/lib/customer-decrypt';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const TICKETS_TABLE = process.env.SUPABASE_TICKETS_TABLE ?? 'tickets';
const ORDER_CODES_TABLE = process.env.SUPABASE_ORDER_CODES_TABLE ?? 'order_codes';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const MAX_RESULTS = Number(process.env.ORDERS_LIMIT ?? 100);

const TICKET_CODE_PREFIX = 'XL-';
const TICKET_CODE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TICKET_CODE_DIGITS = '0123456789';

const generateTicketCode = () => {
  const digits = Array.from({ length: 2 }, () =>
    TICKET_CODE_DIGITS[Math.floor(Math.random() * TICKET_CODE_DIGITS.length)]
  );
  const letters = Array.from({ length: 3 }, () =>
    TICKET_CODE_LETTERS[Math.floor(Math.random() * TICKET_CODE_LETTERS.length)]
  );
  return `${TICKET_CODE_PREFIX}${digits.join('')}${letters.join('')}`;
};

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    const inlineDetails = {
      name: typeof item?.name === 'string' ? item.name : null,
      category: typeof item?.category === 'string' ? item.category : null,
      subcategory: typeof item?.subcategory === 'string' ? item.subcategory : null,
    };

    const productDetails =
      item?.product ??
      (normalizedProductId ? productMap?.get(normalizedProductId) ?? null : null);

    return {
      id: item?.id ?? null,
      productId: normalizedProductId,
      quantity: normalizeQuantity(item?.quantity),
      price: normalizeNumber(item?.price),
      name: inlineDetails.name ?? productDetails?.name ?? null,
      category: inlineDetails.category ?? productDetails?.category ?? null,
      subcategory: inlineDetails.subcategory ?? productDetails?.subcategory ?? null,
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

type IncomingOrderItem = {
  productId: string;
  quantity: number;
  price: number;
  name: string | null;
  category: string | null;
  subcategory: string | null;
};

const normalizeOrderItems = (rawItems: unknown): IncomingOrderItem[] => {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const normalized = items
    .map((item) => {
      const rawProductId = item?.productId ?? item?.product_id ?? item?.id ?? null;
      const productId =
        typeof rawProductId === 'string'
          ? rawProductId.trim()
          : typeof rawProductId === 'number' && Number.isFinite(rawProductId)
            ? String(rawProductId)
            : '';

      if (!productId) {
        return null;
      }

      const quantity = normalizeQuantity(item?.quantity ?? item?.qty);
      const price = normalizeNumber(item?.unitPrice ?? item?.price ?? item?.amount) ?? 0;

      return {
        productId,
        quantity: typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : 1,
        price: Number.isFinite(price) ? price : 0,
        name: typeof item?.name === 'string' ? item.name : null,
        category: typeof item?.category === 'string' ? item.category : null,
        subcategory: typeof item?.subcategory === 'string' ? item.subcategory : null,
      };
    })
    .filter(Boolean) as IncomingOrderItem[];

  return normalized;
};

const ensureProducts = async (items: IncomingOrderItem[]) => {
  const productIds = Array.from(new Set(items.map((item) => item.productId))).filter(Boolean);
  if (!productIds.length) {
    return;
  }

  const { data: existingById, error: existingByIdError } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('id,"productId"')
    .in('id', productIds);

  if (existingByIdError) {
    throw new Error(`Failed to fetch products: ${existingByIdError.message}`);
  }

  const { data: existingByProductId, error: existingByProductIdError } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('id,"productId"')
    .in('productId', productIds);

  if (existingByProductIdError) {
    throw new Error(`Failed to fetch products by productId: ${existingByProductIdError.message}`);
  }

  const existingIds = new Set<string>();
  [...(existingById ?? []), ...(existingByProductId ?? [])].forEach((product) => {
    if (product.id) {
      existingIds.add(String(product.id));
    }
    if (product.productId) {
      existingIds.add(String(product.productId));
    }
  });
  const insertsMap = new Map<string, IncomingOrderItem>();
  items.forEach((item) => {
    if (!existingIds.has(item.productId) && !insertsMap.has(item.productId)) {
      insertsMap.set(item.productId, item);
    }
  });

  if (!insertsMap.size) {
    return;
  }

  const newProducts = Array.from(insertsMap.values()).map((item) => ({
    id: item.productId,
    productId: item.productId,
    name: item.name ?? item.productId,
    category: item.category,
    subcategory: item.subcategory,
    price: Number.isFinite(item.price) ? item.price : 0,
  }));

  const { error: insertError } = await supabaseAdmin.from(PRODUCTS_TABLE).insert(newProducts);
  if (insertError) {
    throw new Error(`Failed to insert products: ${insertError.message}`);
  }
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = supabaseAdmin
      .from(ORDERS_TABLE)
      .select(
        [
          'id',
          '"userId"',
          '"orderNumber"',
          'status',
          'total',
          'currency',
          '"items"',
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
      .order('createdAt', { ascending: false })
      .limit(MAX_RESULTS);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    const ordersData = (
      Array.isArray(data) ? data.filter((row) => !!row && typeof row === 'object' && !('error' in row)) : []
    ) as Array<Record<string, unknown>>;

    const productIds = new Set<string>();
    ordersData.forEach((order) => collectProductIds(order?.order_items, productIds));

    let productMap = new Map<string, ProductRecord>();
    if (productIds.size > 0) {
      const { data: products, error: productsError } = await supabaseAdmin
        .from(PRODUCTS_TABLE)
        .select('id,name,category,subcategory')
        .in('id', Array.from(productIds));
      if (productsError) {
        console.error('Error fetching products for orders:', productsError);
      } else if (products) {
        productMap = new Map(
          products
            .filter((product) => product?.id)
            .map((product) => [String(product.id), product as ProductRecord])
        );
      }
    }

    let enriched = ordersData.map((order) => {
      const { order_items, items: rawStoredItems, total, user, ...rest } = order as Record<
        string,
        unknown
      > & {
        id?: string;
        order_items?: unknown;
        items?: unknown;
        total?: unknown;
        user?: Record<string, unknown> | null;
      };
      const sourceItems =
        Array.isArray(order_items) && order_items.length
          ? order_items
          : Array.isArray(rawStoredItems)
            ? rawStoredItems
            : [];
      const items = mapOrderItems(sourceItems, productMap);
      return {
        ...rest,
        id: rest.id ?? order.id ?? null,
        total: normalizeNumber(total),
        items,
        itemsCount: countOrderItems(items),
        user: withDecryptedUserNames(user ?? null),
      };
    });

    if (enriched.length) {
      const orderIds = enriched.map((order) => order.id);

      const [{ data: tickets, error: ticketsError }, { data: codes, error: codesError }] =
        await Promise.all([
          supabaseAdmin.from(TICKETS_TABLE).select('"orderId","ticketCode"').in('orderId', orderIds),
          supabaseAdmin.from(ORDER_CODES_TABLE).select('"orderId",code').in('orderId', orderIds),
        ]);

      if (ticketsError) {
        console.error('Error fetching tickets:', ticketsError);
      }
      if (codesError) {
        console.error('Error fetching order codes:', codesError);
      }

      const ticketMap = new Map(
        (tickets ?? []).map((ticket) => [ticket.orderId, ticket.ticketCode ?? null])
      );
      const codeMap = new Map((codes ?? []).map((code) => [code.orderId, code.code ?? null]));

      enriched = enriched.map((order) => ({
        ...order,
        ticketCode: ticketMap.get(order.id) || null,
        shortCode: codeMap.get(order.id) || null,
      }));
    }

    return NextResponse.json({
      success: true,
      data: enriched,
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }

    const providedOrderId =
      typeof payload.orderId === 'string' && payload.orderId.trim() ? payload.orderId.trim() : null;
    const fallbackTicketCode =
      typeof payload.ticketCode === 'string' && payload.ticketCode.trim()
        ? payload.ticketCode.trim()
        : null;
    const ticketCode = fallbackTicketCode ?? generateTicketCode();
    const orderId = providedOrderId ?? fallbackTicketCode ?? randomUUID();

    const status = typeof payload.status === 'string' ? payload.status : 'pending';
    const currency = typeof payload.currency === 'string' ? payload.currency : 'MXN';
    const paymentMethod =
      typeof payload.paymentMethod === 'string'
        ? payload.paymentMethod
        : payload?.ticket?.paymentMethod ?? null;

    const subtotal = normalizeNumber(payload?.totals?.subtotal);
    const tax = normalizeNumber(payload?.totals?.tax);
    const total = normalizeNumber(payload?.totals?.total) ?? subtotal ?? 0;
    const tipAmount =
      normalizeNumber(payload?.totals?.tip) ??
      normalizeNumber(payload?.tip?.amount) ??
      null;
    const tipPercent = normalizeNumber(payload?.tip?.percent);
    const userId =
      typeof payload.userId === 'string' && payload.userId.trim() ? payload.userId.trim() : null;

    const items = normalizeOrderItems(payload?.items);

    if (!items.length) {
      return NextResponse.json(
        { success: false, error: 'At least one order item is required' },
        { status: 400 }
      );
    }

    await ensureProducts(items);

    const orderItemsSnapshot = items.map((item) => ({
      productId: item.productId,
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      quantity: item.quantity,
      price: item.price,
    }));
    const orderRecord: Record<string, unknown> = {
      id: orderId,
      status,
      currency,
      total,
      items: orderItemsSnapshot,
    };

    if (userId) {
      orderRecord.userId = userId;
    }

    const totalsPayload: Record<string, number | null> = {};
    if (subtotal !== null) totalsPayload.subtotal = subtotal;
    if (tax !== null) totalsPayload.tax = tax;
    if (tipAmount !== null) totalsPayload.tip = tipAmount;
    if (total !== null) totalsPayload.total = total;

    if (Object.keys(totalsPayload).length) {
      orderRecord.totals = totalsPayload;
    }

    if (tipAmount !== null) {
      orderRecord.tipAmount = tipAmount;
    }
    if (tipPercent !== null) {
      orderRecord.tipPercent = tipPercent;
    }

    const { error: orderError } = await supabaseAdmin.from(ORDERS_TABLE).upsert(orderRecord);
    if (orderError) {
      throw new Error(`Failed to upsert order: ${orderError.message}`);
    }

    const { error: deleteItemsError } = await supabaseAdmin
      .from(ORDER_ITEMS_TABLE)
      .delete()
      .eq('orderId', orderId);
    if (deleteItemsError) {
      throw new Error(`Failed to clear order items: ${deleteItemsError.message}`);
    }

    const orderItemsPayload = items.map((item) => ({
      orderId,
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
    }));

    const { error: insertItemsError } = await supabaseAdmin
      .from(ORDER_ITEMS_TABLE)
      .insert(orderItemsPayload);
    if (insertItemsError) {
      throw new Error(`Failed to insert order items: ${insertItemsError.message}`);
    }

    if (ticketCode || paymentMethod) {
      const ticketRecord = {
        orderId,
        ticketCode,
        paymentMethod,
      };
      const { error: ticketError } = await supabaseAdmin.from(TICKETS_TABLE).upsert(ticketRecord);
      if (ticketError) {
        throw new Error(`Failed to upsert ticket: ${ticketError.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        ticketCode,
        items: orderItemsPayload.length,
      },
    });
  } catch (error) {
    console.error('Error processing order webhook:', error);
    const message = error instanceof Error ? error.message : 'Failed to process order';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
