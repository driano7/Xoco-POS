## Xoco POS

Xoco POS es el panel operativo del programa de fidelidad y punto de venta para Xoco Café. Está construido sobre Next.js 14 y centraliza los flujos diarios del equipo: toma de pedidos, reservaciones, cola de producción, reportes de pago, inventario y seguimiento de clientes frecuentes.

## Propósito

- **Venta al público y clientes frecuentes**: registrar pedidos, asignarlos a clientes cifrados y moverlos a la barra de producción.
- **Visibilidad operativa**: una sola vista para monitorear órdenes, reservaciones, métricas de lealtad, inventario y actividad del personal.
- **Automatización**: sincroniza los datos con Supabase (PostgreSQL) y expone APIs serverless que estandarizan cálculos de tickets, tareas de preparación y reportes.

## Características principales

- **Dashboard unificado** (`src/components/pos-dashboard.tsx`)
  - Panel de órdenes con acciones rápidas (enviar/regresar a cola, completar pedido, etc.).
  - Búsqueda inteligente de tickets y clientes escaneando QR o introduciendo IDs manualmente.
  - Gestión de reservaciones con filtros, historial y confirmaciones.
  - Seguimiento de fidelidad: cafés acumulados, preferencias de bebida/comida y actualización inline.
  - Actividad de pagos y reportes pendientes.
  - Métricas de personal, inventario y KPIs internos.
- **Cola de producción (Prep Queue)** (`src/app/api/prep-queue`, `src/hooks/use-prep-queue.ts`)
  - Agrupa tareas por estado (pendiente, en progreso, completado).
  - Enriquecimiento con cliente, producto, cantidades, montos y asignación a baristas.
  - Acciones para marcar tareas como terminadas o reenviarlas.
- **Pedidos y tickets** (`src/app/api/orders`, `src/app/api/orders/ticket`)
  - Normaliza items, totales y propinas.
  - Genera códigos de ticket (prefijo `XL-`) y mantiene snapshots de productos.
  - Desencripta nombres/ teléfonos usando AES-GCM con pbkdf2 cuando la información está cifrada.
- **Integración con Supabase**
  - Tablas configurables via variables (ordenes, items, tickets, productos, usuarios, staff).
  - Uso del cliente administrador (`supabaseAdmin`) en los endpoints server-side.
  - Scripts auxiliares para poblar/asegurar usuarios especiales como “venta al público”.

## Tecnologías

- [Next.js 14 (App Router)](https://nextjs.org/)
- [React 18](https://react.dev/)
- [Supabase](https://supabase.com/) como backend (PostgreSQL + Auth + Storage)
- [Tailwind CSS](https://tailwindcss.com/) y estilos propios
- [TypeScript](https://www.typescriptlang.org/)

## Estructura relevante

```
src/
├─ app/
│  └─ api/                 # Endpoints serverless (orders, tickets, prep queue…)
├─ components/             # UI principal (pos-dashboard, modales, helpers)
├─ hooks/                  # Hooks para data fetching (use-prep-queue, use-orders…)
├─ lib/
│  ├─ api.ts               # Cliente fetch + tipos compartidos
│  └─ customer-decrypt.ts  # Utilidades AES-GCM para campos cifrados
```

## Requisitos previos

- Node.js 18+
- npm (o pnpm/yarn/bun) para instalar dependencias
- Proyecto de Supabase con las tablas necesarias y las variables de entorno configuradas.

Variables clave (ver `.env.local.example` o `.env.local`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ORDERS_TABLE=orders
SUPABASE_ORDER_ITEMS_TABLE=order_items
SUPABASE_PREP_QUEUE_TABLE=prep_queue
SUPABASE_PRODUCTS_TABLE=products
SUPABASE_USERS_TABLE=users
SUPABASE_PUBLIC_SALE_CLIENT_ID=AAA-1111
...
```

## Instalación y scripts

```bash
npm install        # instala dependencias
npm run dev        # entorno local (http://localhost:5173 por defecto)
npm run lint       # ejecuta ESLint
npm run build      # compila para producción
npm start          # ejecuta el build resultante
```

> Nota: el puerto puede configurarse con `next dev -p <puerto>` en `package.json`.

## Flujo de trabajo

1. El frontend consume hooks como `useOrders`, `usePrepQueue`, `useReservations`, que llaman a las APIs internas (ver `src/lib/api.ts`).
2. Las rutas en `src/app/api/**` consultan Supabase con el rol administrador, normalizan datos, aplican reglas de negocio y devuelven JSON.
3. El dashboard reacciona en tiempo real usando polling ligero y acciones optimistas (snackbars, loaders) para los eventos del staff.

## Desarrollo y contribución

- Mantén el tipado estricto de `src/lib/api.ts` para evitar regresiones en las vistas.
- Si agregas nuevas tablas o columnas, actualiza las variables de entorno y las consultas en `supabaseAdmin`.
- Ejecuta `npm run lint` antes de subir cambios.
- Documenta scripts puntuales (como el upsert de usuarios especiales) dentro de `/scripts` y elimínalos si solo se usan una vez.

## Próximos pasos sugeridos

- Integrar suscripciones en tiempo real (Supabase Realtime) para reducir polling.
- Añadir pruebas end-to-end (Playwright/Cypress) para los flujos críticos de pedidos/reservaciones.
- Automatizar los reportes PDF o notificaciones cuando cambie el estado de la cola de producción.
