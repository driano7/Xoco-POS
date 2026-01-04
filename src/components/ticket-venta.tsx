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

import type { ReactNode } from 'react';

type TicketProduct = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  note?: string | null;
};

export type TicketVentaProps = {
  businessName: string;
  fecha: Date | string;
  products: TicketProduct[];
  subtotal: number;
  iva: number;
  total: number;
  metodoPago: 'efectivo' | 'tarjeta' | 'transferencia';
  montoRecibido?: number | null;
  cambio?: number | null;
  footer?: ReactNode;
};

const currency = (value: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);

export function TicketVenta({
  businessName,
  fecha,
  products,
  subtotal,
  iva,
  total,
  metodoPago,
  montoRecibido,
  cambio,
  footer,
}: TicketVentaProps) {
  const formattedDate =
    typeof fecha === 'string'
      ? new Date(fecha).toLocaleString('es-MX')
      : fecha.toLocaleString('es-MX');
  const isCash = metodoPago === 'efectivo';

  return (
    <article className="mx-auto w-[320px] rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-6 font-mono text-[13px] text-slate-900 shadow-sm print:w-[80mm] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
          Ticket POS · Xoco Café
        </p>
        <h1 className="mt-1 text-xl font-semibold">{businessName}</h1>
        <p className="mt-2 text-xs">{formattedDate}</p>
      </header>

      <div className="mt-4 border-t border-dotted border-slate-300 pt-4" aria-label="Detalle de productos">
        <ul className="space-y-3">
          {products.map((item) => (
            <li key={item.id}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{item.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {item.quantity} × {currency(item.price)}
                  </p>
                </div>
                <span className="font-semibold">{currency(item.quantity * item.price)}</span>
              </div>
              {item.note ? <p className="text-[11px] text-slate-500">Nota: {item.note}</p> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 space-y-1 border-t border-dotted border-slate-300 pt-4 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{currency(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>IVA</span>
          <span>{currency(iva)}</span>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <span>Total</span>
          <span>{currency(total)}</span>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
        <div className="flex justify-between">
          <span>Método</span>
          <span className="uppercase">{metodoPago}</span>
        </div>
        {isCash && (
          <div className="mt-3 space-y-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-inner dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
            <div className="flex justify-between">
              <span>EFECTIVO</span>
              <span>{currency(total)}</span>
            </div>
            <div className="flex justify-between">
              <span>PAGÓ CON</span>
              <span>{currency(montoRecibido ?? total)}</span>
            </div>
            <div className="flex justify-between text-base">
              <span>SU CAMBIO</span>
              <span>{currency(Math.max(cambio ?? (montoRecibido ?? total) - total, 0))}</span>
            </div>
          </div>
        )}
      </div>

      <footer className="mt-5 text-center text-[11px] text-slate-500">
        {footer ?? 'Gracias por tu compra · Conserva este ticket para cualquier aclaración.'}
      </footer>
    </article>
  );
}
