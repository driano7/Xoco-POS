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

export type OrderQrItemInput = {
  name: string;
  quantity: number;
  category?: string | null;
  size?: string | null;
};

export type BuildOrderQrPayloadInput = {
  ticketCode: string;
  orderId: string;
  customerName: string;
  customerEmail?: string | null;
  customerClientId?: string | null;
  totalAmount: number;
  tipAmount: number;
  tipPercent: number | null;
  items: OrderQrItemInput[];
  shippingAddressId?: string | null;
  deliveryTipAmount?: number | null;
  deliveryTipPercent?: number | null;
  createdAt?: string | null;
};

export type CompactOrderQrPayload = {
  type: 'ticket';
  t: string;
  o: string;
  c: string;
  a: number;
  tip: {
    a: number;
    p: number | null;
  };
  i: Array<{
    n: string;
    q: number;
    c: string;
    s?: string;
  }>;
  addr?: string;
  dt?: {
    a: number;
    p: number | null;
  };
  ts: string;
  clientId?: string;
  customerId?: string;
  clientEmail?: string;
  customerName?: string;
} & Record<string, unknown>;

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const formatTicketTimestamp = (input?: string | null) => {
  const date = input ? new Date(input) : new Date();
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date();
    return `${String(fallback.getDate()).padStart(2, '0')}/${String(
      fallback.getMonth() + 1
    ).padStart(2, '0')}/${fallback.getFullYear()}-${String(fallback.getHours()).padStart(
      2,
      '0'
    )}:${String(fallback.getMinutes()).padStart(2, '0')}`;
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year}-${hours}:${minutes}`;
};

const formatCustomerField = (name: string, email?: string | null) => {
  const trimmedName = name.trim();
  const trimmedEmail = email?.trim();
  if (trimmedEmail) {
    return `${trimmedName}|${trimmedEmail}`;
  }
  return trimmedName;
};

export const buildOrderQrPayload = (input: BuildOrderQrPayloadInput): CompactOrderQrPayload => {
  const ticketCode = input.ticketCode.trim().toUpperCase();
  const mappedItems = input.items.slice(0, 25).map((item) => {
    return {
      n: item.name.trim() || 'Producto',
      q: Number.isFinite(item.quantity) && item.quantity > 0 ? Math.round(item.quantity) : 1,
      c: item.category ?? 'other',
      ...(item.size ? { s: item.size } : {}),
    };
  });

  const payload: CompactOrderQrPayload = {
    type: 'ticket',
    t: ticketCode,
    o: input.orderId,
    c: formatCustomerField(input.customerName, input.customerEmail),
    a: roundCurrency(input.totalAmount),
    tip: {
      a: roundCurrency(input.tipAmount),
      p: input.tipPercent ?? null,
    },
    i: mappedItems,
    ts: formatTicketTimestamp(input.createdAt),
  };

  if (input.shippingAddressId) {
    payload.addr = input.shippingAddressId;
  }
  if (typeof input.deliveryTipAmount === 'number' && input.deliveryTipAmount > 0) {
    payload.dt = {
      a: roundCurrency(input.deliveryTipAmount),
      p: input.deliveryTipPercent ?? null,
    };
  }
  if (input.customerClientId) {
    payload.clientId = input.customerClientId;
    payload.customerId = input.customerClientId;
  }
  if (input.customerEmail) {
    payload.clientEmail = input.customerEmail;
  }
  if (input.customerName) {
    payload.customerName = input.customerName.trim();
  }
  return payload;
};
