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

'use client';

import { forwardRef, type ReactNode } from 'react';
import type { OrderItemSummary } from '@/lib/api';

const currencyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
});

const formatCurrency = (value?: number | null) => currencyFormatter.format(value ?? 0);

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
};

interface TicketVentaProps {
  businessName?: string;
  businessAddress?: string;
  ticketCode?: string | null;
  orderNumber?: string | null;
  createdAt?: string | null;
  items: Array<
    Pick<OrderItemSummary, 'name' | 'quantity' | 'price'> & { subtotal?: number | null }
  >;
  subtotal?: number | null;
  tax?: number | null;
  total: number;
  metodoPago?: string | null;
  montoRecibido?: number | null;
  cambioEntregado?: number | null;
  footer?: ReactNode;
}

const resolveSubtotal = (
  items: TicketVentaProps['items'],
  fallback?: number | null
): number => {
  if (typeof fallback === 'number') {
    return fallback;
  }
  return items.reduce((sum, item) => sum + ((item.subtotal ?? item.price ?? 0) * (item.quantity ?? 0)), 0);
};

const TicketVenta = forwardRef<HTMLDivElement, TicketVentaProps>(function TicketVenta(
  {
    businessName = 'Xoco Café',
    businessAddress = 'Av. Principal #123 · CDMX',
    ticketCode,
    orderNumber,
    createdAt,
    items,
    subtotal,
    tax,
    total,
    metodoPago,
    montoRecibido,
    cambioEntregado,
    footer,
  },
  ref
) {
  const computedSubtotal = resolveSubtotal(items, subtotal ?? null);
  const resolvedTax = typeof tax === 'number' ? tax : 0;
  const resolvedMethod = metodoPago ? metodoPago.toUpperCase() : 'PENDIENTE';
  const showCashBand = metodoPago === 'efectivo';

  return (
    <div
      ref={ref}
      className="mx-auto w-[320px] max-w-full rounded-3xl border border-dashed border-gray-300 bg-white p-6 text-sm font-medium text-gray-900 shadow-2xl"
      style={{ fontFamily: '"Fira Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas' }}
    >
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Ticket POS</p>
        <h3 className="mt-1 text-2xl font-black tracking-[0.15em]">{businessName}</h3>
        <p className="text-xs text-gray-500">{businessAddress}</p>
        <p className="mt-1 text-xs text-gray-500">{formatDateTime(createdAt)}</p>
      </div>

      <div className="mt-4 space-y-1 text-xs">
        {ticketCode && (
          <p className="flex justify-between">
            <span className="text-gray-500">Ticket</span>
            <span className="font-semibold tracking-widest">{ticketCode}</span>
          </p>
        )}
        {orderNumber && (
          <p className="flex justify-between">
            <span className="text-gray-500">Orden</span>
            <span className="font-semibold">{orderNumber}</span>
          </p>
        )}
      </div>

      <div className="mt-4 border-y border-dashed border-gray-300 py-4">
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={`${item.name ?? 'producto'}-${index}`} className="text-xs">
              <div className="flex justify-between">
                <span className="font-semibold">{item.name ?? 'Producto'}</span>
                <span>{formatCurrency(item.price ?? 0)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-gray-500">
                <span>Cant. {item.quantity ?? 0}</span>
                <span>
                  {formatCurrency(
                    (item.subtotal ?? item.price ?? 0) * Math.max(item.quantity ?? 0, 0)
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">Subtotal</span>
          <span className="font-semibold">{formatCurrency(computedSubtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">IVA</span>
          <span className="font-semibold">{formatCurrency(resolvedTax)}</span>
        </div>
        <div className="flex justify-between text-base font-black">
          <span>Total</span>
          <span>{formatCurrency(total)}</span>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-gray-50 px-3 py-2 text-xs uppercase tracking-[0.4em] text-gray-600">
        Método: <span className="font-bold text-gray-900">{resolvedMethod}</span>
      </div>

      {showCashBand && (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
          <div className="flex justify-between">
            <span className="uppercase tracking-[0.3em] text-gray-500">Pagó con</span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(montoRecibido ?? total)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="uppercase tracking-[0.3em] text-gray-500">Su cambio</span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(cambioEntregado ?? Math.max((montoRecibido ?? total) - total, 0))}
            </span>
          </div>
        </div>
      )}

      {footer && <div className="mt-4 text-center text-xs text-gray-500">{footer}</div>}

      <p className="mt-5 text-center text-[11px] uppercase tracking-[0.4em] text-gray-400">
        Gracias por tu compra
      </p>
    </div>
  );
});

export default TicketVenta;
