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

-- Simplified SQLite schema derived from Supabase schema.
-- This keeps the core tables so the app can run locally without Postgres extensions.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT,
  clientId TEXT NOT NULL UNIQUE,
  walletAddress TEXT,
  authProvider TEXT NOT NULL DEFAULT 'email',
  googleId TEXT UNIQUE,
  firstNameEncrypted TEXT,
  firstNameIv TEXT,
  firstNameTag TEXT,
  firstNameSalt TEXT,
  lastNameEncrypted TEXT,
  lastNameIv TEXT,
  lastNameTag TEXT,
  lastNameSalt TEXT,
  phoneEncrypted TEXT,
  phoneIv TEXT,
  phoneTag TEXT,
  phoneSalt TEXT,
  firstName TEXT,
  lastName TEXT,
  phone TEXT,
  city TEXT,
  country TEXT,
  termsAccepted INTEGER NOT NULL DEFAULT 0,
  privacyAccepted INTEGER NOT NULL DEFAULT 0,
  marketingEmail INTEGER NOT NULL DEFAULT 0,
  marketingSms INTEGER NOT NULL DEFAULT 0,
  marketingPush INTEGER NOT NULL DEFAULT 0,
  consentUpdatedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastLoginAt TEXT,
  lastActivityAt TEXT,
  dataRetentionUntil TEXT,
  registrationSource TEXT,
  userAgent TEXT,
  ipAddress TEXT,
  referrerUrl TEXT,
  utmSource TEXT,
  utmMedium TEXT,
  utmCampaign TEXT,
  utmTerm TEXT,
  utmContent TEXT,
  detectedLanguage TEXT,
  deviceType TEXT,
  browserLanguage TEXT,
  timezone TEXT,
  platform TEXT,
  totalSessions INTEGER NOT NULL DEFAULT 0,
  totalPageViews INTEGER NOT NULL DEFAULT 0,
  avgSessionDuration INTEGER NOT NULL DEFAULT 0,
  avatarUrl TEXT,
  favoriteColdDrink TEXT,
  favoriteHotDrink TEXT,
  favoriteFood TEXT,
  weeklyCoffeeCount INTEGER NOT NULL DEFAULT 0,
  rewardEarned INTEGER NOT NULL DEFAULT 0,
  monthlyMetrics TEXT,
  userSegment TEXT,
  acquisitionChannel TEXT,
  lifetimeValue REAL NOT NULL DEFAULT 0,
  loyaltyActivatedAt TEXT
);

CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  street TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT,
  postalCode TEXT NOT NULL,
  country TEXT NOT NULL,
  isDefault INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  userId TEXT REFERENCES users(id) ON DELETE SET NULL,
  orderNumber TEXT UNIQUE,
  status TEXT NOT NULL,
  total REAL NOT NULL,
  subtotal REAL,
  vatAmount REAL,
  vatPercent REAL,
  tipAmount REAL,
  tipPercent REAL,
  deliveryTipAmount REAL,
  deliveryTipPercent REAL,
  currency TEXT DEFAULT 'MXN',
  items TEXT DEFAULT '[]',
  totals TEXT DEFAULT '{}',
  metadata TEXT,
  notes TEXT,
  message TEXT,
  instructions TEXT,
  sourceType TEXT DEFAULT 'pos',
  customer_name TEXT,
  pos_customer_id TEXT,
  shipping_contact_phone TEXT,
  shipping_contact_is_whatsapp INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  productId TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loyalty_points (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  orderId TEXT REFERENCES orders(id) ON DELETE SET NULL,
  expiresAt TEXT,
  metadata TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  userId TEXT REFERENCES users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ipAddress TEXT,
  userAgent TEXT,
  deviceType TEXT,
  browser TEXT,
  os TEXT,
  country TEXT,
  city TEXT,
  sessionDuration INTEGER NOT NULL DEFAULT 0,
  pageViews INTEGER NOT NULL DEFAULT 0,
  lastActivityAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  subcategory TEXT,
  price REAL NOT NULL,
  cost REAL,
  totalSales INTEGER NOT NULL DEFAULT 0,
  totalRevenue REAL NOT NULL DEFAULT 0,
  avgRating REAL NOT NULL DEFAULT 0,
  reviewCount INTEGER NOT NULL DEFAULT 0,
  stockQuantity INTEGER NOT NULL DEFAULT 0,
  lowStockThreshold INTEGER NOT NULL DEFAULT 10,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  orderId TEXT REFERENCES orders(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  helpfulVotes INTEGER NOT NULL DEFAULT 0,
  totalVotes INTEGER NOT NULL DEFAULT 0,
  verifiedPurchase INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_consumption (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  orderId TEXT REFERENCES orders(id) ON DELETE SET NULL,
  reservationId TEXT,
  category TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'pos',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  reservationCode TEXT UNIQUE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peopleCount INTEGER NOT NULL DEFAULT 1,
  reservationDate TEXT NOT NULL,
  reservationTime TEXT NOT NULL,
  branchId TEXT DEFAULT 'MATRIZ',
  branchNumber TEXT,
  message TEXT,
  preOrderItems TEXT,
  linkedOrderId TEXT REFERENCES orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sourceType TEXT DEFAULT 'cliente',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  ticketCode TEXT UNIQUE,
  orderId TEXT REFERENCES orders(id) ON DELETE CASCADE,
  userId TEXT REFERENCES users(id) ON DELETE SET NULL,
  branchId TEXT DEFAULT 'MATRIZ',
  currency TEXT DEFAULT 'MXN',
  tipPercent REAL DEFAULT 0,
  tipAmount REAL DEFAULT 0,
  paymentMethod TEXT,
  paymentDetails TEXT,
  qrPayload TEXT,
  qrImageUrl TEXT,
  ticketImageUrl TEXT,
  emailSentAt TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  orderId TEXT REFERENCES orders(id) ON DELETE CASCADE,
  ticketId TEXT REFERENCES tickets(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'MXN',
  status TEXT DEFAULT 'initiated',
  tipAmount REAL DEFAULT 0,
  tipPercent REAL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed product to match Supabase script
INSERT OR IGNORE INTO products (
  id, productId, name, category, subcategory, price, cost,
  totalSales, totalRevenue, avgRating, reviewCount,
  stockQuantity, lowStockThreshold, createdAt, updatedAt, isActive
) VALUES (
  'feedback-general', 'feedback-general', 'Feedback general',
  'feedback', 'comentarios', 0, 0,
  0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  street TEXT,
  city TEXT,
  state TEXT,
  postalCode TEXT,
  country TEXT DEFAULT 'MX',
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO branches (id, code, name, city, country)
VALUES ('MATRIZ', 'MATRIZ', 'Sucursal Matriz', 'Ciudad de México', 'MX');

CREATE TABLE IF NOT EXISTS order_codes (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT,
  authProvider TEXT NOT NULL DEFAULT 'email',
  googleId TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('barista','gerente','socio','super_admin')),
  branchId TEXT DEFAULT 'MATRIZ' REFERENCES branches(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  firstNameEncrypted TEXT,
  firstNameIv TEXT,
  firstNameTag TEXT,
  firstNameSalt TEXT,
  lastNameEncrypted TEXT,
  lastNameIv TEXT,
  lastNameTag TEXT,
  lastNameSalt TEXT,
  phoneEncrypted TEXT,
  phoneIv TEXT,
  phoneTag TEXT,
  phoneSalt TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastLoginAt TEXT
);

CREATE INDEX IF NOT EXISTS staff_users_role_idx ON staff_users (role);
CREATE INDEX IF NOT EXISTS staff_users_branch_idx ON staff_users (branchId);

CREATE TABLE IF NOT EXISTS staff_sessions (
  id TEXT PRIMARY KEY,
  staffId TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  sessionStart TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sessionEnd TEXT,
  durationSeconds INTEGER NOT NULL DEFAULT 0,
  ipAddress TEXT,
  userAgent TEXT,
  deviceType TEXT,
  browser TEXT,
  os TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT,
  startedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS staff_sessions_staff_id_idx ON staff_sessions (staffId);

CREATE TABLE IF NOT EXISTS prep_queue (
  id TEXT PRIMARY KEY,
  orderItemId TEXT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  handledByStaffId TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completedAt TEXT
);

CREATE INDEX IF NOT EXISTS prep_queue_status_idx ON prep_queue (status);

CREATE TABLE IF NOT EXISTS inventory_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

INSERT OR IGNORE INTO inventory_categories (id, code, name) VALUES
  ('CAT_FOOD','food','Alimentos'),
  ('CAT_BEV','beverage_supplies','Insumos de bebidas'),
  ('CAT_CLN','cleaning','Insumos de limpieza'),
  ('CAT_DIS','disposables','Desechables');

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  categoryId TEXT NOT NULL REFERENCES inventory_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unidad',
  minStock INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  lastRestockAt TEXT,
  lastRestockQty REAL,
  avgCost REAL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_stock (
  id TEXT PRIMARY KEY,
  itemId TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  branchId TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 0,
  lastUpdatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_stock_item_branch_idx ON inventory_stock (itemId, branchId);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  itemId TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  branchId TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
  quantity REAL NOT NULL,
  reason TEXT,
  relatedOrderItemId TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  createdByStaffId TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos_action_logs (
  id TEXT PRIMARY KEY,
  staffId TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  ipAddress TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_requests (
  id TEXT PRIMARY KEY,
  requestedByStaffId TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('sales','customers','employees')),
  granularity TEXT NOT NULL CHECK (granularity IN ('day','week','month','year')),
  periodStart TEXT NOT NULL,
  periodEnd TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  resultUrl TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservation_failures (
  id TEXT PRIMARY KEY,
  originalReservationId TEXT NOT NULL UNIQUE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservationCode TEXT,
  reservationDate TEXT NOT NULL,
  reservationTime TEXT NOT NULL,
  branchId TEXT NOT NULL,
  branchNumber TEXT,
  peopleCount INTEGER NOT NULL,
  message TEXT,
  preOrderItems TEXT,
  linkedOrderId TEXT REFERENCES orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  archivedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cleanupAt TEXT NOT NULL DEFAULT (DATETIME('now', '+7 days'))
);

CREATE INDEX IF NOT EXISTS reservation_failures_user_idx ON reservation_failures (userId);
CREATE INDEX IF NOT EXISTS reservation_failures_cleanup_idx ON reservation_failures (cleanupAt);

CREATE TABLE IF NOT EXISTS pos_pending_queue (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retryCount INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pos_pending_queue_status_idx
  ON pos_pending_queue (status, updatedAt);

CREATE TABLE IF NOT EXISTS pos_queue_entries (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  orderItemId TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed','cancelled')),
  source TEXT NOT NULL DEFAULT 'pos',
  payload TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handledByStaffId TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  startedAt TEXT,
  completedAt TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_queue_entries_order_item_idx
  ON pos_queue_entries(orderItemId)
  WHERE orderItemId IS NOT NULL;

CREATE INDEX IF NOT EXISTS pos_queue_entries_order_idx ON pos_queue_entries(orderId);

CREATE TABLE IF NOT EXISTS inventory_stock_ledger (
  id TEXT PRIMARY KEY,
  itemId TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  branchId TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  voucherType TEXT NOT NULL CHECK (voucherType IN ('purchase','transfer','consumption','adjustment','return')),
  voucherNo TEXT,
  postingDate TEXT NOT NULL,
  postingTime TEXT NOT NULL,
  inQty REAL NOT NULL DEFAULT 0,
  outQty REAL NOT NULL DEFAULT 0,
  balanceQty REAL NOT NULL DEFAULT 0,
  valuationRate REAL,
  inValue REAL NOT NULL DEFAULT 0,
  outValue REAL NOT NULL DEFAULT 0,
  balanceValue REAL NOT NULL DEFAULT 0,
  batchNo TEXT,
  serialNo TEXT,
  isCancelled INTEGER NOT NULL DEFAULT 0,
  createdByStaffId TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS inventory_stock_ledger_item_branch_idx
  ON inventory_stock_ledger (itemId, branchId, postingDate);

CREATE TABLE IF NOT EXISTS inventory_stock_entries (
  id TEXT PRIMARY KEY,
  entryType TEXT NOT NULL CHECK (entryType IN ('purchase','transfer','adjustment','consumption')),
  fromBranchId TEXT REFERENCES branches(id) ON DELETE SET NULL,
  toBranchId TEXT REFERENCES branches(id) ON DELETE SET NULL,
  remarks TEXT,
  createdByStaffId TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submittedAt TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS inventory_stock_entry_items (
  id TEXT PRIMARY KEY,
  entryId TEXT NOT NULL REFERENCES inventory_stock_entries(id) ON DELETE CASCADE,
  itemId TEXT NOT NULL REFERENCES inventory_items(id),
  branchId TEXT NOT NULL REFERENCES branches(id),
  qty REAL NOT NULL,
  valuationRate REAL,
  amount REAL,
  relatedOrderItemId TEXT REFERENCES order_items(id) ON DELETE SET NULL
);
