export type OrderStatus = 'pending' | 'completed' | 'past';
export type ReservationStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

export interface OrderUserInfo {
  firstNameEncrypted?: string | null;
  firstNameIv?: string | null;
  firstNameTag?: string | null;
  firstNameSalt?: string | null;
  lastNameEncrypted?: string | null;
  lastNameIv?: string | null;
  lastNameTag?: string | null;
  lastNameSalt?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  phoneEncrypted?: string | null;
  phoneIv?: string | null;
  phoneTag?: string | null;
  phoneSalt?: string | null;
  clientId?: string | null;
  email?: string | null;
}

export interface OrderItemSummary {
  id?: string | null;
  productId?: string | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  quantity?: number | null;
  price?: number | null;
}

export interface Order {
  id: string;
  clientId?: string | null;
  userId?: string | null;
  orderNumber?: string | null;
  ticketCode?: string | null;
  shortCode?: string | null;
  type?: string | null;
  status: OrderStatus;
  total?: number | null;
  currency?: string | null;
  items?: OrderItemSummary[] | null;
  itemsCount?: number | null;
  user?: OrderUserInfo | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  isHidden?: boolean;
  queuedPaymentMethod?: string | null;
  tipAmount?: number | null;
  tipPercent?: number | null;
}

export interface Reservation {
  id: string;
  reservationCode?: string | null;
  userId?: string | null;
  user?: OrderUserInfo | null;
  peopleCount?: number | null;
  reservationDate?: string | null;
  reservationTime?: string | null;
  branchId?: string | null;
  branchNumber?: string | null;
  message?: string | null;
  preOrderItems?: string | null;
  status?: ReservationStatus | string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  isHidden?: boolean;
}

export interface PrepOrder {
  id?: string | null;
  orderNumber?: string | null;
  status?: string | null;
  total?: number | null;
  currency?: string | null;
  userId?: string | null;
  clientId?: string | null;
  createdAt?: string | null;
  items?: OrderItemSummary[] | null;
}

export interface PrepOrderItem {
  id?: string | null;
  orderId?: string | null;
  productId?: string | null;
  quantity?: number | null;
  price?: number | null;
  createdAt?: string | null;
}

export interface PrepProduct {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
}

export type PrepStatus = 'pending' | 'in_progress' | 'completed' | string;

export interface PrepTask {
  id: string;
  orderItemId?: string | null;
  status: PrepStatus;
  handledByStaffId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  amount?: number;
  orderItem?: PrepOrderItem | null;
  order?: PrepOrder | null;
  product?: PrepProduct | null;
  handler?: {
    id?: string | null;
    email?: string | null;
    role?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    firstNameEncrypted?: string | null;
    lastNameEncrypted?: string | null;
  } | null;
  handlerName?: string | null;
  customer?: {
    id?: string | null;
    clientId?: string | null;
    email?: string | null;
    name?: string | null;
  } | null;
}

export interface LoyaltyCustomer {
  userId: string;
  orders: number;
  reservations: number;
  totalInteractions: number;
  totalSpent: number;
  lastActivity?: string | null;
  clientId?: string | null;
  email?: string | null;
  city?: string | null;
  country?: string | null;
  firstNameEncrypted?: string | null;
  favoriteBeverage?: string | null;
  favoriteFood?: string | null;
  loyaltyCoffees?: number | null;
  lastNameEncrypted?: string | null;
}

export interface LoyaltyStats {
  topCustomer: LoyaltyCustomer | null;
  customers: LoyaltyCustomer[];
}

export interface InventoryCategory {
  id: string;
  code?: string | null;
  name?: string | null;
}

export interface InventoryBranchStock {
  branchId?: string | null;
  quantity: number;
}

export interface InventoryItem {
  id: string;
  name?: string | null;
  unit?: string | null;
  categoryId?: string | null;
  minStock?: number;
  isActive?: boolean;
  stockTotal: number;
  branches: InventoryBranchStock[];
  category?: InventoryCategory | null;
  isLowStock: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface InventoryMovement {
  id: string;
  itemId?: string | null;
  branchId?: string | null;
  type?: string | null;
  quantity?: number | null;
  reason?: string | null;
  createdAt?: string | null;
}

export interface InventoryDashboard {
  categories: InventoryCategory[];
  items: InventoryItem[];
  lowStock: InventoryItem[];
  recentMovements: InventoryMovement[];
}

export interface PaymentRecord {
  id: string;
  orderId?: string | null;
  ticketId?: string | null;
  method?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  tipAmount?: number | null;
  tipPercent?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  order?: Order | null;
}

export interface PaymentMethodBreakdown {
  method: string;
  amount: number;
}

export interface PaymentStatusBreakdown {
  status: string;
  count: number;
}

export interface ReportRequest {
  id: string;
  scope?: string | null;
  granularity?: string | null;
  status?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  resultUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PaymentsDashboard {
  totalAmount: number;
  totalTips: number;
  monthlyTipsTotal?: number;
  monthlyTipPeriodStart?: string | null;
  monthlyTipPeriodEnd?: string | null;
  payments: PaymentRecord[];
  methodBreakdown: PaymentMethodBreakdown[];
  statusBreakdown: PaymentStatusBreakdown[];
  pendingReports: ReportRequest[];
}

export interface StaffMember {
  id: string;
  email?: string | null;
  role?: string | null;
  branchId?: string | null;
  isActive: boolean;
  firstNameEncrypted?: string | null;
  lastNameEncrypted?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastLoginAt?: string | null;
}

export interface StaffSessionRecord {
  id: string;
  staffId?: string | null;
  sessionStart?: string | null;
  sessionEnd?: string | null;
  durationSeconds?: number | null;
  ipAddress?: string | null;
  deviceType?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  staff?: StaffMember | null;
  isActive: boolean;
}

export interface StaffMetrics {
  totalStaff: number;
  activeStaff: number;
  roles: { role: string; count: number }[];
  activeSessions: number;
}

export interface StaffDashboard {
  staff: StaffMember[];
  sessions: StaffSessionRecord[];
  metrics: StaffMetrics;
}

export interface CatalogCategorySummary {
  name: string;
  products: number;
  active: number;
  totalRevenue: number;
}

export interface CatalogProduct {
  id: string;
  productId?: string | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  price?: number | null;
  cost?: number | null;
  totalSales?: number | null;
  totalRevenue?: number | null;
  avgRating?: number | null;
  reviewCount?: number | null;
  stockQuantity?: number | null;
  lowStockThreshold?: number | null;
  isActive?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CatalogPayload {
  products: CatalogProduct[];
  categories: CatalogCategorySummary[];
}

export interface PosSettings {
  id?: string;
  app?: string | null;
  store?: string | null;
  address_one?: string | null;
  address_two?: string | null;
  contact?: string | null;
  tax?: number | null;
  symbol?: string | null;
  percentage?: number | null;
  charge_tax?: boolean | string | null;
  footer?: string | null;
  img?: string | null;
  updatedAt?: string | null;
}

export interface TransactionHistoryEntry {
  order: Order;
  ticket: {
    id: string;
    orderId?: string | null;
    ticketCode?: string | null;
    createdAt?: string | null;
    tipAmount?: number | null;
    tipPercent?: number | null;
    paymentMethod?: string | null;
  } | null;
  payment: {
    id: string;
    orderId?: string | null;
    method?: string | null;
    amount?: number | null;
    currency?: string | null;
    status?: string | null;
    tipAmount?: number | null;
    createdAt?: string | null;
  } | null;
  total: number;
  tip: number;
  status?: string | null;
  createdAt?: string | null;
}

export interface PartnerAdvancedMetrics {
  dailySales: Array<{
    date: string;
    sales: number;
    orders: number;
    tips: number;
  }>;
  paymentMethods: Array<{
    method: string;
    amount: number;
    percent: number;
  }>;
  orderStatus: Array<{
    status: string;
    count: number;
  }>;
  customerSegments: {
    newCustomers: number;
    returningCustomers: number;
    vipCustomers: number;
  };
  tipPerformance: {
    totalTips: number;
    avgTip: number;
    tipRate: number;
  };
}

export interface PartnerMetrics {
  metrics: {
    salesTotal: number;
    paymentsTotal: number;
    avgTicket: number;
    completedOrders: number;
    tipsTotal: number;
  };
  loyalty: {
    customersTracked: number;
    totalOrders: number;
    totalSpent: number;
    topCustomers: Array<{
      clientId?: string | null;
      orders?: number | null;
      spent?: number | null;
      items?: number | null;
    }>;
  };
  reports: ReportRequest[];
  advanced: PartnerAdvancedMetrics;
}

const API_BASE = process.env.NEXT_PUBLIC_POS_API_URL?.trim();

const buildApiUrl = (
  path: string,
  params?: Record<string, string | number | undefined | null>
) => {
  const url = new URL(path, 'http://local.api');
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }
  if (API_BASE) {
    const normalizedBase = API_BASE.replace(/\/$/, '');
    return `${normalizedBase}${url.pathname}${url.search}`;
  }
  return `${url.pathname}${url.search}`;
};

export async function fetchOrders(status?: OrderStatus): Promise<Order[]> {
  const url = buildApiUrl('/api/orders', status ? { status } : undefined);

  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar los tickets');
  }

  const payload = (await response.json()) as { success: boolean; data?: Order[] };

  if (!payload.success || !Array.isArray(payload.data)) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function fetchLoyaltyStats(): Promise<LoyaltyStats> {
  const url = buildApiUrl('/api/loyalty');
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar las métricas de lealtad');
  }

  const payload = (await response.json()) as { success: boolean; data?: LoyaltyStats };

  if (!payload.success || !payload.data) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function fetchReservations(status?: ReservationStatus): Promise<Reservation[]> {
  const url = buildApiUrl('/api/reservations', status ? { status } : undefined);

  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar las reservaciones');
  }

  const payload = (await response.json()) as { success: boolean; data?: Reservation[] };

  if (!payload.success || !Array.isArray(payload.data)) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function fetchPrepQueue(status?: PrepStatus): Promise<PrepTask[]> {
  const url = buildApiUrl('/api/prep-queue', status ? { status } : undefined);

  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar la cola de producción');
  }

  const payload = (await response.json()) as { success: boolean; data?: PrepTask[] };

  if (!payload.success || !Array.isArray(payload.data)) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function enqueueOrder(
  orderId: string,
  params?: { staffId?: string | null; staffName?: string | null; paymentMethod?: string | null }
): Promise<void> {
  const staffId = params?.staffId?.trim() ? params.staffId.trim() : null;
  const staffName = params?.staffName?.trim() ? params.staffName.trim() : null;
  const paymentMethod = params?.paymentMethod?.trim() ? params.paymentMethod.trim() : null;
  const url = buildApiUrl(`/api/orders/${orderId}/queue`, staffId ? { staffId } : undefined);
  const headers: Record<string, string> = {};
  if (staffId) {
    headers['Content-Type'] = 'application/json';
    headers['X-XOCO-Staff-Id'] = staffId;
  }
  if (staffName) {
    headers['X-XOCO-Staff-Name'] = staffName;
  }
  if (paymentMethod) {
    headers['X-XOCO-Payment-Method'] = paymentMethod;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: Object.keys(headers).length ? headers : undefined,
    body: staffId ? JSON.stringify({ staffId }) : undefined,
  });

  if (!response.ok) {
    throw new Error('No pudimos mover el pedido a la cola de producción');
  }
}

export async function completeOrder(orderId: string): Promise<void> {
  const url = buildApiUrl(`/api/orders/${orderId}/complete`);
  const response = await fetch(url, { method: 'POST' });

  if (!response.ok) {
    throw new Error('No pudimos marcar el pedido como completado');
  }
}

const updateReservationStatus = async (
  reservationId: string,
  status: 'completed' | 'cancelled'
) => {
  const url = buildApiUrl(`/api/reservations/${reservationId}/complete`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    const message =
      status === 'cancelled'
        ? 'No pudimos cancelar la reservación'
        : 'No pudimos confirmar la reservación';
    throw new Error(message);
  }
};

export async function completeReservation(reservationId: string): Promise<void> {
  await updateReservationStatus(reservationId, 'completed');
}

export async function cancelReservation(reservationId: string): Promise<void> {
  await updateReservationStatus(reservationId, 'cancelled');
}

export async function fetchTicketDetail(identifier: string): Promise<TicketDetail> {
  const url = buildApiUrl(`/api/orders/ticket/${encodeURIComponent(identifier)}`);
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'No pudimos obtener los datos del ticket');
  }

  const payload = (await response.json()) as { success: boolean; data?: TicketDetail };
  if (!payload.success || !payload.data) {
    throw new Error('Respuesta inválida del servidor');
  }
  return payload.data;
}

export async function completePrepTask(taskId: string): Promise<void> {
  const url = buildApiUrl(`/api/prep-queue/${taskId}/complete`);
  const response = await fetch(url, { method: 'POST' });

  if (!response.ok) {
    throw new Error('No pudimos cerrar la tarea de preparación');
  }
}

export async function fetchInventoryDashboard(): Promise<InventoryDashboard> {
  const url = buildApiUrl('/api/inventory-dashboard');
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar el inventario');
  }

  const payload = (await response.json()) as { success: boolean; data?: InventoryDashboard };

  if (!payload.success || !payload.data) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function fetchPaymentsDashboard(): Promise<PaymentsDashboard> {
  const url = buildApiUrl('/api/payments-dashboard');
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar el panel de pagos');
  }

  const payload = (await response.json()) as { success: boolean; data?: PaymentsDashboard };

  if (!payload.success || !payload.data) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function fetchStaffDashboard(): Promise<StaffDashboard> {
  const url = buildApiUrl('/api/staff-dashboard');
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar el staff');
  }

  const payload = (await response.json()) as { success: boolean; data?: StaffDashboard };

  if (!payload.success || !payload.data) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function fetchCatalog(): Promise<CatalogPayload> {
  const url = buildApiUrl('/api/catalog');
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar el catálogo');
  }

  const payload = (await response.json()) as { success: boolean; data?: CatalogPayload };

  if (!payload.success || !payload.data) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function fetchTransactionsHistory(): Promise<TransactionHistoryEntry[]> {
  const url = buildApiUrl('/api/transactions-history');
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar las transacciones');
  }

  const payload = (await response.json()) as {
    success: boolean;
    data?: TransactionHistoryEntry[];
  };

  if (!payload.success || !Array.isArray(payload.data)) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function fetchPosSettings(): Promise<PosSettings> {
  const url = buildApiUrl('/api/pos-settings');
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar la configuración del POS');
  }

  const payload = (await response.json()) as { success: boolean; data?: PosSettings };

  if (!payload.success || !payload.data) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function updatePosSettings(data: PosSettings): Promise<PosSettings> {
  const url = buildApiUrl('/api/pos-settings');
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('No pudimos guardar la configuración del POS');
  }

  const payload = (await response.json()) as { success: boolean; data?: PosSettings };

  if (!payload.success || !payload.data) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}

export async function fetchPartnerMetrics(days?: number): Promise<PartnerMetrics> {
  const url = buildApiUrl('/api/partner-metrics', days ? { days } : undefined);
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No pudimos cargar las métricas de socios');
  }

  const payload = (await response.json()) as { success: boolean; data?: PartnerMetrics };

  if (!payload.success || !payload.data) {
    throw new Error('Respuesta inválida del servidor');
  }

  return payload.data;
}
export interface TicketDetail {
  ticket: {
    id: string;
    ticketCode: string;
    orderId: string;
    userId: string;
    paymentMethod?: string | null;
    tipAmount?: number | null;
    tipPercent?: number | null;
    currency?: string | null;
    createdAt?: string | null;
  };
  order: {
    id: string;
    status: string;
    total?: number | null;
    currency?: string | null;
    createdAt?: string | null;
    userId?: string | null;
  };
  customer: {
    id?: string | null;
    clientId?: string | null;
    email?: string | null;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  };
  items: Array<{
    id: string;
    productId?: string | null;
    quantity: number;
    price?: number | null;
    product?: { name?: string | null; category?: string | null; subcategory?: string | null } | null;
  }>;
}
