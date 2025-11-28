import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { withDecryptedUserNames, type RawUserRecord } from '@/lib/customer-decrypt';

const sanitizeEnv = (value?: string | null) => value?.trim() || null;

const PUBLIC_SALE_CLIENT_ID =
  sanitizeEnv(process.env.SUPABASE_PUBLIC_SALE_CLIENT_ID) ??
  sanitizeEnv(process.env.NEXT_PUBLIC_PUBLIC_SALE_CLIENT_ID) ??
  'AAA-1111';
const PUBLIC_SALE_USER_ID =
  sanitizeEnv(process.env.SUPABASE_PUBLIC_SALE_USER_ID) ??
  sanitizeEnv(process.env.NEXT_PUBLIC_PUBLIC_SALE_USER_ID) ??
  PUBLIC_SALE_CLIENT_ID;
const PUBLIC_SALE_CLIENT_ID_LOWER = PUBLIC_SALE_CLIENT_ID?.toLowerCase() ?? '';
const PUBLIC_SALE_USER_ID_LOWER = PUBLIC_SALE_USER_ID?.toLowerCase() ?? '';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PAYMENTS_TABLE = process.env.SUPABASE_PAYMENTS_TABLE ?? 'payments';
const RESERVATIONS_TABLE = process.env.SUPABASE_RESERVATIONS_TABLE ?? 'reservations';
const PREP_QUEUE_TABLE = process.env.SUPABASE_PREP_QUEUE_TABLE ?? 'prep_queue';
const STAFF_SESSIONS_TABLE = process.env.SUPABASE_STAFF_SESSIONS_TABLE ?? 'staff_sessions';
const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const PAGE_ANALYTICS_TABLE = process.env.SUPABASE_PAGE_ANALYTICS_TABLE ?? 'page_analytics';
const INVENTORY_LEDGER_TABLE = process.env.SUPABASE_STOCK_LEDGER_TABLE ?? 'inventory_stock_ledger';
const INVENTORY_ITEMS_TABLE = process.env.SUPABASE_INVENTORY_ITEMS_TABLE ?? 'inventory_items';
const INVENTORY_STOCK_TABLE = process.env.SUPABASE_INVENTORY_STOCK_TABLE ?? 'inventory_stock';
const LOYALTY_PUNCHES_TABLE = process.env.SUPABASE_LOYALTY_PUNCHES_TABLE ?? 'loyalty_points';
const ALWAYS_INCLUDED_STAFF_EMAILS = [
  'barista.demo@xoco.local',
  'gerente.demo@xoco.local',
  'cots.21d@gmail.com',
  'aleisgales99@gmail.com',
  'garcia.aragon.jhon23@gmail.com',
  'donovanriano@gmail.com',
];
const CLEANING_COMPLETION_COUNTS: Record<string, number> = {
  'barista.demo@xoco.local': 9,
  'gerente.demo@xoco.local': 4,
  'cots.21d@gmail.com': 3,
  'aleisgales99@gmail.com': 2,
  'garcia.aragon.jhon23@gmail.com': 2,
  'donovanriano@gmail.com': 1,
};
const MAX_MONTH_HISTORY = 18;

const buildMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const baseDate = new Date(year, (month ?? 1) - 1, 1);
  return baseDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
};

const resolveMonthRange = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) {
    throw new Error('Mes inválido');
  }
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
};

const collectAvailableMonths = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const earliest = new Date(today);
  earliest.setMonth(earliest.getMonth() - (MAX_MONTH_HISTORY - 1));
  earliest.setDate(1);

  const { data, error } = await supabaseAdmin
    .from(ORDERS_TABLE)
    .select('"createdAt"')
    .gte('createdAt', earliest.toISOString());

  if (error) {
    console.warn('No pudimos obtener los meses disponibles:', error.message);
    return [];
  }

  const monthSet = new Set<string>();
  (data ?? []).forEach((row) => {
    const createdAt = row?.createdAt;
    if (typeof createdAt === 'string' && createdAt.length >= 7) {
      monthSet.add(createdAt.substring(0, 7));
    }
  });

  const currentMonth = new Date().toISOString().substring(0, 7);
  monthSet.add(currentMonth);

  return Array.from(monthSet)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, MAX_MONTH_HISTORY)
    .map((month) => ({ month, label: buildMonthLabel(month) }));
};

type RangeKey =
  | '1d'
  | '3d'
  | '7d'
  | '14d'
  | '30d'
  | '60d'
  | '90d'
  | '180d'
  | '365d'
  | '2y'
  | '3y'
  | '5y'
  | '10y';

type RangeWithMonth = RangeKey | 'month';

const RANGE_DEFS: Record<RangeKey, { amount: number; unit: 'day' | 'year'; label: string }> = {
  '1d': { amount: 1, unit: 'day', label: '1 día' },
  '3d': { amount: 3, unit: 'day', label: '3 días' },
  '7d': { amount: 7, unit: 'day', label: '7 días' },
  '14d': { amount: 14, unit: 'day', label: '14 días' },
  '30d': { amount: 30, unit: 'day', label: '30 días' },
  '60d': { amount: 60, unit: 'day', label: '60 días' },
  '90d': { amount: 90, unit: 'day', label: '90 días' },
  '180d': { amount: 180, unit: 'day', label: '180 días' },
  '365d': { amount: 365, unit: 'day', label: '365 días' },
  '2y': { amount: 2, unit: 'year', label: '2 años' },
  '3y': { amount: 3, unit: 'year', label: '3 años' },
  '5y': { amount: 5, unit: 'year', label: '5 años' },
  '10y': { amount: 10, unit: 'year', label: '10 años' },
};

const SECTION_IDS = ['clients', 'sales', 'payments', 'orders', 'analytics', 'employees', 'inventory'] as const;
type SectionId = (typeof SECTION_IDS)[number];

type ChartBar = { label: string; value: number; secondary?: number };
type MetricCard = { label: string; value: string | number; hint?: string };
type SectionTable = { columns: string[]; rows: Array<Record<string, string | number>> };

type SectionPayload = {
  title: string;
  hasData: boolean;
  cards: MetricCard[];
  bars: ChartBar[];
  table?: SectionTable;
  extraTables?: Array<{ title: string; table: SectionTable }>;
  message?: string;
};

const normalizeIdentifier = (value?: string | null) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const isPublicSaleOrder = (order: { clientId?: string | null; userId?: string | null } & Record<string, unknown>) => {
  const clientId =
    normalizeIdentifier(order.clientId) ||
    normalizeIdentifier(typeof order.client_id === 'string' ? order.client_id : null);
  const userId =
    normalizeIdentifier(order.userId) ||
    normalizeIdentifier(typeof order.user_id === 'string' ? order.user_id : null);

  if (!clientId && !userId) {
    return true;
  }
  if (PUBLIC_SALE_CLIENT_ID_LOWER && clientId === PUBLIC_SALE_CLIENT_ID_LOWER) {
    return true;
  }
  if (PUBLIC_SALE_USER_ID_LOWER && userId === PUBLIC_SALE_USER_ID_LOWER) {
    return true;
  }
  return false;
};

type ForecastRestock = {
  id: string;
  name: string;
  quantity: number;
  avgDailyUse: number;
  daysRemaining: number | null;
  nextRestock?: string | null;
};

type ForecastProduction = {
  id: string;
  name: string;
  dailyAverage: number;
  weeklyDemand: number;
  peakHour: string;
};

type ForecastActivity = { day: string; hour: string; count: number };

type ForecastSummary = {
  label: string;
  days: number;
  revenue: number;
  orders: number;
  busiestDay: string;
  topActivity: ForecastActivity[];
};

type MarketingSegment = {
  name: string;
  description: string;
  count: number;
  avgTicket: number;
  chart: {
    points: Array<{ orders: number; spent: number }>;
    centroid: { orders: number; spent: number };
  };
};
type MarketingSuggestion = { product: string; reason: string };
type MarketingOrderInference = { type: string; probability: number; drivers: string };
type MarketingMarkov = { from: string; to: string; probability: number };
type MarketingInventoryInsight = { item: string; risk: string; recommendation: string };
type MarketingAnomaly = { label: string; description: string };

type MarketingInsights = {
  salesClusters: MarketingSegment[];
  productSuggestions: MarketingSuggestion[];
  bestHours: ForecastActivity[];
  orderInference: MarketingOrderInference[];
  landingMarkov: MarketingMarkov[];
  inventoryBayesian: MarketingInventoryInsight[];
  anomalies: MarketingAnomaly[];
};

type ForecastPayload = {
  restock: ForecastRestock[];
  production: ForecastProduction[];
  salesWindows: ForecastSummary[];
  branchDemand: Array<{ branch: string; points: Array<{ date: string; revenue: number }> }>;
};

type AdvancedMetricsPayload = {
  range: RangeWithMonth;
  rangeLabel: string;
  since: string;
  until: string;
  hasData: boolean;
  rangeAvailability: Record<RangeKey, boolean>;
  availableMonths: Array<{ month: string; label: string }>;
  selectedMonth: string | null;
  sections: Record<SectionId, SectionPayload>;
  forecasts: ForecastPayload;
  marketing: MarketingInsights;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const average = (values: number[]) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const durationSeconds = (start?: string | null, end?: string | null) => {
  if (!start || !end) return 0;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = (endDate.getTime() - startDate.getTime()) / 1000;
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
};

const resolveRange = (rangeParam?: string): { key: RangeKey; since: Date; until: Date } => {
  const key = (rangeParam && RANGE_DEFS[rangeParam as RangeKey] ? rangeParam : '30d') as RangeKey;
  const def = RANGE_DEFS[key];
  const until = new Date();
  const since = new Date(until);
  if (def.unit === 'day') {
    since.setDate(since.getDate() - def.amount);
  } else {
    since.setFullYear(since.getFullYear() - def.amount);
  }
  return { key, since, until };
};

const toISO = (date: Date) => date.toISOString();

const deviceFromUserAgent = (userAgent?: string | null) => {
  if (!userAgent) return 'Desconocido';
  const normalized = userAgent.toLowerCase();
  if (normalized.includes('mobile')) return 'Móvil';
  if (normalized.includes('tablet')) return 'Tablet';
  return 'Desktop';
};

const browserFromUserAgent = (userAgent?: string | null) => {
  if (!userAgent) return 'Desconocido';
  const normalized = userAgent.toLowerCase();
  if (normalized.includes('edge')) return 'Edge';
  if (normalized.includes('chrome') && !normalized.includes('edg/') && !normalized.includes('opr/')) return 'Chrome';
  if (normalized.includes('safari') && !normalized.includes('chrome')) return 'Safari';
  if (normalized.includes('firefox')) return 'Firefox';
  if (normalized.includes('opera') || normalized.includes('opr/')) return 'Opera';
  return 'Otro';
};

const osFromUserAgent = (userAgent?: string | null) => {
  if (!userAgent) return 'Desconocido';
  const normalized = userAgent.toLowerCase();
  if (normalized.includes('windows')) return 'Windows';
  if (normalized.includes('mac os') || normalized.includes('macintosh')) return 'macOS';
  if (normalized.includes('android')) return 'Android';
  if (normalized.includes('iphone') || normalized.includes('ipad') || normalized.includes('ios')) return 'iOS';
  if (normalized.includes('linux')) return 'Linux';
  return 'Otro';
};

const formatMinutesSeconds = (seconds: number) => {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const hourBucket = (value?: string | null) => {
  if (!value) return 'Sin hora';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin hora';
  const hour = date.getHours();
  return `${hour.toString().padStart(2, '0')}:00`;
};

const classifyBeverageTemperature = (item: unknown) => {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const name = typeof (item as { name?: string }).name === 'string' ? (item as { name?: string }).name : '';
  const category =
    typeof (item as { category?: string }).category === 'string' ? (item as { category?: string }).category : '';
  const subcategory =
    typeof (item as { subcategory?: string }).subcategory === 'string'
      ? (item as { subcategory?: string }).subcategory
      : '';
  const haystack = `${name} ${category} ${subcategory}`.toLowerCase();
  const coldKeywords = ['frio', 'frío', 'iced', 'cold', 'frapp', 'frappe', 'granizado', 'shakerato'];
  const hotKeywords = ['caliente', 'hot', 'espresso', 'latte', 'americano', 'tea', 'tisane'];
  if (coldKeywords.some((keyword) => haystack.includes(keyword))) {
    return 'cold';
  }
  if (hotKeywords.some((keyword) => haystack.includes(keyword))) {
    return 'hot';
  }
  return null;
};

const buildCsv = (table?: SectionTable) => {
  if (!table || !table.rows.length) {
    return 'mensaje,Sin datos disponibles';
  }
  const header = table.columns.join(',');
  const rows = table.rows.map((row) =>
    table.columns
      .map((column) => {
        const cell = row[column] ?? '';
        if (typeof cell === 'number') {
          return String(cell);
        }
        const text = String(cell ?? '');
        return text.includes(',') ? `"${text.replace(/"/g, '""')}"` : text;
      })
      .join(',')
  );
  return [header, ...rows].join('\n');
};

const buildEmptySection = (title: string, message?: string): SectionPayload => ({
  title,
  hasData: false,
  cards: [],
  bars: [],
  message: message ?? 'Sin datos disponibles para este rango.',
});

const sectionTitles: Record<SectionId, string> = {
  clients: 'Clientes',
  sales: 'Ventas',
  payments: 'Pagos',
  orders: 'Pedidos y reservas',
  analytics: 'Analítica pasiva',
  employees: 'Colaboradores',
  inventory: 'Inventarios',
};

const fetchEarliestTimestamp = async () => {
  const queries = [
    supabaseAdmin
      .from(ORDERS_TABLE)
      .select('"createdAt"')
      .order('createdAt', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from(PAYMENTS_TABLE)
      .select('"createdAt"')
      .order('createdAt', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from(RESERVATIONS_TABLE)
      .select('"createdAt"')
      .order('createdAt', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from(PAGE_ANALYTICS_TABLE)
      .select('"createdAt"')
      .order('createdAt', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ];
  const results = await Promise.all(queries);
  const dates = results
    .map((result) => result.data?.createdAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value));
  if (!dates.length) {
    return null;
  }
  return new Date(Math.min(...dates.map((date) => date.getTime())));
};

const fetchRangeData = async (sinceIso: string, untilIso: string) => {
  const [orders, payments, reservations, prepQueue, staffSessions, pageAnalytics, ledger] = await Promise.all([
    supabaseAdmin
      .from(ORDERS_TABLE)
      .select('id,"userId","orderNumber",status,total,"createdAt","sourceType",items,"tipAmount","tipPercent","queuedPaymentMethod"')
      .gte('createdAt', sinceIso)
      .lte('createdAt', untilIso),
    supabaseAdmin
      .from(PAYMENTS_TABLE)
      .select('id,method,amount,currency,status,"tipAmount","tipPercent","createdAt"')
      .gte('createdAt', sinceIso)
      .lte('createdAt', untilIso),
    supabaseAdmin
      .from(RESERVATIONS_TABLE)
      .select('id,"userId",status,"peopleCount","reservationDate","reservationTime","createdAt","sourceType","reservationCode"')
      .gte('createdAt', sinceIso)
      .lte('createdAt', untilIso),
    supabaseAdmin
      .from(PREP_QUEUE_TABLE)
      .select('id,"orderItemId",status,"handledByStaffId","createdAt","updatedAt","completedAt"')
      .gte('createdAt', sinceIso)
      .lte('createdAt', untilIso),
    supabaseAdmin
      .from(STAFF_SESSIONS_TABLE)
      .select('id,"staffId","sessionStart","sessionEnd","durationSeconds","browser","os","createdAt","userAgent"')
      .gte('createdAt', sinceIso)
      .lte('createdAt', untilIso),
    supabaseAdmin
      .from(PAGE_ANALYTICS_TABLE)
      .select('id,"userId","pagePath","timeOnPage","createdAt","userAgent","referrerUrl","conversionEvent","conversionValue"')
      .gte('createdAt', sinceIso)
      .lte('createdAt', untilIso),
    supabaseAdmin
      .from(INVENTORY_LEDGER_TABLE)
      .select('id,"itemId","branchId","voucherType","postingDate","inQty","outQty","inValue","outValue","balanceQty","balanceValue","createdAt"')
      .gte('createdAt', sinceIso)
      .lte('createdAt', untilIso),
  ]);

  const orderIds = (orders.data ?? []).map((order) => order.id);
  const orderItemsPromise = orderIds.length
    ? supabaseAdmin
        .from(ORDER_ITEMS_TABLE)
        .select('id,"orderId","productId",quantity,price,"createdAt"')
        .gte('createdAt', sinceIso)
        .lte('createdAt', untilIso)
    : Promise.resolve({ data: [] });

  const inventoryItemsPromise = supabaseAdmin
    .from(INVENTORY_ITEMS_TABLE)
    .select('id,name,"categoryId",unit,"minStock"');

  const userIds = new Set<string>();
  (orders.data ?? []).forEach((order) => order.userId && userIds.add(order.userId));
  (reservations.data ?? []).forEach((reservation) => reservation.userId && userIds.add(reservation.userId));
  (pageAnalytics.data ?? []).forEach((entry) => entry.userId && userIds.add(entry.userId));

  const inventoryStockPromise = supabaseAdmin
    .from(INVENTORY_STOCK_TABLE)
    .select('id,"itemId","branchId",quantity');

  const loyaltyPunchesPromise = userIds.size
    ? supabaseAdmin.from(LOYALTY_PUNCHES_TABLE).select('"userId"').in('userId', Array.from(userIds))
    : Promise.resolve({ data: [] });

  const [orderItems, inventoryItems, inventoryStock, loyaltyPunches] = await Promise.all([
    orderItemsPromise,
    inventoryItemsPromise,
    inventoryStockPromise,
    loyaltyPunchesPromise,
  ]);

  const usersResult = userIds.size
    ? await supabaseAdmin
        .from('users')
        .select(
          [
            'id',
            'email',
            '"clientId"',
            '"userSegment"',
            'city',
            'country',
            '"favoriteColdDrink"',
            '"favoriteHotDrink"',
            '"favoriteFood"',
            '"acquisitionChannel"',
            '"firstNameEncrypted"',
            '"firstNameIv"',
            '"firstNameTag"',
            '"firstNameSalt"',
            '"lastNameEncrypted"',
            '"lastNameIv"',
            '"lastNameTag"',
            '"lastNameSalt"',
          ].join(',')
        )
        .in('id', Array.from(userIds))
    : { data: [] };

  const staffIds = new Set<string>();
  (staffSessions.data ?? []).forEach((session) => session.staffId && staffIds.add(session.staffId));
  (prepQueue.data ?? []).forEach((task) => task.handledByStaffId && staffIds.add(task.handledByStaffId));

  const baseStaffSelect = [
    'id',
    'email',
    'role',
    '"firstNameEncrypted"',
    '"firstNameIv"',
    '"firstNameTag"',
    '"lastNameEncrypted"',
    '"lastNameIv"',
    '"lastNameTag"',
  ].join(',');

  let staffRecords: RawUserRecord[] = [];

  if (staffIds.size) {
    const { data: staffById, error: staffError } = await supabaseAdmin
      .from(STAFF_TABLE)
      .select(baseStaffSelect)
      .in('id', Array.from(staffIds));
    if (staffError) {
      console.error('Error fetching staff by id for advanced metrics:', staffError);
    } else {
      const staffByIdData = staffById as unknown;
      if (Array.isArray(staffByIdData)) {
        staffRecords = staffByIdData.filter(
          (record): record is RawUserRecord => !!record && typeof record === 'object'
        );
      }
    }
  }

  const existingEmails = new Set(
    staffRecords
      .map((member) => member?.email?.toLowerCase())
      .filter((email): email is string => Boolean(email))
  );
  const missingEmails = ALWAYS_INCLUDED_STAFF_EMAILS.filter(
    (email) => !existingEmails.has(email.toLowerCase())
  );
  if (missingEmails.length) {
    const { data: staffByEmail, error: staffEmailError } = await supabaseAdmin
      .from(STAFF_TABLE)
      .select(baseStaffSelect)
      .in('email', missingEmails);
    if (staffEmailError) {
      console.error('Error fetching staff by email for advanced metrics:', staffEmailError);
    } else {
      const staffByEmailData = staffByEmail as unknown;
      if (Array.isArray(staffByEmailData) && staffByEmailData.length) {
        const normalized = staffByEmailData.filter(
          (record): record is RawUserRecord => !!record && typeof record === 'object'
        );
        staffRecords = staffRecords.concat(normalized);
      }
    }
  }

  const usersData = usersResult.data as unknown;
  const decryptedUsers = Array.isArray(usersData)
    ? usersData
        .filter((record): record is RawUserRecord => !!record && typeof record === 'object')
        .map((record) => withDecryptedUserNames(record) ?? record)
    : [];
  const decryptedStaff =
    staffRecords
      .map((record) => withDecryptedUserNames(record as RawUserRecord) ?? record) ?? [];

  return {
    orders: orders.data ?? [],
    payments: payments.data ?? [],
    reservations: reservations.data ?? [],
    prepQueue: prepQueue.data ?? [],
    staffSessions: staffSessions.data ?? [],
    pageAnalytics: pageAnalytics.data ?? [],
    ledger: ledger.data ?? [],
    orderItems: orderItems.data ?? [],
    inventoryItems: inventoryItems.data ?? [],
    inventoryStock: inventoryStock.data ?? [],
    users: decryptedUsers,
    staff: decryptedStaff,
    loyaltyPunches: (loyaltyPunches.data ?? []).reduce((map, entry) => {
      const userId = typeof entry.userId === 'string' ? entry.userId : null;
      if (!userId) return map;
      map.set(userId, (map.get(userId) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  };
};

const computeSections = (data: Awaited<ReturnType<typeof fetchRangeData>>): Record<SectionId, SectionPayload> => {
  const clients = buildClientsSection(data);
  const sales = buildSalesSection(data);
  const payments = buildPaymentsSection(data);
  const orders = buildOrdersSection(data);
  const analytics = buildPassiveAnalyticsSection(data);
  const employees = buildEmployeesSection(data);
  const inventory = buildInventorySection(data);
  return { clients, sales, payments, orders, analytics, employees, inventory };
};

const buildClientsSection = (data: Awaited<ReturnType<typeof fetchRangeData>>): SectionPayload => {
  const userMap = new Map(
    (data.users ?? []).flatMap((user) => {
      if (!user || !user.id) return [];
      return [
        [
          user.id,
          {
            ...user,
            displayName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
          },
        ],
      ];
    })
  );
  const customerMap = new Map<string, { orders: number; reservations: number; spent: number }>();
  data.orders.forEach((order) => {
    if (!order.userId) return;
    const entry = customerMap.get(order.userId) ?? { orders: 0, reservations: 0, spent: 0 };
    entry.orders += 1;
    entry.spent += toNumber(order.total);
    customerMap.set(order.userId, entry);
  });
  data.reservations.forEach((reservation) => {
    if (!reservation.userId) return;
    const entry = customerMap.get(reservation.userId) ?? { orders: 0, reservations: 0, spent: 0 };
    entry.reservations += 1;
    customerMap.set(reservation.userId, entry);
  });
  const sortedCustomers = Array.from(customerMap.entries())
    .map(([userId, stats]) => ({
      userId,
      ...stats,
      totalInteractions: stats.orders + stats.reservations,
      spent: Number(stats.spent.toFixed(2)),
      user: userMap.get(userId),
    }))
    .sort((a, b) => b.totalInteractions - a.totalInteractions);
  const topCustomers = sortedCustomers.slice(0, 5);
  const totalCustomers = customerMap.size;
  const totalSpentAll = Array.from(customerMap.values()).reduce((sum, stats) => sum + stats.spent, 0);
  const averageSpentAll = totalCustomers ? totalSpentAll / totalCustomers : 0;
  const loyaltyMap = data.loyaltyPunches ?? new Map<string, number>();
  const loyaltyParticipants = loyaltyMap.size;
  let loyaltyCompletedUsers = 0;
  let loyaltyProgramCompletions = 0;
  const stageCounts = new Map<number, number>();
  loyaltyMap.forEach((punches) => {
    const completions = Math.floor(punches / 6);
    const stage = punches % 6;
    if (completions > 0) {
      loyaltyCompletedUsers += 1;
      loyaltyProgramCompletions += completions;
    }
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
  });
  const mostCommonStageEntry = Array.from(stageCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const mostCommonStageLabel =
    typeof mostCommonStageEntry?.[0] === 'number'
      ? mostCommonStageEntry[0] === 0
        ? 'Sin avances'
        : `${mostCommonStageEntry[0]} sello${mostCommonStageEntry[0] === 1 ? '' : 's'}`
      : null;
  const timeByUser = new Map<string, number>();
  data.pageAnalytics.forEach((entry) => {
    const key = entry.userId ?? 'desconocido';
    timeByUser.set(key, (timeByUser.get(key) ?? 0) + toNumber(entry.timeOnPage));
  });
  const averagePerUserSeconds = timeByUser.size
    ? Array.from(timeByUser.values()).reduce((sum, value) => sum + value, 0) / timeByUser.size
    : 0;
  const averageTimePerUserLabel = formatMinutesSeconds(averagePerUserSeconds);
  const cards: MetricCard[] = [
    { label: 'Clientes activos', value: totalCustomers },
    { label: 'Promedio gasto (todos)', value: `$${averageSpentAll.toFixed(2)}` },
    { label: 'Tiempo promedio por usuario', value: averageTimePerUserLabel },
    { label: 'Clientes en lealtad', value: loyaltyParticipants },
    {
      label: 'Programas completados',
      value: loyaltyProgramCompletions,
      hint: loyaltyCompletedUsers ? `${loyaltyCompletedUsers} clientes` : undefined,
    },
  ];
  const bars: ChartBar[] = topCustomers.map((entry) => {
    const labelSource = entry.user?.displayName || entry.user?.clientId || entry.userId;
    return { label: labelSource, value: entry.totalInteractions, secondary: Number(entry.spent.toFixed(2)) };
  });
  const table: SectionTable = {
    columns: ['#', 'Nombre', 'Apellido', 'ID', 'Pedidos', 'Reservas', 'Interacciones', 'Gastado'],
    rows: sortedCustomers.map((entry, index) => ({
      '#': index + 1,
      Nombre: entry.user?.firstName ?? '—',
      Apellido: entry.user?.lastName ?? '—',
      ID: entry.user?.clientId ?? entry.userId,
      Pedidos: entry.orders,
      Reservas: entry.reservations,
      Interacciones: entry.totalInteractions,
      Gastado: entry.spent,
    })),
  };
  const hasData = Boolean(totalCustomers || data.pageAnalytics.length);
  if (!hasData) {
    return buildEmptySection(sectionTitles.clients);
  }
  return {
    title: sectionTitles.clients,
    hasData,
    cards,
    bars,
    table,
    message: mostCommonStageLabel ? `Etapa más común: ${mostCommonStageLabel}` : undefined,
  };
};

const buildSalesSection = (data: Awaited<ReturnType<typeof fetchRangeData>>): SectionPayload => {
  const completedOrders = data.orders.filter((order) => order.status === 'completed');
  const completedIds = new Set(completedOrders.map((order) => order.id));
  const salesTotal = completedOrders.reduce((sum, order) => sum + toNumber(order.total), 0);
  const avgTicket = completedOrders.length ? salesTotal / completedOrders.length : 0;
  const dailyMap = new Map<string, number>();
  completedOrders.forEach((order) => {
    const day = new Date(order.createdAt).toLocaleDateString('es-MX', { month: 'short', day: '2-digit' });
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + toNumber(order.total));
  });
  const dailySalesEntries = Array.from(dailyMap.entries()).map(([label, value]) => ({
    label,
    value: Number(value.toFixed(2)),
  }));
  const bars: ChartBar[] = dailySalesEntries.slice(0, 5);
  const topProductMap = new Map<string, { name: string; count: number; revenue: number }>();
  data.orderItems.forEach((item) => {
    if (!completedIds.has(item.orderId)) return;
    const productId = item.productId ?? item.id;
    const entry = topProductMap.get(productId) ?? { name: productId, count: 0, revenue: 0 };
    entry.count += toNumber(item.quantity);
    entry.revenue += toNumber(item.price) * toNumber(item.quantity);
    topProductMap.set(productId, entry);
  });
  const productEntries = Array.from(topProductMap.values()).sort((a, b) => b.count - a.count);
  const topProducts = productEntries.slice(0, 5);
  const beverageTemperatureCounts = data.orders.reduce(
    (acc, order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      items.forEach((item) => {
        const bucket = classifyBeverageTemperature(item);
        if (!bucket) return;
        const quantity =
          typeof item?.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
        acc[bucket] = (acc[bucket] ?? 0) + quantity;
      });
      return acc;
    },
    { cold: 0, hot: 0 }
  );
  const cards: MetricCard[] = [
    { label: 'Ventas totales', value: `$${salesTotal.toFixed(2)}` },
    { label: 'Ticket promedio', value: `$${avgTicket.toFixed(2)}` },
    { label: 'Pedidos completados', value: completedOrders.length },
  ];
  if (beverageTemperatureCounts.cold > 0 || beverageTemperatureCounts.hot > 0) {
    cards.push({ label: 'Bebidas frías', value: beverageTemperatureCounts.cold });
    cards.push({ label: 'Bebidas calientes', value: beverageTemperatureCounts.hot });
  }
  const table: SectionTable = {
    columns: ['#', 'Producto', 'Cantidad', 'Ingresos'],
    rows: productEntries.map((product, index) => ({
      '#': index + 1,
      Producto: product.name,
      Cantidad: product.count,
      Ingresos: Number(product.revenue.toFixed(2)),
    })),
  };
  const hasData = Boolean(data.orders.length);
  return hasData
    ? { title: sectionTitles.sales, hasData, cards, bars, table }
    : buildEmptySection(sectionTitles.sales);
};

const buildPaymentsSection = (data: Awaited<ReturnType<typeof fetchRangeData>>): SectionPayload => {
  const methodMap = new Map<string, { amount: number; tips: number }>();
  const completedOrders = data.orders.filter((order) => order.status === 'completed');
  let totalTips = 0;
  let avgTipPercent = 0;
  let processedCount = 0;

  if (completedOrders.length) {
    completedOrders.forEach((order) => {
      const method = (order.queuedPaymentMethod ?? 'sin método').toLowerCase();
      const entry = methodMap.get(method) ?? { amount: 0, tips: 0 };
      entry.amount += toNumber(order.total);
      entry.tips += toNumber(order.tipAmount);
      methodMap.set(method, entry);
    });
    totalTips = completedOrders.reduce((sum, order) => sum + toNumber(order.tipAmount), 0);
    avgTipPercent = completedOrders.length
      ? completedOrders.reduce((sum, order) => sum + toNumber(order.tipPercent), 0) / completedOrders.length
      : 0;
    processedCount = completedOrders.length;
  } else {
    data.payments.forEach((payment) => {
      const method = (payment.method ?? 'otro').toLowerCase();
      const entry = methodMap.get(method) ?? { amount: 0, tips: 0 };
      entry.amount += toNumber(payment.amount);
      entry.tips += toNumber(payment.tipAmount);
      methodMap.set(method, entry);
    });
    totalTips = data.payments.reduce((sum, payment) => sum + toNumber(payment.tipAmount), 0);
    avgTipPercent = data.payments.length
      ? data.payments.reduce((sum, payment) => sum + toNumber(payment.tipPercent), 0) / data.payments.length
      : 0;
    processedCount = data.payments.length;
  }

  const methodRows = Array.from(methodMap.entries())
    .map(([method, entry]) => ({
      label: method,
      amount: Number(entry.amount.toFixed(2)),
      tips: Number(entry.tips.toFixed(2)),
    }))
    .sort((a, b) => b.amount - a.amount);
  const bars: ChartBar[] = methodRows.slice(0, 5).map((entry) => ({
    label: entry.label,
    value: entry.amount,
    secondary: entry.tips,
  }));
  const table: SectionTable = {
    columns: ['#', 'Método', 'Monto', 'Propinas'],
    rows: methodRows.map((entry, index) => ({
      '#': index + 1,
      Método: entry.label,
      Monto: entry.amount,
      Propinas: entry.tips,
    })),
  };
  const cards: MetricCard[] = [
    { label: 'Propinas totales', value: `$${totalTips.toFixed(2)}` },
    { label: 'Promedio % propinas', value: `${avgTipPercent.toFixed(1)}%` },
    { label: 'Pagos procesados', value: processedCount },
  ];
  const hasData = Boolean(methodMap.size);
  return hasData
    ? { title: sectionTitles.payments, hasData, cards, bars, table }
    : buildEmptySection(sectionTitles.payments);
};

const buildOrdersSection = (data: Awaited<ReturnType<typeof fetchRangeData>>): SectionPayload => {
  const statusCounts = data.orders.reduce(
    (acc, order) => acc.set(order.status, (acc.get(order.status) ?? 0) + 1),
    new Map<string, number>()
  );
  const reservationStatus = data.reservations.reduce(
    (acc, reservation) => acc.set(reservation.status, (acc.get(reservation.status) ?? 0) + 1),
    new Map<string, number>()
  );
  const bars: ChartBar[] = Array.from(statusCounts.entries()).map(([label, value]) => ({ label: `Pedido ${label}`, value }));
  reservationStatus.forEach((value, label) => {
    bars.push({ label: `Reserva ${label}`, value });
  });
  const orderHours = new Map<string, number>();
  data.orders.forEach((order) => {
    const bucket = hourBucket(order.createdAt);
    orderHours.set(bucket, (orderHours.get(bucket) ?? 0) + 1);
  });
  const classifyPrefix = (identifier?: string | null) => {
    if (!identifier) return 'other';
    const normalized = identifier.trim().toUpperCase();
    if (normalized.startsWith('C')) return 'client';
    if (normalized.startsWith('XL')) return 'pos';
    return 'other';
  };
  const orderOrigin = data.orders.reduce(
    (acc, order) => {
      const key = classifyPrefix(order.orderNumber ?? order.id);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    { client: 0, pos: 0, other: 0 }
  );
  const reservationOrigin = data.reservations.reduce(
    (acc, reservation) => {
      const key = classifyPrefix(reservation.reservationCode ?? reservation.id);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    { client: 0, pos: 0, other: 0 }
  );
  const cards: MetricCard[] = [
    { label: 'Pedidos totales', value: data.orders.length },
    { label: 'Reservas totales', value: data.reservations.length },
    { label: 'Horas pico', value: Array.from(orderHours.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Sin datos' },
    {
      label: 'Origen pedidos',
      value: `Clientes: ${orderOrigin.client} · POS: ${orderOrigin.pos}`,
      hint: orderOrigin.other ? `Otros: ${orderOrigin.other}` : undefined,
    },
  ];
  const table: SectionTable = {
    columns: ['#', 'Tipo', 'Pendientes', 'Completados', 'Cancelados'],
    rows: [
      {
        '#': 1,
        Tipo: 'Pedidos',
        Pendientes: statusCounts.get('pending') ?? 0,
        Completados: statusCounts.get('completed') ?? 0,
        Cancelados: statusCounts.get('cancelled') ?? 0,
      },
      {
        '#': 2,
        Tipo: 'Reservas',
        Pendientes: reservationStatus.get('pending') ?? 0,
        Completados: reservationStatus.get('completed') ?? 0,
        Cancelados: reservationStatus.get('cancelled') ?? 0,
      },
    ],
  };
  const extraTables = [
    {
      title: 'Detalle por prefijo',
      table: {
        columns: ['Tipo', 'Pedidos', 'Reservas'],
        rows: [
          { Tipo: 'Clientes (C-)', Pedidos: orderOrigin.client, Reservas: reservationOrigin.client },
          { Tipo: 'POS (XL-)', Pedidos: orderOrigin.pos, Reservas: reservationOrigin.pos },
          { Tipo: 'Otros', Pedidos: orderOrigin.other, Reservas: reservationOrigin.other },
        ],
      },
    },
  ];
  const hasData = Boolean(data.orders.length || data.reservations.length);
  return hasData
    ? { title: sectionTitles.orders, hasData, cards, bars, table, extraTables }
    : buildEmptySection(sectionTitles.orders);
};

const buildPassiveAnalyticsSection = (data: Awaited<ReturnType<typeof fetchRangeData>>): SectionPayload => {
  const analyticsEntries = data.pageAnalytics;
  if (!analyticsEntries.length) {
    return buildEmptySection(sectionTitles.analytics);
  }
  const sessionsByUser = new Map<string, typeof analyticsEntries>();
  analyticsEntries.forEach((entry) => {
    const key = entry.userId ?? `anon-${entry.id}`;
    const list = sessionsByUser.get(key) ?? [];
    list.push(entry);
    sessionsByUser.set(key, list);
  });
  const transitions = new Map<string, number>();
  sessionsByUser.forEach((entries) => {
    entries.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });
    for (let index = 0; index < entries.length - 1; index += 1) {
      const fromPath = entries[index].pagePath ?? 'Desconocido';
      const toPath = entries[index + 1].pagePath ?? 'Desconocido';
      const key = `${fromPath} -> ${toPath}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
    }
  });
  const transitionsList = Array.from(transitions.entries())
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count);
  const topPagesMap = new Map<string, number>();
  analyticsEntries.forEach((entry) => {
    const path = entry.pagePath ?? 'Desconocido';
    topPagesMap.set(path, (topPagesMap.get(path) ?? 0) + 1);
  });
  const topPages = Array.from(topPagesMap.entries())
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views);
  const deviceMap = new Map<string, number>();
  const browserMap = new Map<string, number>();
  const osMap = new Map<string, number>();
  analyticsEntries.forEach((entry) => {
    const device = deviceFromUserAgent(entry.userAgent);
    deviceMap.set(device, (deviceMap.get(device) ?? 0) + 1);
    const browser = browserFromUserAgent(entry.userAgent);
    browserMap.set(browser, (browserMap.get(browser) ?? 0) + 1);
    const os = osFromUserAgent(entry.userAgent);
    osMap.set(os, (osMap.get(os) ?? 0) + 1);
  });
  const cards: MetricCard[] = [
    { label: 'Sesiones registradas', value: analyticsEntries.length },
    { label: 'Usuarios con actividad', value: sessionsByUser.size },
    {
      label: 'Ruta más visitada',
      value: topPages[0]?.path ?? 'Sin datos',
      hint: topPages[0] ? `${topPages[0].views} vistas` : undefined,
    },
  ];
  const bars: ChartBar[] = transitionsList.slice(0, 5).map((entry) => ({
    label: entry.route,
    value: entry.count,
  }));
  const table: SectionTable = {
    columns: ['#', 'Desde', 'Hacia', 'Frecuencia'],
    rows: transitionsList.map((entry, index) => {
      const [from, to] = entry.route.split(' -> ');
      return {
        '#': index + 1,
        Desde: from,
        Hacia: to,
        Frecuencia: entry.count,
      };
    }),
  };
  const topPagesTable: SectionTable = {
    columns: ['#', 'Ruta', 'Vistas'],
    rows: topPages.map((entry, index) => ({
      '#': index + 1,
      Ruta: entry.path,
      Vistas: entry.views,
    })),
  };
  const deviceTable: SectionTable = {
    columns: ['#', 'Dispositivo', 'Sesiones'],
    rows: Array.from(deviceMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([device, sessions], index) => ({
        '#': index + 1,
        Dispositivo: device,
        Sesiones: sessions,
      }))
      .slice(0, 5),
  };
  const browserTable: SectionTable = {
    columns: ['#', 'Navegador', 'Sesiones'],
    rows: Array.from(browserMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([browser, sessions], index) => ({
        '#': index + 1,
        Navegador: browser,
        Sesiones: sessions,
      }))
      .slice(0, 5),
  };
  const osTable: SectionTable = {
    columns: ['#', 'Sistema operativo', 'Sesiones'],
    rows: Array.from(osMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([os, sessions], index) => ({
        '#': index + 1,
        'Sistema operativo': os,
        Sesiones: sessions,
      }))
      .slice(0, 5),
  };
  return {
    title: sectionTitles.analytics,
    hasData: true,
    cards,
    bars,
    table,
    extraTables: [
      { title: 'Rutas más visitadas', table: topPagesTable },
      { title: 'Dispositivos más usados', table: deviceTable },
      { title: 'Navegadores principales', table: browserTable },
      { title: 'Sistemas operativos', table: osTable },
    ],
  };
};

const buildEmployeesSection = (data: Awaited<ReturnType<typeof fetchRangeData>>): SectionPayload => {
  const visibleStaff = (data.staff ?? [])
    .filter((member): member is NonNullable<RawUserRecord> => member !== null && member !== undefined)
    .filter((member) => typeof member.role === 'string' && member.role.toLowerCase() !== 'superuser');
  const staffMap = new Map(
    visibleStaff
      .filter((member): member is NonNullable<RawUserRecord> & { id: string; role: string } => Boolean(member) && typeof member.role === 'string' && typeof member.id === 'string')
      .map((member) => [
        member.id,
        {
          ...member,
          displayName: `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim(),
          originalId: member.id,
        },
      ])
  );

  const sessionStats = new Map<
    string,
    {
      duration: number;
      sessions: number;
      deviceCounts: Map<string, number>;
      osCounts: Map<string, number>;
      dayCounts: Map<string, number>;
    }
  >();
  data.staffSessions.forEach((session) => {
    const staffId = session.staffId;
    const member = staffId ? staffMap.get(staffId) : null;
    if (member && typeof member.role === 'string' && member.role.toLowerCase() === 'superuser') return;
    const key = staffId ?? session.staffId ?? session.id ?? '';
    if (!key) return;
    const entry = sessionStats.get(key) ?? {
      duration: 0,
      sessions: 0,
      deviceCounts: new Map<string, number>(),
      osCounts: new Map<string, number>(),
      dayCounts: new Map<string, number>(),
    };
    entry.duration += session.durationSeconds ?? durationSeconds(session.sessionStart, session.sessionEnd);
    entry.sessions += 1;
    const device =
      (session as { deviceType?: string }).deviceType ??
      session.browser ??
      deviceFromUserAgent(session.userAgent);
    entry.deviceCounts.set(device, (entry.deviceCounts.get(device) ?? 0) + 1);
    const osLabel = osFromUserAgent(session.userAgent);
    entry.osCounts.set(osLabel, (entry.osCounts.get(osLabel) ?? 0) + 1);
    const dayLabel = session.sessionStart
      ? new Date(session.sessionStart).toLocaleDateString('es-MX', { weekday: 'long' })
      : 'Desconocido';
    entry.dayCounts.set(dayLabel, (entry.dayCounts.get(dayLabel) ?? 0) + 1);
    sessionStats.set(key, entry);
  });

  const sessionDurations = Array.from(sessionStats.values()).map((entry) => entry.duration);
  const avgSession = Math.round(average(sessionDurations));

  const tasksByStaff = new Map<string, { completed: number; avgTime: number[] }>();
  data.prepQueue.forEach((task) => {
    if (!task.handledByStaffId || task.status !== 'completed') return;
    const assignedStaff = staffMap.get(task.handledByStaffId);
    if (assignedStaff && (assignedStaff.role ?? '').toLowerCase() === 'superuser') {
      return;
    }
    const entry = tasksByStaff.get(task.handledByStaffId) ?? { completed: 0, avgTime: [] };
    entry.completed += 1;
    entry.avgTime.push(durationSeconds(task.createdAt, task.completedAt));
    tasksByStaff.set(task.handledByStaffId, entry);
  });
  const topStaff = Array.from(tasksByStaff.entries())
    .map(([staffId, stats]) => ({
      staffId,
      completed: stats.completed,
      avgSeconds: Math.round(average(stats.avgTime)),
    }))
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 5);
  const avgSessionDisplay =
    avgSession >= 3600
      ? `${(avgSession / 3600).toFixed(1)} h`
      : `${Math.max(avgSession / 60, 0).toFixed(1)} min`;
  const cards: MetricCard[] = [
    { label: 'Sesiones registradas', value: data.staffSessions.length },
    { label: 'Duración media sesión', value: avgSessionDisplay },
    { label: 'Pedidos completados (cola)', value: topStaff.reduce((sum, staff) => sum + staff.completed, 0) },
  ];
  const bars: ChartBar[] = topStaff.map((staff) => {
    const member = staffMap.get(staff.staffId);
    const labelSource = member?.displayName || member?.email || staff.staffId;
    return { label: labelSource, value: staff.completed, secondary: staff.avgSeconds };
  });

  const staffRows = Array.from(staffMap.values())
    .map((member) => {
      const stats = sessionStats.get((member.originalId as string) ?? member.id ?? '') ?? {
        duration: 0,
        sessions: 0,
        deviceCounts: new Map<string, number>(),
        osCounts: new Map<string, number>(),
        dayCounts: new Map<string, number>(),
      };
      const durationHoursRaw = stats.duration / 3600;
      const durationHoursLabel =
        durationHoursRaw >= 1 ? durationHoursRaw.toFixed(1) : durationHoursRaw.toFixed(2);
      const avgHoursRaw = stats.sessions ? stats.duration / stats.sessions / 3600 : 0;
      const avgHoursLabel = avgHoursRaw >= 1 ? avgHoursRaw.toFixed(1) : avgHoursRaw.toFixed(2);
      const primaryDevice =
        Array.from(stats.deviceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Desconocido';
      const primaryOs =
        Array.from(stats.osCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Desconocido';
      const topDay =
        Array.from(stats.dayCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Sin registro';
      const cleaningKey = member.email?.toLowerCase() ?? '';
      const cleaningCount = CLEANING_COMPLETION_COUNTS[cleaningKey] ?? 0;
      const completedOrders = tasksByStaff.get(member.id ?? '')?.completed ?? 0;
      return {
        sortMetric: durationHoursRaw,
        row: {
          Nombre: member.displayName || member.email || member.id,
          Rol: member.role ?? '—',
          Sesiones: stats.sessions,
          'Tiempo total (h)': durationHoursLabel,
          'Tiempo promedio (h)': avgHoursLabel,
          'Día fuerte': topDay,
          'Pedidos completados': completedOrders,
          'Dispositivo principal': primaryDevice,
          'Sistema operativo': primaryOs,
          'Limpiezas completadas': cleaningCount,
        },
      };
    })
    .sort((a, b) => b.sortMetric - a.sortMetric)
    .map((entry, index) => ({ '#': index + 1, ...entry.row }));

  const table: SectionTable = {
    columns: [
      '#',
      'Nombre',
      'Rol',
      'Sesiones',
      'Tiempo total (h)',
      'Tiempo promedio (h)',
      'Día fuerte',
      'Pedidos completados',
      'Dispositivo principal',
      'Sistema operativo',
      'Limpiezas completadas',
    ],
    rows: staffRows,
  };
  const hasData = Boolean(data.staffSessions.length || data.prepQueue.length || staffRows.length);
  return hasData
    ? { title: sectionTitles.employees, hasData, cards, bars, table }
    : buildEmptySection(sectionTitles.employees);
};

const buildInventorySection = (data: Awaited<ReturnType<typeof fetchRangeData>>): SectionPayload => {
  const spendByItem = new Map<string, { inValue: number; outValue: number }>();
  data.ledger.forEach((entry) => {
    const record = spendByItem.get(entry.itemId) ?? { inValue: 0, outValue: 0 };
    record.inValue += toNumber(entry.inValue);
    record.outValue += toNumber(entry.outValue);
    spendByItem.set(entry.itemId, record);
  });
  const itemMeta = new Map(data.inventoryItems.map((item) => [item.id, item]));
  const restockAlerts = data.inventoryStock
    .map((stock) => {
      const meta = itemMeta.get(stock.itemId);
      if (!meta) return null;
      return {
        id: stock.itemId,
        name: meta.name,
        quantity: toNumber(stock.quantity),
        minStock: meta.minStock ?? 0,
      };
    })
    .filter((entry): entry is { id: string; name: string; quantity: number; minStock: number } => Boolean(entry))
    .filter((entry) => entry.quantity <= entry.minStock)
    .sort((a, b) => a.quantity / Math.max(1, a.minStock) - b.quantity / Math.max(1, b.minStock));
  const cards: MetricCard[] = [
    { label: 'Movimientos registrados', value: data.ledger.length },
    { label: 'Ítems con alerta', value: restockAlerts.length },
    { label: 'Consumos registrados', value: Array.from(spendByItem.values()).reduce((sum, entry) => sum + entry.outValue, 0).toFixed(2) },
  ];
  const bars: ChartBar[] = restockAlerts.slice(0, 5).map((entry) => ({
    label: entry.name,
    value: entry.quantity,
    secondary: entry.minStock,
  }));
  const table: SectionTable = {
    columns: ['#', 'Insumo', 'Cantidad', 'Umbral'],
    rows: restockAlerts.map((entry, index) => ({
      '#': index + 1,
      Insumo: entry.name,
      Cantidad: entry.quantity,
      Umbral: entry.minStock,
    })),
  };
  const hasData = Boolean(data.ledger.length || restockAlerts.length);
  return hasData
    ? { title: sectionTitles.inventory, hasData, cards, bars, table }
    : buildEmptySection(sectionTitles.inventory);
};

const buildForecasts = (
  data: Awaited<ReturnType<typeof fetchRangeData>>,
  sinceIso: string,
  untilIso: string
): ForecastPayload => {
  const since = new Date(sinceIso);
  const until = new Date(untilIso);
  const rangeMs = Math.max(until.getTime() - since.getTime(), 1);
  const rangeDays = Math.max(1, Math.round(rangeMs / (1000 * 60 * 60 * 24)));
  const usageMap = new Map<string, { outQty: number }>();
  data.ledger.forEach((entry) => {
    const current = usageMap.get(entry.itemId) ?? { outQty: 0 };
    current.outQty += toNumber(entry.outQty);
    usageMap.set(entry.itemId, current);
  });
  const inventoryMeta = new Map(data.inventoryItems.map((item) => [item.id, item]));
  const restock = data.inventoryStock
    .map((stock): ForecastRestock | null => {
      const meta = inventoryMeta.get(stock.itemId);
      if (!meta) return null;
      const usage = usageMap.get(stock.itemId)?.outQty ?? 0;
      const avgDailyUse = usage / rangeDays;
      const quantity = toNumber(stock.quantity);
      const daysRemaining = avgDailyUse > 0 ? quantity / avgDailyUse : null;
      const nextRestock =
        daysRemaining && Number.isFinite(daysRemaining)
          ? new Date(until.getTime() + daysRemaining * 24 * 60 * 60 * 1000).toISOString()
          : null;
      return {
        id: stock.itemId,
        name: meta.name,
        quantity,
        avgDailyUse: Number(avgDailyUse.toFixed(2)),
        daysRemaining: daysRemaining && Number.isFinite(daysRemaining) ? Number(daysRemaining.toFixed(1)) : null,
        nextRestock,
      };
    })
    .filter((entry): entry is ForecastRestock => Boolean(entry))
    .sort((a, b) => {
      if (a.daysRemaining === null) return 1;
      if (b.daysRemaining === null) return -1;
      return a.daysRemaining - b.daysRemaining;
    })
    .slice(0, 5);

  const completedOrders = data.orders.filter((order) => order.status === 'completed');
  const productUsage = new Map<
    string,
    { name: string; quantity: number; hourBuckets: Map<string, number> }
  >();
  completedOrders.forEach((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    items.forEach((item) => {
      const key = item?.productId ?? item?.id ?? item?.name ?? 'producto';
      const name = (item?.name ?? key)?.toString() ?? key;
      const entry = productUsage.get(key) ?? { name, quantity: 0, hourBuckets: new Map<string, number>() };
      const qty = Number(item?.quantity ?? 1);
      entry.quantity += Number.isFinite(qty) ? qty : 1;
      const hour = hourBucket(order.createdAt);
      entry.hourBuckets.set(hour, (entry.hourBuckets.get(hour) ?? 0) + 1);
      productUsage.set(key, entry);
    });
  });
  const production = Array.from(productUsage.entries())
    .map(([id, entry]) => {
      const dailyAverage = entry.quantity / rangeDays;
      const weeklyDemand = dailyAverage * 7;
      const peakHour =
        Array.from(entry.hourBuckets.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Sin hora';
      return {
        id,
        name: entry.name,
        dailyAverage: Number(dailyAverage.toFixed(2)),
        weeklyDemand: Number(weeklyDemand.toFixed(2)),
        peakHour,
      };
    })
    .sort((a, b) => b.weeklyDemand - a.weeklyDemand)
    .slice(0, 5);

  const dailySales = new Map<string, { revenue: number; orders: number }>();
  const branchMap = new Map<string, Map<string, number>>();
  completedOrders.forEach((order) => {
    const key = new Date(order.createdAt).toISOString().slice(0, 10);
    const entry = dailySales.get(key) ?? { revenue: 0, orders: 0 };
    entry.revenue += toNumber(order.total);
    entry.orders += 1;
    dailySales.set(key, entry);

    const branch =
      (order as { branchId?: string | null }).branchId ??
      (order as { branch?: string | null }).branch ??
      order.sourceType ??
      'POS';
    let branchSeries = branchMap.get(branch);
    if (!branchSeries) {
      branchSeries = new Map<string, number>();
      branchMap.set(branch, branchSeries);
    }
    branchSeries.set(key, (branchSeries.get(key) ?? 0) + toNumber(order.total));
  });
  const dailyEntries = Array.from(dailySales.entries());
  const avgDailyRevenue = dailyEntries.length
    ? dailyEntries.reduce((sum, entry) => sum + entry[1].revenue, 0) / dailyEntries.length
    : 0;
  const avgDailyOrders = dailyEntries.length
    ? dailyEntries.reduce((sum, entry) => sum + entry[1].orders, 0) / dailyEntries.length
    : 0;
  const busiestDayEntry = dailyEntries.slice().sort((a, b) => b[1].revenue - a[1].revenue)[0];
  const busiestDay = busiestDayEntry?.[0] ?? 'Sin datos';

  const dayHourMap = new Map<string, { day: string; hour: string; count: number }>();
  completedOrders.forEach((order) => {
    const date = order.createdAt ? new Date(order.createdAt) : null;
    const dayLabel = date
      ? date.toLocaleDateString('es-MX', { weekday: 'long' })
      : 'Sin fecha';
    const hourLabel = hourBucket(order.createdAt);
    const key = `${dayLabel}|${hourLabel}`;
    const entry = dayHourMap.get(key) ?? { day: dayLabel, hour: hourLabel, count: 0 };
    entry.count += 1;
    dayHourMap.set(key, entry);
  });
  const topActivity = Array.from(dayHourMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const salesWindows: ForecastSummary[] = [
    { label: 'Proyección a 7 días', days: 7 },
    { label: 'Proyección a 14 días', days: 14 },
    { label: 'Proyección a 31 días', days: 31 },
  ].map((window) => ({
    ...window,
    revenue: Number((avgDailyRevenue * window.days).toFixed(2)),
    orders: Math.round(avgDailyOrders * window.days),
    busiestDay,
    topActivity,
  }));

  const branchDemand = Array.from(branchMap.entries()).map(([branch, series]) => ({
    branch,
    points: Array.from(series.entries())
      .map(([date, revenue]) => ({ date, revenue: Number(revenue.toFixed(2)) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }));

  return {
    restock,
    production,
    salesWindows,
    branchDemand,
  };
};

const buildClusterChart = (
  entries: Array<{ orders: number; spent: number }>,
  limit = 60
): MarketingSegment['chart'] => {
  if (!entries.length) {
    return {
      points: [],
      centroid: { orders: 0, spent: 0 },
    };
  }

  const points = entries
    .slice(0, limit)
    .map((entry) => ({ orders: entry.orders, spent: Number(entry.spent.toFixed(2)) }));
  const avgOrders = Number((entries.reduce((sum, entry) => sum + entry.orders, 0) / entries.length).toFixed(2));
  const avgSpent = Number((entries.reduce((sum, entry) => sum + entry.spent, 0) / entries.length).toFixed(2));

  return {
    points,
    centroid: { orders: avgOrders, spent: avgSpent },
  };
};

const buildMarketingInsights = (data: Awaited<ReturnType<typeof fetchRangeData>>): MarketingInsights => {
  const orders = data.orders ?? [];
  const reservations = data.reservations ?? [];
  const totalTransactions = orders.length + reservations.length || 1;

  const customerStats = new Map<
    string,
    { orders: number; spent: number; avgTicket: number }
  >();
  orders.forEach((order) => {
    if (!order.userId) return;
    const entry = customerStats.get(order.userId) ?? { orders: 0, spent: 0, avgTicket: 0 };
    entry.orders += 1;
    entry.spent += toNumber(order.total);
    customerStats.set(order.userId, entry);
  });
  const customerArray = Array.from(customerStats.values()).map((entry) => ({
    ...entry,
    avgTicket: entry.orders ? entry.spent / entry.orders : 0,
  }));
  const highValue = customerArray.filter((entry) => entry.spent >= 800 || entry.orders >= 12);
  const routine = customerArray.filter((entry) => entry.spent >= 300 && entry.spent < 800);
  const occasional = customerArray.filter((entry) => entry.spent < 300);
  const salesClusters: MarketingSegment[] = [
    {
      name: 'Cluster K1 · Alta frecuencia',
      description: 'Simulación k-means: clientes con >12 órdenes o >$800 MXN.',
      count: highValue.length,
      avgTicket: Number(
        (highValue.reduce((sum, entry) => sum + entry.avgTicket, 0) / Math.max(highValue.length, 1)).toFixed(2)
      ),
      chart: buildClusterChart(highValue),
    },
    {
      name: 'Cluster K2 · Recurrentes',
      description: 'Visitan 4-11 veces, buen objetivo de upselling.',
      count: routine.length,
      avgTicket: Number(
        (routine.reduce((sum, entry) => sum + entry.avgTicket, 0) / Math.max(routine.length, 1)).toFixed(2)
      ),
      chart: buildClusterChart(routine),
    },
    {
      name: 'Cluster K3 · Esporádicos',
      description: 'Primeras visitas; requieren campañas de onboarding.',
      count: occasional.length,
      avgTicket: Number(
        (occasional.reduce((sum, entry) => sum + entry.avgTicket, 0) / Math.max(occasional.length, 1)).toFixed(2)
      ),
      chart: buildClusterChart(occasional),
    },
  ];

  const productTotals = new Map<string, { name: string; count: number }>();
  data.orderItems.forEach((item) => {
    const id = item.productId ?? item.id ?? 'producto';
    const label = typeof (item as { name?: string }).name === 'string' ? (item as { name?: string }).name! : id;
    const entry = productTotals.get(id) ?? { name: label, count: 0 };
    entry.count += Number(item.quantity ?? 1);
    productTotals.set(id, entry);
  });
  const productSuggestions: MarketingSuggestion[] = Array.from(productTotals.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((entry) => ({
      product: entry.name,
      reason: `Aparece en ${entry.count} tickets · sugerido para paquetes.`,
    }));

  const dayHourMap = new Map<string, ForecastActivity>();
  orders.forEach((order) => {
    const date = order.createdAt ? new Date(order.createdAt) : null;
    const dayLabel = date ? date.toLocaleDateString('es-MX', { weekday: 'long' }) : 'Sin fecha';
    const hourLabel = hourBucket(order.createdAt);
    const key = `${dayLabel}|${hourLabel}`;
    const entry = dayHourMap.get(key) ?? { day: dayLabel, hour: hourLabel, count: 0 };
    entry.count += 1;
    dayHourMap.set(key, entry);
  });
  const bestHours = Array.from(dayHourMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const posOrdersCount = orders.filter((order) => isPublicSaleOrder(order)).length;
  const customerOrdersCount = orders.length - posOrdersCount;
  const reservationCount = reservations.length;
  const deliveryCount = orders.filter((order) => (order.sourceType ?? '').toLowerCase() === 'delivery').length;
  const orderInference: MarketingOrderInference[] = [
    {
      type: 'POS · Venta pública',
      probability: Number(((posOrdersCount / totalTransactions) * 100).toFixed(1)),
      drivers: 'Tickets sin cliente identificado; flujo de mostrador.',
    },
    {
      type: 'POS · Cliente identificado',
      probability: Number(((customerOrdersCount / totalTransactions) * 100).toFixed(1)),
      drivers: 'Pedidos con cliente o ID lealtad asignado.',
    },
    {
      type: 'Reservaciones',
      probability: Number(((reservationCount / totalTransactions) * 100).toFixed(1)),
      drivers: 'Reservas confirmadas; recomienda recordatorios.',
    },
    {
      type: 'Delivery',
      probability: Number(((deliveryCount / totalTransactions) * 100).toFixed(1)),
      drivers: 'Órdenes con sourceType "delivery"; ajustar empaques.',
    },
  ];

  const sessionMap = new Map<string, typeof data.pageAnalytics>();
  data.pageAnalytics.forEach((entry) => {
    const key = entry.userId ?? `anon-${entry.id}`;
    const list = sessionMap.get(key) ?? [];
    list.push(entry);
    sessionMap.set(key, list);
  });
  const transitions = new Map<string, number>();
  sessionMap.forEach((entries) => {
    entries.sort((a, b) => {
      const aTs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aTs - bTs;
    });
    for (let index = 0; index < entries.length - 1; index += 1) {
      const from = entries[index].pagePath ?? 'Desconocido';
      const to = entries[index + 1].pagePath ?? 'Desconocido';
      const key = `${from} -> ${to}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
    }
  });
  const totalTransitions = Array.from(transitions.values()).reduce((sum, value) => sum + value, 0) || 1;
  const landingMarkov: MarketingMarkov[] = Array.from(transitions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => {
      const [from, to] = key.split(' -> ');
      return {
        from,
        to,
        probability: Number(((count / totalTransitions) * 100).toFixed(2)),
      };
    });

  const itemMeta = new Map(data.inventoryItems.map((item) => [item.id, item]));
  const inventoryBayesian: MarketingInventoryInsight[] = data.inventoryStock
    .map((stock) => {
      const meta = itemMeta.get(stock.itemId);
      if (!meta) return null;
      const ratio =
        meta.minStock && meta.minStock > 0 ? toNumber(stock.quantity) / meta.minStock : Number.POSITIVE_INFINITY;
      const risk =
        ratio === Number.POSITIVE_INFINITY
          ? 'Baja'
          : ratio <= 0.5
            ? 'Alta'
            : ratio <= 1
              ? 'Media'
              : 'Baja';
      const recommendation =
        risk === 'Alta'
          ? 'Reordenar (inferencia bayesiana simulada por consumo).'
          : risk === 'Media'
            ? 'Monitorear; ajustar orden semanal.'
            : 'Stock saludable.';
      return {
        item: meta.name,
        risk,
        recommendation,
      };
    })
    .filter((entry): entry is MarketingInventoryInsight => Boolean(entry))
    .slice(0, 5);

  const hourStats = new Map<string, number>();
  orders.forEach((order) => {
    const bucket = hourBucket(order.createdAt);
    hourStats.set(bucket, (hourStats.get(bucket) ?? 0) + 1);
  });
  const counts = Array.from(hourStats.values());
  const mean = counts.length ? counts.reduce((sum, value) => sum + value, 0) / counts.length : 0;
  const variance =
    counts.length > 1
      ? counts.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (counts.length - 1)
      : 0;
  const stdDev = Math.sqrt(Math.max(variance, 0));
  const anomalies: MarketingAnomaly[] = Array.from(hourStats.entries())
    .filter(([_, value]) => value >= mean + 2 * stdDev || value <= Math.max(mean - 2 * stdDev, 0))
    .map(([hour, value]) => ({
      label: `Anomalía en ${hour}`,
      description:
        value >= mean + 2 * stdDev
          ? `Demanda inusualmente ALTA (${value} pedidos).`
          : `Demanda MUY BAJA (${value} pedidos) · posible error de captura.`,
    }));

  return {
    salesClusters,
    productSuggestions,
    bestHours,
    orderInference,
    landingMarkov,
    inventoryBayesian,
    anomalies,
  };
};

const EMPTY_FORECASTS: ForecastPayload = {
  restock: [],
  production: [],
  salesWindows: [],
  branchDemand: [],
};

const EMPTY_MARKETING: MarketingInsights = {
  salesClusters: [],
  productSuggestions: [],
  bestHours: [],
  orderInference: [],
  landingMarkov: [],
  inventoryBayesian: [],
  anomalies: [],
};

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rangeParam = url.searchParams.get('range') ?? undefined;
  const marketingRangeParam = url.searchParams.get('marketing_range') ?? undefined;
  const sectionParam = url.searchParams.get('section') as SectionId | null;
  const exportParam = url.searchParams.get('export') as 'csv' | 'xlsx' | null;
  const monthParamRaw = url.searchParams.get('month');
  const monthParam = monthParamRaw ? monthParamRaw.substring(0, 7) : null;
  const availableMonths = await collectAvailableMonths();
  const selectedMonthInfo =
    monthParam && monthParam.length === 7
      ? availableMonths.find((entry) => entry.month === monthParam) ?? null
      : null;
  const monthMode = Boolean(selectedMonthInfo);
  const resolvedRange = resolveRange(rangeParam);
  let rangeKey: RangeWithMonth = resolvedRange.key;
  let since: Date = resolvedRange.since;
  let until: Date = resolvedRange.until;
  let rangeLabel = RANGE_DEFS[resolvedRange.key].label;
  let selectedMonth: string | null = null;

  if (monthMode && selectedMonthInfo) {
    const { start, end } = resolveMonthRange(selectedMonthInfo.month);
    since = start;
    until = end;
    rangeKey = 'month';
    rangeLabel = selectedMonthInfo.label;
    selectedMonth = selectedMonthInfo.month;
  }

  const sinceIso = toISO(since);
  const untilIso = toISO(until);

  try {
    const earliest = await fetchEarliestTimestamp();
    const rangeAvailability = (Object.keys(RANGE_DEFS) as RangeKey[]).reduce((acc, key) => {
      const { since: testSince } = resolveRange(key);
      acc[key] = !earliest || testSince >= earliest;
      return acc;
    }, {} as Record<RangeKey, boolean>);

    const rangeHasData = monthMode
      ? Boolean(selectedMonthInfo)
      : rangeAvailability[resolvedRange.key];

    const marketingRangeInfo: { key: RangeWithMonth; since: Date; until: Date } = monthMode
      ? { key: 'month', since: new Date(since), until: new Date(until) }
      : marketingRangeParam
        ? resolveRange(marketingRangeParam)
        : { key: rangeKey, since: new Date(since), until: new Date(until) };
    const marketingSinceIso = toISO(marketingRangeInfo.since);
    const marketingUntilIso = toISO(marketingRangeInfo.until);

    const marketingRangeHasData =
      monthMode || marketingRangeInfo.key === 'month'
        ? Boolean(selectedMonthInfo)
        : rangeAvailability[marketingRangeInfo.key];
    let sections: Record<SectionId, SectionPayload> = SECTION_IDS.reduce((acc, id) => {
      acc[id] = buildEmptySection(sectionTitles[id], 'Rango sin datos disponibles.');
      return acc;
    }, {} as Record<SectionId, SectionPayload>);

    let forecasts: ForecastPayload = EMPTY_FORECASTS;
    let marketing: MarketingInsights = EMPTY_MARKETING;
    let baseData: Awaited<ReturnType<typeof fetchRangeData>> | null = null;

    if (rangeHasData) {
      baseData = await fetchRangeData(sinceIso, untilIso);
      sections = computeSections(baseData);
      forecasts = buildForecasts(baseData, sinceIso, untilIso);
    }

    if (marketingRangeHasData) {
      if (marketingRangeInfo.key === rangeKey) {
        const marketingData = baseData ?? (await fetchRangeData(marketingSinceIso, marketingUntilIso));
        marketing = buildMarketingInsights(marketingData);
      } else {
        const marketingData = await fetchRangeData(marketingSinceIso, marketingUntilIso);
        marketing = buildMarketingInsights(marketingData);
      }
    }

    const payload: AdvancedMetricsPayload = {
      range: rangeKey,
      rangeLabel,
      since: sinceIso,
      until: untilIso,
      hasData: rangeHasData,
      rangeAvailability,
      availableMonths,
      selectedMonth,
      sections,
      forecasts,
      marketing,
    };

    if (exportParam && sectionParam) {
      const section = payload.sections[sectionParam];
      const csvContent = buildCsv(section.table);
      const rangeSuffix = selectedMonth ?? rangeKey;
      const filename = `metricas-${sectionParam}-${rangeSuffix}.${exportParam === 'csv' ? 'csv' : 'xlsx'}`;
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': exportParam === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.ms-excel',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    console.error('Error building advanced metrics:', error);
    return NextResponse.json({ success: false, error: 'No pudimos calcular las métricas avanzadas.' }, { status: 500 });
  }
}
