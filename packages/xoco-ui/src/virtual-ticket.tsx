'use client';

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

const findNestedItemArray = (source: any): any[] | null => {
  if (!source || typeof source !== 'object') {
    return null;
  }
  const candidateKeys = ['items', 'lineItems', 'products', 'orderItems'];
  for (const key of candidateKeys) {
    if (Array.isArray(source[key])) {
      return source[key];
    }
  }
  const nestedValues = Object.values(source).filter((value) => typeof value === 'object');
  for (const value of nestedValues) {
    const nested = findNestedItemArray(value);
    if (nested) {
      return nested;
    }
  }
  return null;
};

const mapEntries = (entries: any[]): OrderItem[] =>
  entries
    .map((entry) => {
      if (typeof entry === 'string') {
        const parsed = parseTextItem(entry);
        if (parsed) return parsed;
        return null;
      }
      return buildOrderItem(entry);
    })
    .filter(Boolean) as OrderItem[];

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

const extractItemsFromSource = (source: any): OrderItem[] => {
  if (!source) {
    return [];
  }
  if (Array.isArray(source)) {
    return source.map(buildOrderItem);
  }
  const parsedSource = parseMaybeJson(source);
  if (Array.isArray(parsedSource)) {
    return parsedSource.map(buildOrderItem);
  }
  if (typeof parsedSource === 'object') {
    if (Array.isArray(parsedSource.items)) {
      return parsedSource.items.map(buildOrderItem);
    }
    if (
      Array.isArray(parsedSource.beverages) ||
      Array.isArray(parsedSource.foods) ||
      Array.isArray(parsedSource.others)
    ) {
      const beverages = Array.isArray(parsedSource.beverages) ? parsedSource.beverages : [];
      const foods = Array.isArray(parsedSource.foods) ? parsedSource.foods : [];
      const others = Array.isArray(parsedSource.others) ? parsedSource.others : [];
      return mapEntries([...beverages, ...foods, ...others]);
    }
    if (Array.isArray(parsedSource.i)) {
      return parsedSource.i.map((entry: any) => ({
        name: String(entry?.n ?? 'Producto'),
        quantity: normalizeQuantity(entry?.q),
        price: Number.isFinite(Number(entry?.p)) ? Number(entry?.p) : 0,
        category: typeof entry?.c === 'string' ? (entry.c as ItemCategory) : 'other',
        size: typeof entry?.s === 'string' ? entry.s : null,
      }));
    }
    const nested = findNestedItemArray(parsedSource);
    if (nested) {
      return mapEntries(nested);
    }
  }
  return [];
};

const VirtualTicket = forwardRef<HTMLDivElement, VirtualTicketProps>(
  ({ order, showQr = true, orderStatus }, ref) => {
    const items = useMemo<OrderItem[]>(() => {
      const fromOrder = extractItemsFromSource(order.items);
      if (fromOrder.length > 0) {
        return fromOrder;
      }
      if (order.qrPayload) {
        const parsedQr = parseMaybeJson(order.qrPayload) ?? order.qrPayload;
        const fromQr = extractItemsFromSource(parsedQr);
        if (fromQr.length > 0) {
          return fromQr;
        }
      }
      return [];
    }, [order.items, order.qrPayload]);

    const groupedItems = useMemo(() => {
      const groups: Record<ItemCategory, OrderItem[]> = {
        beverage: [],
        food: [],
        package: [],
        other: [],
      };
      items.forEach((item) => {
        groups[item.category ?? 'other'].push(item);
      });
      return groups;
    }, [items]);
    const categoryOrder: ItemCategory[] = ['beverage', 'food', 'package', 'other'];

    const normalizedStatus = useMemo(
      () => orderStatus ?? order.status ?? null,
      [order.status, orderStatus]
    );
    const thankYouHeadline =
      normalizedStatus === 'pending' ? 'Gracias por su pedido' : 'Gracias por su compra';
    const isDelivered = normalizedStatus === 'completed';

    const formatCurrency = (value?: number | null) =>
      new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
      }).format(value ?? 0);

    const tipAmount = useMemo(() => {
      if (typeof order.tipAmount === 'number') {
        return order.tipAmount;
      }
      if (
        order.items &&
        typeof order.items === 'object' &&
        (order.items as any)?.totals &&
        typeof (order.items as any).totals.tip === 'number'
      ) {
        return (order.items as any).totals.tip;
      }
      return 0;
    }, [order.items, order.tipAmount]);

    const tipPercent = useMemo(() => {
      if (typeof order.tipPercent === 'number') {
        return order.tipPercent;
      }
      if (
        order.items &&
        typeof order.items === 'object' &&
        (order.items as any)?.totals &&
        typeof (order.items as any).totals.tipPercent === 'number'
      ) {
        return (order.items as any).totals.tipPercent;
      }
      if (typeof order.total === 'number' && order.total > 0 && tipAmount > 0) {
        const subtotal = order.total - tipAmount;
        if (subtotal > 0) {
          return Math.round((tipAmount / subtotal) * 100);
        }
      }
      return null;
    }, [order.items, order.tipPercent, order.total, tipAmount]);

    const totalsSnapshot = useMemo(() => {
      if (order.items && typeof order.items === 'object' && (order.items as any)?.totals) {
        return (order.items as any).totals;
      }
      return null;
    }, [order.items]);

    const summary = useMemo(() => summarizeItems(items), [items]);
    const packageDetails = useMemo(
      () =>
        items
          .filter((item) => item.category === 'package')
          .map((item) => ({
            name: item.name,
            quantity: item.quantity,
            contents: item.packageItems ?? [],
          })),
      [items]
    );

    const deliveryTipAmount = useMemo(() => {
      if (typeof order.deliveryTipAmount === 'number') {
        return Math.max(order.deliveryTipAmount, 0);
      }
      if (
        order.shipping?.deliveryTip &&
        typeof order.shipping.deliveryTip.amount === 'number' &&
        order.shipping.deliveryTip.amount > 0
      ) {
        return order.shipping.deliveryTip.amount;
      }
      if (
        order.items &&
        typeof order.items === 'object' &&
        (order.items as any)?.deliveryTip &&
        typeof (order.items as any).deliveryTip.amount === 'number'
      ) {
        return (order.items as any).deliveryTip.amount;
      }
      if (totalsSnapshot && typeof totalsSnapshot.deliveryTip === 'number') {
        return totalsSnapshot.deliveryTip;
      }
      return 0;
    }, [order.deliveryTipAmount, order.items, order.shipping?.deliveryTip, totalsSnapshot]);

    const deliveryTipPercent = useMemo(() => {
      if (typeof order.deliveryTipPercent === 'number') {
        return order.deliveryTipPercent;
      }
      if (order.shipping?.deliveryTip && typeof order.shipping.deliveryTip.percent === 'number') {
        return order.shipping.deliveryTip.percent;
      }
      if (
        order.items &&
        typeof order.items === 'object' &&
        (order.items as any)?.deliveryTip &&
        typeof (order.items as any).deliveryTip.percent === 'number'
      ) {
        return (order.items as any).deliveryTip.percent;
      }
      return null;
    }, [order.deliveryTipPercent, order.items, order.shipping?.deliveryTip]);

    const lineItemsTotal = useMemo(
      () => items.reduce((total, item) => total + item.price * item.quantity, 0),
      [items]
    );

    const totalWithVatBeforeTips = useMemo(() => {
      if (typeof order.total === 'number') {
        return Math.max(order.total - tipAmount - deliveryTipAmount, 0);
      }
      return Math.max(lineItemsTotal, 0);
    }, [deliveryTipAmount, lineItemsTotal, order.total, tipAmount]);

    const totalWithoutTips = totalWithVatBeforeTips;

    const explicitSubtotal =
      typeof order.subtotal === 'number'
        ? order.subtotal
        : typeof totalsSnapshot?.subtotal === 'number'
        ? totalsSnapshot.subtotal
        : null;
    const explicitVatAmount =
      typeof order.vatAmount === 'number'
        ? order.vatAmount
        : typeof totalsSnapshot?.vat === 'number'
        ? totalsSnapshot.vat
        : null;
    const derivedVatPercent =
      typeof order.vatPercent === 'number'
        ? order.vatPercent
        : typeof totalsSnapshot?.vatPercent === 'number'
        ? totalsSnapshot.vatPercent
        : 16;

    const subtotalBeforeVat = useMemo(() => {
      if (typeof explicitSubtotal === 'number') {
        return Math.max(explicitSubtotal, 0);
      }
      if (typeof explicitVatAmount === 'number') {
        return Math.max(totalWithoutTips - explicitVatAmount, 0);
      }
      const vatFactor = (derivedVatPercent ?? 0) / 100;
      if (vatFactor > 0 && totalWithoutTips > 0) {
        return Math.max(totalWithoutTips / (1 + vatFactor), 0);
      }
      return Math.max(totalWithoutTips, 0);
    }, [derivedVatPercent, explicitSubtotal, explicitVatAmount, totalWithoutTips]);

    const vatAmount = useMemo(() => {
      if (typeof explicitVatAmount === 'number') {
        return Math.max(explicitVatAmount, 0);
      }
      return Math.max(totalWithoutTips - subtotalBeforeVat, 0);
    }, [explicitVatAmount, subtotalBeforeVat, totalWithoutTips]);

    const grandTotal = useMemo(() => {
      if (typeof order.total === 'number') {
        return order.total;
      }
      return totalWithVatBeforeTips + tipAmount + deliveryTipAmount;
    }, [deliveryTipAmount, order.total, tipAmount, totalWithVatBeforeTips]);

    const qrPayloadValue = useMemo(() => {
      return buildOrderQrPayload({
        ticketCode: order.ticketId ?? order.orderNumber ?? order.id,
        orderId: order.id,
        customerName: (order.customerName ?? order.userEmail ?? 'Cliente Xoco Café').trim(),
        customerEmail: order.userEmail ?? null,
        customerClientId: order.posCustomerId ?? null,
        totalAmount: grandTotal,
        tipAmount,
        tipPercent: tipPercent ?? null,
        items: items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          category: item.category,
          size: item.size ?? null,
        })),
        shippingAddressId: order.shipping?.addressId ?? null,
        deliveryTipAmount: deliveryTipAmount > 0 ? deliveryTipAmount : null,
        deliveryTipPercent: deliveryTipPercent ?? null,
        createdAt: order.createdAt ?? null,
      });
    }, [
      deliveryTipAmount,
      deliveryTipPercent,
      grandTotal,
      items,
      order.createdAt,
      order.customerName,
      order.id,
      order.orderNumber,
      order.posCustomerId,
      order.shipping?.addressId,
      order.ticketId,
      order.userEmail,
      tipAmount,
      tipPercent,
    ]);

    const qrValue = useMemo(() => JSON.stringify(qrPayloadValue), [qrPayloadValue]);

    const qrRequestUrl = useMemo(() => {
      return `${QR_API_URL}?size=${QR_IMAGE_SIZE}&data=${encodeURIComponent(qrValue)}`;
    }, [qrValue]);

    return (
      <div
        ref={ref}
        className="w-[360px] rounded-3xl border border-dashed border-primary-200 bg-white p-5 text-sm text-gray-800 shadow-2xl"
      >
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-primary-500">Xoco Café</p>
          <h3 className="mt-2 text-xl font-semibold text-gray-900">Ticket de pedido</h3>
          <p className="text-xs text-gray-500">
            {order.createdAt ? new Date(order.createdAt).toLocaleString('es-MX') : ''}
          </p>
          <p className="text-[11px] text-gray-500">{FISCAL_ADDRESS}</p>
          <p className="mt-1 text-xs font-medium text-gray-600">
            Cliente: {(order.customerName ?? order.userEmail ?? 'Público general').trim()}
          </p>
        </div>

        <div className="mt-4 flex justify-between text-xs">
          <div>
            <p className="text-gray-500">Ticket</p>
            <p className="font-semibold">{order.ticketId ?? order.orderNumber ?? order.id}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-500">Canal</p>
            <p className="font-semibold uppercase">
              {(() => {
                const code = (order.ticketId ?? order.orderNumber ?? '').toUpperCase();
                if (code.startsWith('C-')) return 'Cliente';
                if (code.startsWith('XL-')) return 'Xoco';
                return (order.type ?? 'web').toUpperCase();
              })()}
            </p>
          </div>
        </div>

        <div className="my-3 border-t border-dashed border-gray-200" />

        <div className="space-y-4">
          {items.length === 0 ? (
            <p className="text-sm text-gray-500">Sin artículos registrados.</p>
          ) : (
            categoryOrder.map((category) => {
              const list = groupedItems[category];
              if (!list.length) return null;
              return (
                <div key={category}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-primary-500">
                    {CATEGORY_LABELS[category]}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {list.map((item, index) => (
                      <li key={`${category}-${item.name}-${index}`} className="text-sm">
                        <div className="flex justify-between">
                          <span>
                            {item.quantity} × {item.name}
                            {item.size ? (
                              <span className="ml-1 text-xs uppercase text-gray-500">
                                ({item.size})
                              </span>
                            ) : null}
                          </span>
                          <span className="font-semibold">
                            {formatCurrency(item.price * item.quantity)}
                          </span>
                        </div>
                        {item.category === 'package' && item.packageItems?.length ? (
                          <p className="text-xs text-gray-500">
                            Incluye: {item.packageItems.join(', ')}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        {(() => {
          const address = order.shipping?.address;
          const hasAddressDetails =
            !!address &&
            [address.street, address.city, address.state, address.postalCode, address.reference]
              .filter((value) => typeof value === 'string')
              .some((value) => Boolean((value as string).trim().length));
          const contactPhone = order.shipping?.contactPhone?.trim();
          if (!hasAddressDetails) {
            return null;
          }
          return (
            <div className="mt-4 rounded-2xl border border-dashed border-primary-100 bg-primary-50/40 p-3 text-xs text-primary-900">
              <p className="font-semibold uppercase tracking-[0.35em] text-[10px] text-primary-600">
                Entrega
              </p>
              <p className="mt-1">
                {address?.street}
                {address?.city ? `, ${address.city}` : ''}
                {address?.state ? `, ${address.state}` : ''}
                {address?.postalCode ? ` · CP ${address.postalCode}` : ''}
              </p>
              {address?.reference && (
                <p className="text-[11px] text-primary-700">Referencia: {address.reference}</p>
              )}
              {contactPhone && (
                <p className="mt-1 text-[11px] font-medium">
                  Contacto: {contactPhone} {order.shipping?.isWhatsapp ? '(WhatsApp)' : ''}
                </p>
              )}
            </div>
          );
        })()}

        {summary.total > 0 && <TicketOrderSummary stats={summary} packages={packageDetails} />}

        <div className="my-3 border-t border-dashed border-gray-200" />

        <div className="space-y-1 text-sm text-gray-600">
          <div className="flex items-center justify-between">
            <span>Subtotal (sin IVA)</span>
            <span className="font-semibold text-gray-900">{formatCurrency(subtotalBeforeVat)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>
              IVA ({Number.isFinite(derivedVatPercent) ? Number(derivedVatPercent).toFixed(2) : '0'}%)
            </span>
            <span className="font-semibold text-gray-900">{formatCurrency(vatAmount)}</span>
          </div>
          <div className="flex items-center justify-between text-base font-semibold text-gray-900">
            <span>Total con IVA</span>
            <span>{formatCurrency(totalWithoutTips)}</span>
          </div>
        </div>

        <div className="my-3 border-t border-dashed border-gray-200" />

        <div className="flex items-center justify-between text-sm text-gray-600">
          <span className="flex items-center gap-2">
            {typeof tipPercent === 'number' && tipPercent > 0 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-900">
                {tipPercent}%
              </span>
            )}
            <span>Propina</span>
          </span>
          <span className="font-semibold text-gray-900">{formatCurrency(tipAmount)}</span>
        </div>

        <div className="my-3 border-t border-dashed border-gray-200" />

        <div className="flex items-center justify-between text-base font-semibold text-gray-900">
          <span>Total general</span>
          <span>{formatCurrency(grandTotal)}</span>
        </div>
        {showQr && (
          <div className="mt-4 flex flex-col items-center space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary-600">
              {thankYouHeadline}
            </p>
            {isDelivered && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-600">
                Pedido pagado y entregado
              </p>
            )}
            <Image
              src={qrRequestUrl}
              alt="Código QR del ticket"
              width={176}
              height={176}
              className="h-44 w-44 rounded-2xl border border-gray-200 bg-white p-2"
              unoptimized
              crossOrigin="anonymous"
              priority
              loading="eager"
            />
            <p className="text-center text-xs text-gray-500">
              Escanea este código para facilitar la entrega.
            </p>
            <p className="text-center text-[11px] text-gray-500">
              Este documento no es un comprobante fiscal.
            </p>
          </div>
        )}
      </div>
    );
  }
);

VirtualTicket.displayName = 'VirtualTicket';

export default VirtualTicket;
