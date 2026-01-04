'use client';

/*
 * --------------------------------------------------------------------
 *  Xoco Café — Software Property
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
 *  Copyright (c) 2025 Xoco Café.
 *  Desarrollador Principal: Donovan Riaño.
 *
 *  Este archivo está licenciado bajo la Apache License 2.0.
 *  Consulta el archivo LICENSE en la raíz del proyecto para más detalles.
 * --------------------------------------------------------------------
 */

import Image from 'next/image';
import { forwardRef, useMemo } from 'react';
import TicketOrderSummary from './ticket-order-summary';
import { buildOrderQrPayload } from './order-qr-payload';

type ItemCategory = 'beverage' | 'food' | 'package' | 'other';

export interface OrderItem {
  name: string;
  quantity: number;
  price: number;
  category: ItemCategory;
  size?: string | null;
  packageItems?: string[] | null;
  productId?: string | null;
}

export interface VirtualTicketProps {
  order: {
    id: string;
    orderNumber?: string | null;
    ticketId?: string | null;
    status?: 'pending' | 'in_progress' | 'completed' | 'past' | null;
    userEmail?: string | null;
    customerName?: string | null;
    posCustomerId?: string | null;
    createdAt?: string | null;
    total?: number | null;
    tipAmount?: number | null;
    tipPercent?: number | null;
    subtotal?: number | null;
    vatAmount?: number | null;
    vatPercent?: number | null;
    deliveryTipAmount?: number | null;
    deliveryTipPercent?: number | null;
    items?: any;
    qrPayload?: any;
    type?: string | null;
    shipping?: {
      address?: {
        street?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        reference?: string;
      };
      contactPhone?: string | null;
      isWhatsapp?: boolean | null;
      addressId?: string | null;
      deliveryTip?: {
        amount?: number | null;
        percent?: number | null;
      } | null;
    } | null;
  };
  showQr?: boolean;
  orderStatus?: 'pending' | 'in_progress' | 'completed' | 'past' | null;
}

const QR_API_URL = '/api/qr';
const QR_IMAGE_SIZE = '320x320';
const FISCAL_ADDRESS = 'Escolar 04360, C.U., Coyoacán, 04510 Ciudad de México, CDMX';
const BEVERAGE_KEYWORDS = [
  'bebida',
  'beverage',
  'drink',
  'coffee',
  'cafe',
  'café',
  'latte',
  'espresso',
  'matcha',
  'tea',
  'tisana',
  'agua',
  'refresc',
  'juice',
  'frapp',
];
const FOOD_KEYWORDS = [
  'food',
  'comida',
  'pan',
  'bakery',
  'postre',
  'dessert',
  'cake',
  'sandwich',
  'bagel',
  'tostada',
  'ensalada',
  'toast',
  'croissant',
];
const PACKAGE_KEYWORDS = ['paquete', 'combo'];
const CATEGORY_LABELS: Record<ItemCategory, string> = {
  beverage: 'Bebidas',
  food: 'Alimentos',
  package: 'Paquetes',
  other: 'Otros',
};

const normalizeText = (value?: string | null) =>
  (value ?? '').toString().toLowerCase().normalize('NFD');

const classifyItemCategory = (item: any): ItemCategory => {
  const directCategory = normalizeText(item.category);
  if (directCategory.includes('beverage')) return 'beverage';
  if (directCategory.includes('food')) return 'food';
  if (directCategory.includes('package')) return 'package';

  const haystack = [
    normalizeText(item.category),
    normalizeText(item.subcategory),
    normalizeText(item.name),
    normalizeText(item.productName),
    normalizeText(item.product?.name),
    normalizeText(item.product?.displayName),
    normalizeText(item.productId),
  ].join(' ');

  if (haystack && PACKAGE_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'package';
  }
  if (haystack && BEVERAGE_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'beverage';
  }
  if (haystack && FOOD_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'food';
  }
  return 'other';
};

const normalizeQuantity = (value: unknown) => {
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue > 0) {
    return numberValue;
  }
  return 1;
};

const summarizeItems = (items: OrderItem[]) =>
  items.reduce(
    (acc, item) => {
      const qty = Number.isFinite(item.quantity) ? item.quantity : 0;
      acc.total += qty;
      if (item.category === 'beverage') {
        acc.beverages += qty;
      } else if (item.category === 'food') {
        acc.foods += qty;
      } else if (item.category === 'package') {
        acc.packages += qty;
      } else {
        acc.other += qty;
      }
      return acc;
    },
    { beverages: 0, foods: 0, packages: 0, other: 0, total: 0 }
  );

const parseMaybeJson = (value: any) => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn('No pudimos parsear items del ticket:', error);
      return null;
    }
  }
  return value;
};

const parseTextItem = (value: string): OrderItem | null => {
  const normalized = value.trim();
  if (!normalized) return null;
  const match = normalized.match(/^[^\d]*(\d+)\s*[x×]\s*(.+)$/i);
  const quantity = match?.[1] ? Number(match[1]) : 1;
  const name = (match?.[2] ?? normalized).trim();
  return {
    name,
    quantity: normalizeQuantity(quantity),
    price: 0,
    category: classifyItemCategory({ name }),
    size: null,
    packageItems: null,
  };
};

const buildOrderItem = (item: any): OrderItem => {
  if (typeof item === 'string') {
    const parsed = parseTextItem(item);
    if (parsed) return parsed;
    return {
      name: item.trim() || 'Producto',
      quantity: 1,
      price: 0,
      category: 'other',
      size: null,
      packageItems: null,
    };
  }
  return {
    name: String(
      item?.name ??
        item?.productName ??
        item?.product?.name ??
        item?.product?.displayName ??
        item?.productId ??
        item?.n ??
        'Producto'
    ),
    quantity: normalizeQuantity(item?.quantity ?? item?.qty ?? item?.q),
    price: Number.isFinite(Number(item?.price ?? item?.amount ?? item?.p))
      ? Number(item?.price ?? item?.amount ?? item?.p)
      : 0,
    category:
      typeof item?.category === 'string'
        ? (item.category as ItemCategory)
        : typeof item?.c === 'string'
        ? (item.c as ItemCategory)
        : classifyItemCategory(item),
    size: typeof item?.size === 'string' ? item.size : typeof item?.s === 'string' ? item.s : null,
    packageItems: Array.isArray(item?.packageItems)
      ? item.packageItems.map((entry: any) => String(entry))
      : null,
    productId:
      typeof item?.productId === 'string'
        ? item.productId
        : typeof item?.id === 'string'
        ? item.id
        : null,
  };
};

const isPotentialItemEntry = (value: any) => {
  if (typeof value === 'string') {
    return /\d+\s*[x×]/i.test(value);
  }
  if (typeof value === 'object' && value && 'name' in value) {
    return true;
  }
  return false;
};

const extractItemsFromMetadata = (metadata: any): OrderItem[] => {
  if (!metadata) return [];
  if (Array.isArray(metadata)) {
    return metadata.filter(isPotentialItemEntry).map(buildOrderItem);
  }
  if (typeof metadata === 'object') {
    const candidateFields = [
      metadata.items,
      metadata.orderItems,
      metadata.products,
      metadata.lineItems,
    ].filter(Boolean);
    for (const value of candidateFields) {
      if (Array.isArray(value)) {
        return value.filter(isPotentialItemEntry).map(buildOrderItem);
      }
    }
  }
  return [];
};

const resolvePackageDetails = (items: OrderItem[]) => {
  return items
    .filter((item) => item.category === 'package' && Array.isArray(item.packageItems))
    .map((pkg) => ({
      name: pkg.name,
      quantity: pkg.quantity,
      contents: pkg.packageItems ?? [],
    }));
};

const formatCurrency = (value?: number | null) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value ?? 0);

const VirtualTicket = forwardRef<HTMLDivElement, VirtualTicketProps>(
  ({ order, showQr = true, orderStatus = order.status ?? null }, ref) => {
    const resolvedItems = useMemo(() => {
      const normalizedItems = parseMaybeJson(order.items) ?? extractItemsFromMetadata(order.items);
      if (Array.isArray(normalizedItems) && normalizedItems.length > 0) {
        return normalizedItems.map(buildOrderItem);
      }
      return [
        {
          name: 'Producto genérico',
          quantity: 1,
          price: order.total ?? 0,
          category: 'other' as ItemCategory,
          size: null,
          packageItems: null,
        },
      ];
    }, [order.items, order.total]);

    const stats = useMemo(() => summarizeItems(resolvedItems), [resolvedItems]);
    const packageDetails = useMemo(() => resolvePackageDetails(resolvedItems), [resolvedItems]);

    const qrPayload = useMemo(() => {
      if (!order.qrPayload) {
        return buildOrderQrPayload({
          ticketCode: order.ticketId ?? order.orderNumber ?? order.id,
          orderId: order.id,
          customerName: order.customerName ?? order.posCustomerId ?? 'Cliente POS',
          customerEmail: order.userEmail,
          customerClientId: order.posCustomerId,
          totalAmount: order.total ?? 0,
          tipAmount: order.tipAmount ?? 0,
          tipPercent: order.tipPercent ?? null,
          items: resolvedItems.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            category: item.category,
            size: item.size,
          })),
          shippingAddressId: order.shipping?.addressId ?? null,
          deliveryTipAmount: order.deliveryTipAmount ?? order.shipping?.deliveryTip?.amount ?? null,
          deliveryTipPercent:
            order.deliveryTipPercent ?? order.shipping?.deliveryTip?.percent ?? null,
          createdAt: order.createdAt ?? null,
        });
      }
      return order.qrPayload;
    }, [order, resolvedItems]);

    const qrUrl = useMemo(() => {
      if (!showQr) return null;
      const payload = encodeURIComponent(JSON.stringify(qrPayload));
      return `${QR_API_URL}?payload=${payload}&size=${QR_IMAGE_SIZE}`;
    }, [qrPayload, showQr]);

    const displayCode = order.ticketId ?? order.orderNumber ?? order.id;

    return (
      <div
        ref={ref}
        className="w-full max-w-[380px] rounded-[32px] border border-gray-200 bg-white p-6 text-gray-900 shadow-xl ring-1 ring-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      >
        <div className="flex items-center justify-between">
          <Image src="/xoco-logo.svg" alt="Xoco Café" width={72} height={72} priority />
          <div className="text-right text-xs uppercase tracking-[0.35em] text-gray-500 dark:text-gray-300">
            Ticket POS
          </div>
        </div>
        <div className="mt-4 space-y-1 text-sm">
          <p className="font-semibold">{order.customerName ?? 'Cliente POS'}</p>
          <p className="text-xs text-gray-500">
            {new Date(order.createdAt ?? Date.now()).toLocaleString('es-MX', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
          <p className="text-xs text-gray-500">{FISCAL_ADDRESS}</p>
        </div>

        <div className="mt-4 space-y-3">
          {resolvedItems.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-gray-500">
                  {item.quantity} × {formatCurrency(item.price)} · {CATEGORY_LABELS[item.category]}
                </p>
                {item.size && <p className="text-xs text-gray-500">Tamaño: {item.size}</p>}
                {item.packageItems && item.packageItems.length > 0 && (
                  <p className="text-xs text-gray-500">
                    Incluye: {item.packageItems.slice(0, 3).join(', ')}
                  </p>
                )}
              </div>
              <span className="font-semibold">{formatCurrency(item.quantity * item.price)}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-1 border-t border-dashed border-gray-200 pt-4 text-sm">
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
            <span>{formatCurrency(order.subtotal ?? order.total ?? 0)}</span>
          </div>
          {order.vatAmount ? (
            <div className="flex items-center justify-between">
              <span>IVA {order.vatPercent ? `${order.vatPercent}%` : ''}</span>
              <span>{formatCurrency(order.vatAmount)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between text-base font-semibold">
            <span>Total</span>
            <span>{formatCurrency(order.total ?? 0)}</span>
          </div>
          {order.tipAmount ? (
            <div className="flex items-center justify-between text-xs">
              <span>Propina {order.tipPercent ? `${order.tipPercent}%` : ''}</span>
              <span>{formatCurrency(order.tipAmount)}</span>
            </div>
          ) : null}
          {order.deliveryTipAmount ? (
            <div className="flex items-center justify-between text-xs">
              <span>Propina delivery {order.deliveryTipPercent ? `${order.deliveryTipPercent}%` : ''}</span>
              <span>{formatCurrency(order.deliveryTipAmount)}</span>
            </div>
          ) : null}
        </div>

        <TicketOrderSummary stats={stats} packages={packageDetails} />

        {showQr && qrUrl && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
              <Image src={qrUrl} alt="QR del ticket" width={180} height={180} priority />
            </div>
            <p className="text-xs text-gray-500">Ticket #{displayCode}</p>
          </div>
        )}

        <div className="mt-4 rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-gray-800/50 dark:text-gray-300">
          <p>
            Estatus:{' '}
            <span className="font-semibold">
              {orderStatus === 'in_progress'
                ? 'En preparación'
                : orderStatus === 'completed'
                ? 'Completado'
                : orderStatus === 'past'
                ? 'Finalizado'
                : 'Pendiente'}
            </span>
          </p>
          <p>Ticket digital generado automáticamente para tu pedido.</p>
        </div>
      </div>
    );
  }
);

VirtualTicket.displayName = 'VirtualTicket';

export default VirtualTicket;
