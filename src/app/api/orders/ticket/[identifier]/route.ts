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
import { type RawUserRecord, withDecryptedUserNames } from '@/lib/customer-decrypt';

const TICKETS_TABLE = process.env.SUPABASE_TICKETS_TABLE ?? 'tickets';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';

const TICKET_FIELDS =
  'id,"ticketCode","orderId","userId","paymentMethod","tipAmount","tipPercent",currency,"createdAt"';

const toTrimmedString = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
};

const coerceMetadataObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

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
      'id,"orderNumber",status,total,currency,"createdAt","userId","items","metadata","notes","message","instructions","queuedPaymentMethod"';

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

    const metadataObject = coerceMetadataObject((order as { metadata?: unknown })?.metadata ?? null);
    const prepAssignment =
      metadataObject?.prepAssignment && typeof metadataObject.prepAssignment === 'object' && !Array.isArray(metadataObject.prepAssignment)
        ? coerceMetadataObject(metadataObject.prepAssignment)
        : null;
    const paymentMetadata =
      metadataObject?.payment && typeof metadataObject.payment === 'object' && !Array.isArray(metadataObject.payment)
        ? coerceMetadataObject(metadataObject.payment)
        : null;

    const queuedByStaffId = toTrimmedString(
      (order as { queuedByStaffId?: unknown }).queuedByStaffId
    ) ?? toTrimmedString(prepAssignment?.staffId);
    const queuedByStaffName = toTrimmedString(
      (order as { queuedByStaffName?: unknown }).queuedByStaffName
    ) ?? toTrimmedString(prepAssignment?.staffName);
    const paymentMethodFromOrder = toTrimmedString(
      (order as { queuedPaymentMethod?: unknown }).queuedPaymentMethod
    );
    const paymentMethodFromMetadata = toTrimmedString(paymentMetadata?.method);
    const queuedPaymentMethod =
      paymentMethodFromOrder ?? paymentMethodFromMetadata ?? toTrimmedString(ticketRecord?.paymentMethod);
    const queuedPaymentReference =
      toTrimmedString((order as { queuedPaymentReference?: unknown }).queuedPaymentReference) ??
      toTrimmedString(paymentMetadata?.reference);
    const queuedPaymentReferenceType =
      toTrimmedString(
        (order as { queuedPaymentReferenceType?: unknown }).queuedPaymentReferenceType
      ) ?? toTrimmedString(paymentMetadata?.referenceType);
    const notes = toTrimmedString((order as { notes?: unknown }).notes);
    const message = toTrimmedString((order as { message?: unknown }).message);
    const instructions = toTrimmedString((order as { instructions?: unknown }).instructions);

    const effectiveTicket = {
      id: ticketRecord?.id ?? order.id,
      ticketCode: ticketRecord?.ticketCode ?? order.orderNumber ?? order.id,
      orderId: order.id,
      userId: ticketRecord?.userId ?? order.userId ?? '',
      paymentMethod: queuedPaymentMethod ?? null,
      paymentReference: queuedPaymentReference ?? null,
      paymentReferenceType: queuedPaymentReferenceType ?? null,
      handledByStaffId: queuedByStaffId ?? null,
      handledByStaffName: queuedByStaffName ?? null,
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

    const resolveStoredItems = () => {
      if (Array.isArray(order.items)) {
        return order.items as Array<Record<string, unknown>>;
      }
      if (order.items && typeof order.items === 'object') {
        const nestedItems = (order.items as Record<string, unknown>).items;
        if (Array.isArray(nestedItems)) {
          return nestedItems as Array<Record<string, unknown>>;
        }
      }
      if (typeof order.items === 'string') {
        try {
          const parsed = JSON.parse(order.items);
          if (Array.isArray(parsed)) {
            return parsed as Array<Record<string, unknown>>;
          }
          if (
            parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { items?: Array<Record<string, unknown>> }).items)
          ) {
            return (parsed as { items: Array<Record<string, unknown>> }).items;
          }
        } catch {
          // Ignoramos payloads malformados; caeremos al resto de fuentes.
        }
      }
      return null;
    };

    const buildSnapshotItems = () => {
      const storedItems = resolveStoredItems();
      if (!storedItems?.length) {
        return [] as Array<{
          id: string;
          productId: string | null;
          quantity: number;
          price: number | null;
          product: { name?: string | null; category?: string | null; subcategory?: string | null } | null;
          sizeId: string | null;
          sizeLabel: string | null;
          packageId: string | null;
          packageName: string | null;
          metadata: Record<string, unknown> | null;
        }>;
      }

      const normalizedItems: Array<{
        id: string;
        productId: string | null;
        quantity: number;
        price: number | null;
        product: { name?: string | null; category?: string | null; subcategory?: string | null } | null;
        sizeId: string | null;
        sizeLabel: string | null;
        packageId: string | null;
        packageName: string | null;
        metadata: Record<string, unknown> | null;
      }> = [];

      storedItems.forEach((rawItem, index) => {
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
        const sizeId =
          toTrimmedString(rawItem.sizeId) ??
          toTrimmedString(rawItem.size_id) ??
          toTrimmedString(rawItem.size);
        const sizeLabel =
          toTrimmedString(rawItem.sizeLabel) ??
          toTrimmedString(rawItem.size_label) ??
          toTrimmedString(rawItem.sizeName) ??
          toTrimmedString(rawItem.size);
        const packageId =
          toTrimmedString(rawItem.packageId) ??
          toTrimmedString(rawItem.package_id) ??
          toTrimmedString(rawItem.bundleId) ??
          toTrimmedString(rawItem.package);
        const packageName =
          toTrimmedString(rawItem.packageName) ??
          toTrimmedString(rawItem.package_name) ??
          toTrimmedString(rawItem.bundleName);
        const metadata =
          rawItem.metadata && typeof rawItem.metadata === 'object'
            ? (rawItem.metadata as Record<string, unknown>)
            : null;

        normalizedItems.push({
          id: `${order.id}-snapshot-${index}`,
          productId,
          quantity,
          price,
          product: {
            name: typeof name === 'string' ? name : null,
            category,
            subcategory,
          },
          sizeId,
          sizeLabel,
          packageId,
          packageName,
          metadata,
        });
      });

      return normalizedItems;
    };
    const snapshotItems = buildSnapshotItems().filter((item) => item.quantity > 0);

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

    let items = snapshotItems.length
      ? snapshotItems.map((item) => ({
          id: item.id,
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          product:
            item.productId && productMap.size
              ? productMap.get(String(item.productId)) ?? item.product ?? null
              : item.product ?? null,
          sizeId: item.sizeId,
          sizeLabel: item.sizeLabel,
          packageId: item.packageId,
          packageName: item.packageName,
          metadata: item.metadata,
        }))
      : [];

    const parseTicketPayloadItems = () => {
      const payload =
        (ticketRecord as { qrPayload?: unknown; metadata?: unknown })?.qrPayload ??
        (ticketRecord as { metadata?: unknown })?.metadata ??
        null;
      let parsed: Record<string, unknown> | null = null;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        parsed = payload as Record<string, unknown>;
      } else if (typeof payload === 'string') {
        try {
          const candidate = JSON.parse(payload);
          if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            parsed = candidate as Record<string, unknown>;
          }
        } catch {
          parsed = null;
        }
      }
      if (!parsed) {
        return [];
      }

      const rawItems: unknown[] = Array.isArray(parsed.items)
        ? parsed.items
        : Array.isArray((parsed as { lineItems?: unknown[] }).lineItems)
          ? ((parsed as { lineItems?: unknown[] }).lineItems as unknown[])
          : [];
      if (!rawItems.length) {
        return [];
      }

      const normalizedItems: Array<{
        id: string;
        productId: string | null;
        quantity: number;
        price: number | null;
        product: { name?: string | null; category?: string | null; subcategory?: string | null } | null;
        sizeId: string | null;
        sizeLabel: string | null;
        packageId: string | null;
        packageName: string | null;
        metadata: Record<string, unknown> | null;
      }> = [];

      rawItems
        .filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))
        )
        .forEach((entry, index) => {
          const productId =
            typeof entry.productId === 'string'
              ? entry.productId
              : typeof entry.id === 'string'
                ? entry.id
                : null;
          const category =
            typeof entry.category === 'string'
              ? entry.category
              : typeof entry.type === 'string'
                ? entry.type
                : null;
          const subcategory =
            typeof entry.subcategory === 'string'
              ? entry.subcategory
              : typeof entry.group === 'string'
                ? entry.group
                : null;
          const name = typeof entry.name === 'string' ? entry.name : productId;
          const sizeId =
            toTrimmedString(entry.sizeId) ??
            toTrimmedString(entry.size_id) ??
            toTrimmedString(entry.sizeIdentifier) ??
            toTrimmedString(entry.size);
          const sizeLabel =
            toTrimmedString(entry.sizeLabel) ??
            toTrimmedString(entry.size_label) ??
            toTrimmedString(entry.sizeName) ??
            toTrimmedString(entry.size);
          const packageId =
            toTrimmedString(entry.packageId) ??
            toTrimmedString(entry.package_id) ??
            toTrimmedString(entry.bundleId) ??
            toTrimmedString(entry.package);
          const packageName =
            toTrimmedString(entry.packageName) ??
            toTrimmedString(entry.package_name) ??
            toTrimmedString(entry.bundleName);
          const packageItems = Array.isArray(entry.packageItems)
            ? entry.packageItems.filter((value): value is string => typeof value === 'string')
            : null;
          const metadata =
            entry.metadata && typeof entry.metadata === 'object'
              ? (entry.metadata as Record<string, unknown>)
              : packageItems
                ? { packageItems }
                : null;

          normalizedItems.push({
            id:
              (typeof entry.id === 'string' && entry.id) ||
              `${ticketRecord?.id ?? order.id ?? 'ticket'}-qr-${index}`,
            productId: productId,
            quantity: normalizeQuantity(entry.quantity ?? entry.qty ?? entry.amount),
            price: normalizePrice(entry.price ?? entry.unitPrice ?? entry.amount),
            product: {
              name: typeof name === 'string' ? name : null,
              category: category,
              subcategory: subcategory,
            },
            sizeId: sizeId,
            sizeLabel: sizeLabel,
            packageId: packageId,
            packageName: packageName,
            metadata: metadata,
          });
        });

      return normalizedItems;
    };

    if (!items.length) {
      items =
        orderItems?.map((item) => ({
          id: item.id,
          productId: item.productId ?? null,
          quantity: item.quantity ?? 0,
          price: item.price ?? null,
          product: item.productId ? productMap.get(String(item.productId)) ?? null : null,
          sizeId: null,
          sizeLabel: null,
          packageId: null,
          packageName: null,
          metadata: null,
        })) ?? [];
    }

    if (!items.length) {
      const payloadItems = parseTicketPayloadItems();
      if (payloadItems.length) {
        items = payloadItems;
      }
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
          metadata: order.metadata ?? null,
          notes,
          message,
          instructions,
          queuedPaymentMethod: queuedPaymentMethod ?? null,
          queuedPaymentReference: queuedPaymentReference ?? null,
          queuedPaymentReferenceType: queuedPaymentReferenceType ?? null,
          queuedByStaffId: queuedByStaffId ?? null,
          queuedByStaffName: queuedByStaffName ?? null,
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
