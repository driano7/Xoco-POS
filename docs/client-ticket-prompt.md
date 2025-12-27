<!--
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
 -->

# Client App Ticket Status Prompt

### Objetivo
Mostrar en la app de clientes quién tomó el pedido, qué método de pago se usó y la referencia asociada cuando el ticket ya está en “En preparación”.

### API a consultar
```
GET /api/orders/ticket/:identifier
```

- `:identifier` puede ser el `ticketCode`, `orderId` o el código QR leído.
- La respuesta incluye `ticket` y `order` con los nuevos campos:

| Campo | Descripción |
| --- | --- |
| `ticket.paymentMethod` | Método de pago normalizado (`debito`, `credito`, etc.). |
| `ticket.paymentReference` | Referencia capturada (folio, ENS, 0x, Lightning). |
| `ticket.paymentReferenceType` | Tipo inferido (`evm_address`, `ens_name`, `lightning_invoice`, etc.). |
| `ticket.handledByStaffName` / `ticket.handledByStaffId` | Persona que movió el pedido a preparación. |
| `order.queuedPaymentMethod` / `order.queuedPaymentReference` / `order.queuedPaymentReferenceType` | Copia de seguridad en el payload del pedido. |
| `order.queuedByStaffName` / `order.queuedByStaffId` | También disponibles desde el pedido. |

### Prompt técnico sugerido
1. Leer el ticket con `GET /api/orders/ticket/:identifier`.
2. Mostrar:
   - “Atendido por” → `ticket.handledByStaffName ?? order.queuedByStaffName ?? abreviar(ticket.handledByStaffId) ?? 'Pendiente'`. En la app cliente solemos mostrar sólo el primer nombre o el alias definido por el POS.
   - “Método” → usar el label en la app según `ticket.paymentMethod`.
   - “Referencia” → `ticket.paymentReference` con un badge usando `ticket.paymentReferenceType`.
3. Si no existe `ticket.handledByStaffName`, mostrar un estado vacío (“Aún no se asigna”).

### Componente de ejemplo (React)
```tsx
type TicketAssignmentProps = {
  ticket: {
    handledByStaffName?: string | null;
    handledByStaffId?: string | null;
    paymentMethod?: string | null;
    paymentReference?: string | null;
    paymentReferenceType?: string | null;
  };
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  cripto: 'Cripto',
};

const PAYMENT_REFERENCE_TYPE_LABELS: Record<string, string> = {
  evm_address: 'Wallet 0x',
  ens_name: 'ENS',
  lightning_invoice: 'Lightning',
  transaction_id: 'Transferencia',
  text: 'Referencia',
};

export function TicketAssignmentNotice({ ticket }: TicketAssignmentProps) {
  const handler = ticket.handledByStaffName ?? ticket.handledByStaffId ?? 'Pendiente por asignar';
  const methodLabel =
    (ticket.paymentMethod && PAYMENT_METHOD_LABELS[ticket.paymentMethod]) ||
    ticket.paymentMethod ||
    'Sin método';
  const referenceLabel =
    ticket.paymentReferenceType && PAYMENT_REFERENCE_TYPE_LABELS[ticket.paymentReferenceType];

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold text-xs uppercase tracking-[0.3em]">En preparación</p>
      <p className="mt-2">
        <span className="font-semibold">Atendió: </span>
        {handler}
      </p>
      <p>
        <span className="font-semibold">Método: </span>
        {methodLabel}
      </p>
      {ticket.paymentReference ? (
        <p className="mt-1 text-xs">
          <span className="font-semibold">Referencia:</span> {ticket.paymentReference}{' '}
          {referenceLabel && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-[2px] text-[10px] uppercase tracking-[0.2em]">
              {referenceLabel}
            </span>
          )}
        </p>
      ) : (
        <p className="mt-1 text-xs text-amber-700">Sin referencia capturada.</p>
      )}
    </section>
  );
}
```

Integra este componente dentro de la vista del historial de tickets de la app de clientes usando los datos obtenidos del endpoint anterior.*** End Patch
