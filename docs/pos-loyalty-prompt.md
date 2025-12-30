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

# POS — Prompt técnico para el programa de lealtad

## Fuente de verdad
- `users.weeklyCoffeeCount` es el contador oficial de sellos por semana; Supabase es el origen y se sincroniza al POS mediante `/api/loyalty`.
- `users.rewardEarned` indica si el cliente tiene un Americano pendiente de canje. El contador se reinicia a `0` cuando se alcanza `MAX_STAMPS` y el flag queda en `true` hasta que se confirme el canje.
- `LOYALTY_ELIGIBLE_PRODUCTS` (coma separada) define los `productId` que suman sellos. Debe coincidir con los identificadores que el POS registra al cerrar un ticket.

## Endpoints disponibles
- `GET /api/user/coffee-count?userId=... | clientId=...`
  - Recalcula la semana actual leyendo los pedidos completados desde el lunes.
  - Suma únicamente los artículos cuya `productId` esté en la lista blanca.
  - Regresa `{ weeklyCoffeeCount, rewardEarned, punches }`.
- `POST /api/user/coffee-count`
  - Acepta `{ userId | clientId | token, punches?: number }`.
  - Incrementa `weeklyCoffeeCount` hasta `MAX_STAMPS` y, al llegar al límite, marca `rewardEarned` y reinicia el contador.
- `PUT /api/user/coffee-count`
  - Resetea `weeklyCoffeeCount` y `rewardEarned` para el identificador enviado. Úsalo en el cron de los lunes o cuando el barista confirme el canje.
- `POST /api/loyalty/sync`
  - Header obligatorio: `x-loyalty-sync-key`.
  - Recorre todos los usuarios y recalcula la semana aplicando “un punch por día” si existe al menos un pedido elegible con más de 60 minutos en `completed`.
  - Consumirlo desde el POS/cron cuando detectes desincronizaciones.

## Flujo recomendado en el POS
1. **Al completar un pedido**:
   - Verifica si alguno de los `order.items` tiene `productId ∈ LOYALTY_ELIGIBLE_PRODUCTS`.
   - Si hay match, llama a `POST /api/user/coffee-count` con el `clientId`/`userId` del ticket. El endpoint regresará el contador actualizado y si el cliente ganó un Americano.
2. **Desincronización detectada**:
   - Ejecuta `POST /api/loyalty/sync` con la cabecera `x-loyalty-sync-key: <LOYALTY_SYNC_KEY>`.
   - Si sólo necesitas reparar un cliente, usa `GET /api/user/coffee-count?clientId=...`.
3. **Reset semanal**:
   - Programa un cron los lunes que recorra tus clientes y llame a `PUT /api/user/coffee-count` (o dispara una corrida global de `/api/loyalty/sync`).
4. **Visualización en el POS**:
   - `CustomerLoyaltyCoffees` recibe `count` y `rewardEarned` para mostrar los sellos y avisar cuando hay cortesía disponible.
   - Todos los módulos que consultan `/api/loyalty` (dashboard, favoritos, perfil del cliente) leen directamente `weeklyCoffeeCount`.

## Variables de entorno relevantes
- `LOYALTY_ELIGIBLE_PRODUCTS`: lista de `productId` válidos.
- `NEXT_PUBLIC_LOYALTY_TARGET` / `LOYALTY_MAX_STAMPS`: número máximo de sellos por semana (por defecto 7).
- `LOYALTY_COMPLETED_DELAY_MINUTES`: minutos que debe tener un ticket en `completed` antes de que el cron masivo lo cuente (default 60).
- `LOYALTY_SYNC_KEY`: clave compartida para proteger `/api/loyalty/sync`.
- `LOYALTY_RECALC_LIMIT`, `LOYALTY_SYNC_BATCH`, `LOYALTY_SYNC_USER_BATCH`: límites de paginación para las corridas masivas.

## Cron sugeridos
```cron
# Reset general cada lunes 06:00
0 6 * * 1 cd /Users/driano7/xocoCafe/Xoco-POS && /usr/bin/env bash -lc 'npm run sync:sqlite && curl -X PUT "http://localhost:8000/api/user/coffee-count?clientId={ID}"'

# Re-sync diario a las 11:00 (usa tu clave real)
0 11 * * * curl -H "x-loyalty-sync-key: $LOYALTY_SYNC_KEY" -X POST https://pos.xoco.mx/api/loyalty/sync
```

Adapta los ejemplos anteriores al scheduler que uses en producción y documenta la clave en tu gestor de secretos.
