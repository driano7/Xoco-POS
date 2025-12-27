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

# POS — Prompt técnico para direcciones y propinas de delivery

## Flujo general
- El lector inteligente (`SmartScannerPanel` dentro de `src/components/pos-dashboard.tsx`) procesa los QR generados por `components/Orders/VirtualTicket.tsx`. El payload es un JSON con llaves compactas para mantener los QR ligeros.
- Cuando el QR corresponde a un ticket, `handleScannerPayload` invoca `buildOrderFromTicketPayload` con el objeto parseado. En esa conversión guardamos los campos relevantes en `Order.metadata`, lo cual después consume `OrderDetailContent`.

## Llaves soportadas en el QR
- `tip`: `{ "a": <monto>, "p": <porcentaje|null> }` — siempre presente cuando el cliente dejó propina en el ticket original.
- `dt`: `{ "a": <monto>, "p": <porcentaje|null> }` — sólo existe si se autorizó propina adicional para la entrega; este monto **debe sumarse al total mostrado en el POS**.
- `addr`: `<shipping_address_id>` — identificador cifrado del domicilio donde debe entregarse el pedido.
- `i`: `[ { "n": nombre, "q": cantidad, "c": categoría, "s": tamaño? } ]` — lista compacta de los artículos vendidos.
- `ts`: `dd/mm/aaaa-hh:mm` — timestamp original.
- `o`: UUID del pedido en el backend para trazabilidad/rastreo.

## Resolución del domicilio
1. Cuando `root.addr` viene definido agregamos `metadata.deliveryAddressId` en `buildOrderFromTicketPayload`.
2. Al mostrar el detalle (`OrderDetailContent`), si `metadata.deliveryAddressId` existe se dispara `loadAddressForOrder(order)`:
   ```ts
   import { decryptWithEmail } from '@/lib/address-vault';

   async function fetchAndDecryptAddress(addressId: string, email: string) {
     const response = await fetch(`/api/addresses/${addressId}`, { cache: 'no-store' });
     if (!response.ok) throw new Error('No pudimos encontrar el domicilio del cliente.');
     const encrypted = await response.json(); // incluye cipher, iv, tag y salt
     return decryptWithEmail(email, encrypted);
   }
   ```
3. El endpoint `/api/addresses/:id` responde la fila cifrada (AES-GCM). Cada fila guarda `iv`, `tag` y `salt`; `decryptWithEmail` recibe el mismo email/ID usado para cifrar (el correo del cliente que viene en el QR) y regresa un objeto `{ street, city, state, zip, references }`.
4. El resultado se muestra en el componente `OrderAddressCard` (contenedor simple que vive dentro de `OrderDetailContent`), junto con un botón para copiar el domicilio.

## Propina de delivery (`dt`)
- `buildOrderFromTicketPayload` persiste `metadata.deliveryTipAmount` y `metadata.deliveryTipPercent`.
- Al renderizar el detalle calculamos `deliveryTip = metadata.deliveryTipAmount ?? 0` y lo sumamos al total antes de mostrárselo al barista para evitar discrepancias con el ticket del cliente.
- También se despliega una “Píldora” dentro de la sección de totales indicando “Incluye propina de delivery”.

## Componentes involucrados
1. **`components/Orders/VirtualTicket.tsx`**: serializa los campos anteriores dentro del QR.
2. **`SmartScannerPanel` / `handleScannerPayload`**: leen el QR, llenan `metadata.deliveryAddressId`, `deliveryTipAmount`, `tipPercent`, etcétera.
3. **`OrderDetailContent`**: usa `metadata` para
   - Invocar `fetchAndDecryptAddress`.
   - Mostrar el domicilio mediante `OrderAddressCard`.
   - Desplegar el monto de propina de delivery dentro del bloque de totales.
4. **`lib/address-vault.ts`**: expone `decryptWithEmail(email, payload)` y utilidades para validar los IV/tag/salt almacenados por fila.

## Resumen operativo
- Cada vez que se escanea un pedido con domicilio, el POS hace **una** llamada a `/api/addresses/:id` y descifra los campos usando el email del QR. No persistimos el domicilio en el POS; únicamente lo mostramos en la vista del pedido.
- Toda la lógica se encapsula en el POS; el QR no incluye texto plano sensible.
- Las propinas (`tip` + `dt`) siempre se suman al total mostrado a los baristas, evitando que el corte de caja sea menor al que observa el cliente en la app.
