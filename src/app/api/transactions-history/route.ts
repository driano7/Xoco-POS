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

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
import { withDecryptedUserNames } from '@/lib/customer-decrypt';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const TICKETS_TABLE = process.env.SUPABASE_TICKETS_TABLE ?? 'tickets';
const PAYMENTS_TABLE = process.env.SUPABASE_PAYMENTS_TABLE ?? 'payments';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const ORDER_CLIENT_ID_COLUMN = process.env.SUPABASE_ORDERS_CLIENT_ID_COLUMN?.trim() || null;
const MAX_RESULTS = Number(process.env.TRANSACTIONS_HISTORY_LIMIT ?? 200);

const normalizeNumber = (value: unknown, fallback: number | null = 0) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDateParam = (value: string | null) => {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
};

const parseAmountParam = (value: string | null) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number.parseFloat(value.replace(/,/g, '.'));
  return Number.isFinite(normalized) ? normalized : null;
};

const normalizeQuantity = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return parsed <= 0 ? 1 : parsed;
};

const coerceString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

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

const extractClientId = (
  source: Record<string, unknown> | null | undefined
): string | null => {
  if (!source) {
    return null;
  }
  const { clientId } = source as { clientId?: unknown };
  return typeof clientId === 'string' ? clientId : null;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const days = Number(searchParams.get('days')) || 30;
    const fromParam = parseDateParam(searchParams.get('from'));
    const toParam = parseDateParam(searchParams.get('to'));
    const clientIdFilter = searchParams.get('clientId')?.trim() || null;
    const minTotal = parseAmountParam(searchParams.get('minTotal'));
    const maxTotal = parseAmountParam(searchParams.get('maxTotal'));
    const since = fromParam ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const orderSelectFields = [
      'id',
      '"orderNumber"',
      '"userId"',
      ORDER_CLIENT_ID_COLUMN ? `clientId:${ORDER_CLIENT_ID_COLUMN}` : null,
      'status',
      'total',
      'currency',
      '"createdAt"',
      '"updatedAt"',
      '"metadata"',
      '"notes"',
      '"message"',
      '"instructions"',
      '"queuedPaymentMethod"',
      '"queuedPaymentReference"',
      '"queuedPaymentReferenceType"',
      '"queuedByStaffId"',
      '"queuedByStaffName"',
      '"montoRecibido"',
      '"cambioEntregado"',
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
    ].filter((value): value is string => Boolean(value));

    let orderQuery = supabaseAdmin
      .from(ORDERS_TABLE)
      .select(orderSelectFields.join(','))
      .gte('createdAt', since)
      .order('createdAt', { ascending: false })
      .limit(MAX_RESULTS);

    if (status) {
      orderQuery = orderQuery.eq('status', status);
    }
    if (toParam) {
      orderQuery = orderQuery.lte('createdAt', toParam);
    }
    if (clientIdFilter && ORDER_CLIENT_ID_COLUMN) {
      orderQuery = orderQuery.eq(ORDER_CLIENT_ID_COLUMN, clientIdFilter);
    }
    if (minTotal !== null) {
      orderQuery = orderQuery.gte('total', minTotal);
    }
    if (maxTotal !== null) {
      orderQuery = orderQuery.lte('total', maxTotal);
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
      const decryptedUser = withDecryptedUserNames(user ?? null);
      return {
        ...rest,
        id: rest.id ?? order.id ?? null,
        status: typeof rest.status === 'string' ? rest.status : null,
        total: normalizeNumber(total, null),
        items,
        itemsCount: countOrderItems(items),
        user: decryptedUser,
        clientId:
          coerceString((rest as { clientId?: unknown }).clientId) ??
          decryptedUser?.clientId ??
          null,
        createdAt: typeof rest.createdAt === 'string' ? rest.createdAt : null,
      };
    });

    let filteredOrders = normalizedOrders;
    if (clientIdFilter && !ORDER_CLIENT_ID_COLUMN) {
      const normalizedSearch = clientIdFilter.toLowerCase();
      filteredOrders = normalizedOrders.filter((order) => {
        const directClientId = coerceString(
          (order as { clientId?: unknown }).clientId
        );
        const userClientId = extractClientId(
          (order as { user?: Record<string, unknown> | null }).user ?? null
        );
        return (
          (directClientId && directClientId.toLowerCase() === normalizedSearch) ||
          (userClientId && userClientId.toLowerCase() === normalizedSearch)
        );
      });
    }

    const orderMap = new Map(filteredOrders.map((order) => [order.id, order]));
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
      const orderTicketCode =
        typeof (order as { ticketCode?: unknown }).ticketCode === 'string'
          ? ((order as { ticketCode?: string }).ticketCode ?? null)
          : null;
      const orderTipAmount =
        typeof (order as { tipAmount?: unknown }).tipAmount === 'number'
          ? ((order as { tipAmount?: number }).tipAmount ?? null)
          : null;
      const orderTipPercent =
        typeof (order as { tipPercent?: unknown }).tipPercent === 'number'
          ? ((order as { tipPercent?: number }).tipPercent ?? null)
          : null;
      const orderPaymentMethod =
        typeof (order as { paymentMethod?: unknown }).paymentMethod === 'string'
          ? ((order as { paymentMethod?: string }).paymentMethod ?? null)
          : null;
      const orderQueuedPaymentMethod =
        typeof (order as { queuedPaymentMethod?: unknown }).queuedPaymentMethod === 'string'
          ? ((order as { queuedPaymentMethod?: string }).queuedPaymentMethod ?? null)
          : null;
      const augmentedOrder = {
        ...order,
        ticketCode: ticket?.ticketCode ?? orderTicketCode ?? null,
        tipAmount: orderTipAmount ?? ticket?.tipAmount ?? null,
        tipPercent: orderTipPercent ?? ticket?.tipPercent ?? null,
        paymentMethod:
          orderPaymentMethod ?? orderQueuedPaymentMethod ?? ticket?.paymentMethod ?? null,
      };
      return {
        order: augmentedOrder,
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
