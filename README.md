<div align="center">
  <img src="https://raw.githubusercontent.com/driano7/XocoCafe/main/public/static/images/XocoBanner.png" width="200" alt="Logo Xoco Café"/>
</div>

<h1 align="center">Xoco POS — Sistema de Punto de Venta</h1>

<p align="center">
  <i>Ventas • Inventario • Flujo de Preparación • Operación Interna</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/licencia-Apache%202.0-brown.svg" />
  <img src="https://img.shields.io/badge/estado-En%20Desarrollo-yellow.svg" />
  <img src="https://img.shields.io/badge/framework-React%20%2B%20Node.js-blue.svg" />
  <img src="https://img.shields.io/badge/empresa-Xoco%20Café-orange.svg" />
</p>

---

# 🌱 Descripción General  
**Xoco POS** es el sistema oficial de Punto de Venta diseñado para las operaciones internas de Xoco Café.  
Administra ventas, flujo de preparación, control de inventario y coordinación del staff.  

Algunas ideas de interfaz y conceptos del punto de venta fueron inspirados en el proyecto open-source **Frappe Books**:  
https://github.com/frappe/books.  

El sistema ha sido adaptado, rediseñado y programado específicamente para Xoco Café.

---

# ⭐ Funciones Principales  

1. **Procesamiento de Ventas.** Interfaz rápida e intuitiva para registrar pedidos.  
2. **Flujo de Preparación.** Actualizaciones en tiempo real para baristas y staff.  
3. **Inventario y Consumo.** Registro de ingredientes, niveles de stock y alertas.  
4. **Gestión de Usuarios.** Roles de Administrador, Barista y Cajero.  
5. **Reportes y Métricas.** Ventas, historial y análisis de desempeño.  
6. **Diseño Multiplataforma.** Funcionamiento en tableta, touchscreen y escritorio.  
7. **Programa de Lealtad.** Control automático de sellos (7 cafés), canje sin costo y bloqueo de beneficios para ventas de público general (`AAA-1111`).  

---

# 🧱 Componentes del Sistema  

## 💸 Operación POS  
- Interfaz de caja para ventas y tickets.  
- Catálogo de productos con categorías y modificadores.  
- Cálculo automático de impuestos.  
- Múltiples métodos de pago.  

## 🍽️ Flujo de Preparación  
- Tablero de órdenes en tiempo real.  
- Enrutamiento automático por categoría.  
- Tiempos de preparación y estado por pedido.  

## 📦 Inventario  
- Consumo por ingrediente y receta.  
- Alertas de bajo inventario.  
- Referencia de proveedores y costos.  

## 👥 Roles de Usuario  
- Administrador, Barista, Cajero.  
- Permisos por módulo o acción.  

## 🛡️ Panel COFEPRIS (ES/EN)  
- **ES:** Se agregó una pestaña exclusiva dentro del dashboard POS dedicada al cumplimiento sanitario COFEPRIS (Comisión Federal para la Protección contra Riesgos Sanitarios). Permite que baristas y gerentes registren higiene por área, control de plagas, manejo de inventario alimentario y bitácoras de residuos con filtros por mes y exportaciones a CSV/Excel del mes actual o previos.  
- **EN:** Added a dedicated COFEPRIS compliance tab (COFEPRIS is Mexico’s federal sanitary authority) so staff can review hygiene logs, pest control certificates, smart inventory for food handling, and waste logs. The panel includes a monthly filter plus CSV/XLSX exports that gather all COFEPRIS records for the selected period.  
- Acceso habilitado para roles Barista y Gerente directamente desde la navegación principal del POS.  

## 🚀 Actualizaciones recientes (ES/EN)
- **ES:** El módulo que mueve pedidos a preparación ahora valida el método de pago: efectivo exige monto y cambio; tarjetas, transferencias y cripto requieren referencia antes de encolar.  
  **EN:** Moving an order into prep now enforces payment requirements: cash needs tendered amount plus change, card/transfer/crypto must include a reference before the queue accepts it.
- **ES:** El endpoint `/api/customers/addresses` descifra y normaliza direcciones, teléfonos y propinas de entrega para auto llenar pedidos nuevos o mostrar detalles históricos.  
  **EN:** `/api/customers/addresses` decrypts and normalizes shipping data so the POS can auto-fill saved addresses and delivery tips for each customer.
- **ES:** Las órdenes almacenan y muestran dirección de envío, teléfono, indicador de WhatsApp y propina de entrega en los paneles de detalle y tickets virtuales.  
  **EN:** Orders now surface shipping address, contact phone, WhatsApp flag, and delivery tip inside the POS detail/ticket views.
- **ES:** El resumen de cobro en POS resume referencias según el método (últimos 4 dígitos, ENS, hash abreviado) y muestra efectivo recibido/cambio entregado.  
  **EN:** Payment summaries adapt to the method (masked last digits, ENS/wallet previews, or cash received/change) for quick verification.
- **ES:** Las banderas manuales de stock bajo/agotado se reflejan en el selector de productos y bloquean la selección cuando el artículo está fuera de stock.  
  **EN:** Manual low/out-of-stock flags propagate to dropdowns so unavailable products show badges or become unselectable.
- **ES:** Las pestañas de métricas, COFEPRIS y empleados integran el nuevo botón de gráficas con exportación PNG para análisis rápidos.  
  **EN:** Metrics, COFEPRIS, and staff tabs include the reusable chart modal with PNG export for quick sharing.  
- **ES:** Se unificó el transportador SMTP/Brevo del POS para reset de contraseña, pedidos entregados, reservaciones y opt-in de marketing. Define `SMTP_HOST/PORT/USER/PASS/SECURE`, opcionalmente `SMTP_FROM`, y credenciales `NOTIFY_API_KEY`, `PROMO_ADMIN_KEY` y `BREVO_RESET_TEMPLATE_ID` para habilitar `/api/notifications/email/*` y `/api/promotions/*`.  
  **EN:** The POS now shares the same SMTP/Brevo helper for password resets, order-delivered notices, reservations, and marketing opt-ins. Configure `SMTP_HOST/PORT/USER/PASS/SECURE`, optional `SMTP_FROM`, plus `NOTIFY_API_KEY`, `PROMO_ADMIN_KEY`, and `BREVO_RESET_TEMPLATE_ID` to use the new `/api/notifications/email/*` and `/api/promotions/*` endpoints.  
- **ES:** El ticket digital del panel de pedidos ahora puede descargarse como PDF o PNG; al compartir desde el POS se solicita el formato preferido para adjuntar el archivo correcto.  
  **EN:** Order tickets inside the POS detail view can now be exported as PDF or PNG, and when sharing the POS asks which format you prefer before attaching the file.  

## ✉️ Notificaciones y promociones (ES/EN)
- **ES:** Se añadieron los endpoints `/api/notifications/email/order-delivered` y `/api/notifications/email/reservation-created`. Ambos usan el mismo helper SMTP/Brevo y aceptan encabezado `x-xoco-notify-key` (`NOTIFY_API_KEY` en el servidor) más el payload JSON documentado en el código. Puedes reutilizarlos desde el POS, tu backend administrativo o una automatización externa para disparar correos de pedidos entregados y reservaciones creadas.  
- **EN:** New transactional endpoints `/api/notifications/email/order-delivered` and `/api/notifications/email/reservation-created` reuse the SMTP/Brevo helper. Send `x-xoco-notify-key` (`NOTIFY_API_KEY` in env) plus the documented JSON payload to trigger order-delivered or reservation-created emails from the POS, your admin backend, or any automation.

- **ES:** `/api/promotions/manage` y `/api/promotions/redeem` ya están disponibles para POS y app cliente. Define `PROMO_ADMIN_KEY`, envía ese valor en `x-xoco-promo-key` para crear/editar códigos (campos validados por Zod) y usa el token JWT de los clientes para redimir códigos que respetan límites globales y por usuario. Las tablas `promo_codes` y `promo_redemptions` viven tanto en Supabase como en la réplica SQLite (`schema.sqlite.sql`).  
- **EN:** The POS exposes `/api/promotions/manage` and `/api/promotions/redeem`. Protect management calls with `x-xoco-promo-key: ${PROMO_ADMIN_KEY}` and rely on JWT-authenticated requests to redeem codes. Business rules (validity windows, limits, metadata) are enforced on both endpoints, and the new `promo_codes` / `promo_redemptions` tables are mirrored in Supabase and SQLite.

---

# 💻 Tecnologías  

Tecnología | Función  
---------- | --------  
React.js | Framework principal de la interfaz.  
Node.js / Express | API y lógica de negocio.  
Firebase / MongoDB | Base de datos y autenticación.  
Netlify / Vercel | Plataforma de despliegue.  
Tailwind / Styled Components | Estilos de la interfaz.  
PWA | Compatibilidad con tabletas y móviles.  

---

# 🔁 Migración & Inspiración  

Algunos patrones de interfaz y conceptos fueron **referenciados y adaptados** del proyecto:  
➡️ https://github.com/frappe/books.  

Todo el código del sistema POS ha sido **reimplementado**, reestructurado o adaptado por **Donovan Riaño** para ajustarse al ecosistema de Xoco Café.

---

# 📚 Documentación técnica

- [Guía para sincronizar tablas Supabase ↔ SQLite](docs/sync-guide.md) — pasos para extender el dataset offline del POS y consumirlo desde los endpoints.
- `docs/client-ticket-prompt.md`, `docs/pos-address-prompt.md` — prompts técnicos listos para integraciones específicas de la app cliente.
- `schema.sqlite.sql` — copia lista del esquema simplificado (SQLite) para regenerar `local.db` desde este repo.

---

# ✒️ Créditos  

## Equipo Fundador  
- Sergio Cortés.  
- Alejandro Galván.  
- **Donovan Riaño.**  
- Juan Aragón.  

## Desarrollo  
- **Desarrollador Principal:** *Donovan Riaño.*  
- Funcionalidades del POS adaptadas exclusivamente para la operación interna de Xoco Café.  
- Algunas tareas fueron asistidas con IA (Codex), con verificación manual.  

---

# 📜 Licencia — Apache License 2.0  

El sistema Xoco POS es **propiedad intelectual de Xoco Café**.  
Todo el código y arquitectura fueron desarrollados por:  
**Donovan Riaño (Desarrollador Principal).**

Bajo la licencia Apache 2.0:

- Debe mantenerse la atribución a **Xoco Café**.  
- Debe preservarse el crédito a **Donovan Riaño**.  
- La redistribución debe incluir esta licencia.  
- Se aplican derechos y protecciones de patente.  
- Cualquier modificación debe documentarse.  

Revisa el archivo `LICENSE` para los términos legales completos.

---

# 🧾 Encabezados de Licencia por Tipo de Archivo

Incluye el encabezado correspondiente cuando crees o modifiques archivos en este repositorio:

### Archivos JS / TS / TSX / JSX / Configuración

```ts
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
```

### Archivos CSS / SCSS / Tailwind

```css
/*
 * --------------------------------------------------------------------
 *  Xoco POS — Styling
 *  Part of the Xoco POS — Point of Sale System.
 *  Software Property of Xoco Café.
 *  Copyright (c) 2025 Xoco Café.
 *  Principal Developer: Donovan Riaño.
 *
 *  Licensed under the Apache License, Version 2.0.
 *  See the LICENSE file in the project root for full details.
 *
 *  PROPIEDAD DEL SOFTWARE — XOCO CAFÉ.
 *  Este archivo de estilos forma parte del sistema Xoco POS.
 * --------------------------------------------------------------------
 */
```

### Archivos HTML

```html
<!--
  --------------------------------------------------------------------
  Xoco POS — Point of Sale System.
  Software Property of Xoco Café.
  Copyright (c) 2025 Xoco Café.
  Principal Developer: Donovan Riaño.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at:
      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

  --------------------------------------------------------------------
  PROPIEDAD DEL SOFTWARE — XOCO CAFÉ.
  Sistema Xoco POS — Punto de Venta.
  Desarrollador Principal: Donovan Riaño.
  Consulta el archivo LICENSE en la raíz del proyecto para más detalles.
  --------------------------------------------------------------------
-->
```

---

<div align="center">
  <img src="https://raw.githubusercontent.com/driano7/XocoCafe/main/public/static/images/XocoBanner.png" width="200" alt="Xoco Café Logo"/>
</div>

<h1 align="center">Xoco POS — Point of Sale System</h1>

<p align="center">
  <i>Integrated Sales • Inventory • Workflow • Operations</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache%202.0-brown.svg" />
  <img src="https://img.shields.io/badge/status-In%20Development-yellow.svg" />
  <img src="https://img.shields.io/badge/framework-React%20%2B%20Node.js-blue.svg" />
  <img src="https://img.shields.io/badge/company-Xoco%20Café-orange.svg" />
</p>

---

# 🌱 Overview  
**Xoco POS** is the official Point of Sale system developed for Xoco Café’s internal operations.  
It manages sales, order flow, inventory tracking, and real-time staff coordination.  
Some POS-related concepts and interface ideas were inspired by the open-source project **Frappe Books**:  
https://github.com/frappe/books.  

The system is adapted, redesigned, and reimplemented specifically for Xoco Café.

---

# ⭐ Core Features  

1. **Sales Processing.** Fast and intuitive order creation interface.  
2. **Order Workflow.** Real-time updates for baristas and staff.  
3. **Inventory & Consumption Tracking.** Stock levels, usage logs, and alerts.  
4. **User Management.** Role-based permissions for Admin, Barista, and Cashier.  
5. **Analytics & Reporting.** Sales metrics and historical performance data.  
6. **Cross-Platform Interface.** Optimized for tablets, touchscreens, and desktop use.  
7. **Loyalty Program.** Seven-stamp tracking with automatic free drink rewards and enforced exclusion for walk-in/public sales (`AAA-1111`).  

---

# 🧱 System Components  

## 💸 POS Operations  
- Cashier interface for orders and receipts.  
- Product catalog with categories and modifiers.  
- Automated tax calculations.  
- Multiple payment method support.  

## 🍽️ Preparation Flow  
- Real-time order board for baristas.  
- Automatic routing by drink or food category.  
- Timers and preparation status tracking.  

## 📦 Inventory Management  
- Ingredient consumption tracking per order.  
- Low-stock alerts.  
- Supplier reference and cost data.  

## 👥 User & Role System  
- Admin, Barista, Cashier roles.  
- Permissions assigned per action or module.  

---

# 💻 Technology Stack  

Technology | Purpose  
---------- | --------  
React.js | Main user interface framework.  
Node.js / Express | Backend logic and API routing.  
Firebase / MongoDB | Database and authentication layer.  
Netlify / Vercel | Deployment platform.  
Tailwind CSS / Styled Components | Styling system.  
PWA Support | Mobile/tablet-friendly capabilities.  

---

# 🔁 Migration & Source Inspiration  

Some interface patterns and conceptual approaches were **referenced and adapted** from:  
➡️ https://github.com/frappe/books.  

All code in Xoco POS is **newly implemented**, restructured, or rewritten by **Donovan Riaño** to fit the Xoco Café ecosystem.

---

# ✒️ Credits  

## Founding Team  
- Sergio Cortés.  
- Alejandro Galván.  
- **Donovan Riaño.**  
- Juan Aragón.  

## Development  
- **Principal Developer:** *Donovan Riaño.*  
- POS functionalities adapted specifically for operational needs at Xoco Café.  
- Certain development tasks assisted using AI (Codex), with full manual review and modifications.  

---

# 📜 License — Apache License 2.0  

The Xoco POS system is the **intellectual property of Xoco Café**.  
All code and system architecture were developed by:  
**Donovan Riaño (Principal Developer).**

Under the Apache 2.0 License:

- Attribution to **Xoco Café** is required.  
- Credit to **Donovan Riaño** must be maintained.  
- Software redistribution must include the Apache 2.0 license.  
- Patent protections apply.  
- Any modifications must be clearly documented.  

See the `LICENSE` file for full legal terms.

---
