'use client';

import Image from 'next/image';
import { useOrders } from '@/hooks/use-orders';
import { useReservations } from '@/hooks/use-reservations';
import { useLoyalty } from '@/hooks/use-loyalty';
import { usePrepQueue } from '@/hooks/use-prep-queue';
import { usePayments } from '@/hooks/use-payments';
import { useStaff } from '@/hooks/use-staff';
import { usePartnerMetrics } from '@/hooks/use-partner-metrics';
import { useAdvancedMetrics } from '@/hooks/use-advanced-metrics';
import { usePagination } from '@/hooks/use-pagination';
import { OrdersPanel } from '@/components/orders-panel';
import { NewOrderModal } from '@/components/order/new-order-modal';
import { CustomerLoyaltyCoffees } from '@/components/customer-loyalty-coffees';
import { SearchableDropdown } from '@/components/searchable-dropdown';
import { useMenuOptions, type MenuItem } from '@/hooks/use-menu-options';
import { ThemeToggle } from '@/components/theme-toggle';
import type {
  LoyaltyCustomer,
  Order,
  PrepTask,
  Reservation,
  PaymentsDashboard,
  StaffDashboard,
  StaffMember,
  StaffSessionRecord,
  PartnerMetrics,
  AdvancedMetricsSection,
  AdvancedMetricsPayload,
  AdvancedMetricsSectionId,
  ForecastPayload,
  MarketingInsights,
  TicketDetail,
} from '@/lib/api';
import {
  enqueueOrder,
  completeOrder,
  completePrepTask,
  completeReservation,
  cancelReservation,
  fetchTicketDetail,
} from '@/lib/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode, WheelEvent } from 'react';
import { useAuth, type AuthenticatedStaff, type ShiftType, type StaffRole } from '@/providers/auth-provider';
import { encryptSensitiveSnapshot, decryptField } from '@/lib/secure-fields';

declare global {
  interface BarcodeDetectorOptions {
    formats?: string[];
  }

  interface BarcodeDetectorResult {
    rawValue: string;
    format: string;
  }

  interface BarcodeDetectorInstance {
    detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
  }

  interface Window {
    BarcodeDetector?: new (options?: BarcodeDetectorOptions) => BarcodeDetectorInstance;
  }
}

const formatCurrency = (value?: number | null) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value ?? 0);

const formatPercentValue = (value?: number | null, fractionDigits = 1) =>
  `${((value ?? 0) * 100).toFixed(fractionDigits)}%`;

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const getOrderDisplayCode = (order: Order) =>
  order.ticketCode ?? order.orderNumber ?? order.id;

const getMonthStart = () => {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
};

const PAYMENT_METHOD_OPTIONS = [
  { key: 'debito', label: 'Débito' },
  { key: 'credito', label: 'Crédito' },
  { key: 'transferencia', label: 'Transferencia' },
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'cripto', label: 'Cripto' },
] as const;

const PAYMENT_METHOD_LABELS = PAYMENT_METHOD_OPTIONS.reduce<Record<string, string>>((acc, method) => {
  acc[method.key] = method.label;
  return acc;
}, {});

const getPaymentMethodLabel = (method: string) => {
  const normalized = method.toLowerCase();
  const label = PAYMENT_METHOD_LABELS[normalized];
  if (label) {
    return label;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const DAY_MS = 24 * 60 * 60 * 1000;
const paymentMethodAccount = (method: string) => {
  const normalized = method.toLowerCase();
  if (normalized === 'efectivo') {
    return 'Caja general';
  }
  if (normalized === 'cripto') {
    return 'Activo digital';
  }
  if (normalized === 'transferencia' || normalized === 'debito' || normalized === 'credito') {
    return 'Banco';
  }
  return 'Caja/Banco';
};
type OrderPaymentMetricsSummary = {
  sales24h: number;
  tips24h: number;
  monthlyTips: number;
  monthStart: Date;
  hasData: boolean;
  methodTotals: { method: string; amount: number }[];
  entries: Array<{
    id: string;
    date: string;
    reference: string;
    paymentMethod: string;
    debitAccount: string;
    creditAccount: string;
    amount: number;
    tipAmount: number;
  }>;
  tipShare: {
    total: number;
    barista: number;
    manager: number;
  };
};
const groupOrders = (orders: Order[]) => {
  const pending: Order[] = [];
  const past: Order[] = [];
  const completed: Order[] = [];

  orders.forEach((order) => {
    if (order.isHidden) {
      return;
    }
    if (order.status === 'completed') {
      completed.push(order);
      return;
    }
    if (order.status === 'past') {
      past.push(order);
      return;
    }
    pending.push(order);
  });

  return { pending, past, completed };
};

const parseReservationDate = (reservation: Reservation) => {
  if (!reservation?.reservationDate) {
    return null;
  }
  const time = reservation.reservationTime ?? '00:00';
  const isoCandidate = `${reservation.reservationDate}T${time}`;
  const parsed = new Date(isoCandidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const groupReservations = (reservations: Reservation[]) => {
  const now = new Date();
  const pending: Reservation[] = [];
  const past: Reservation[] = [];
  const completed: Reservation[] = [];

  reservations.forEach((reservation) => {
    if (reservation.isHidden) {
      return;
    }
    const status = (reservation.status ?? 'pending').toLowerCase();
    if (status === 'completed') {
      completed.push(reservation);
      return;
    }
    if (status === 'past' || status === 'cancelled') {
      past.push({ ...reservation, status: 'past' });
      return;
    }

    const parsedDate = parseReservationDate(reservation);
    if (parsedDate && parsedDate < now) {
      past.push({ ...reservation, status: 'past' });
      return;
    }

    pending.push({ ...reservation, status: 'pending' });
  });

  return { pending, past, completed };
};

const formatReservationDate = (reservation: Reservation) => {
  if (!reservation.reservationDate) {
    return 'Fecha por definir';
  }

  const parsed = parseReservationDate(reservation);
  if (!parsed) {
    return `${reservation.reservationDate} · ${reservation.reservationTime ?? '--:--'}`;
  }

  return parsed.toLocaleString('es-MX', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

type MaybeCustomer = Order['user'] | Reservation['user'];

const extractCustomerName = (user?: MaybeCustomer | null) => {
  if (!user) {
    return '';
  }

  const first = (user.firstName ?? user.firstNameEncrypted ?? '').trim();
  const last = (user.lastName ?? user.lastNameEncrypted ?? '').trim();
  const combined = `${first} ${last}`.trim();

  if (combined) {
    return combined;
  }

  return user.email?.trim() ?? '';
};

const extractCustomerId = (user?: MaybeCustomer | null, fallbackId?: string | null) =>
  user?.clientId?.trim() || fallbackId || '';

const formatCustomerDisplay = (user?: MaybeCustomer | null, fallbackId?: string | null) => {
  const name = extractCustomerName(user);
  const identifier = extractCustomerId(user, fallbackId);
  if (name && identifier) {
    return `${name} · ${identifier}`;
  }
  return name || identifier || 'Cliente';
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const parseScannedPayload = (payload: string): ScanResult | null => {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isPlainObject(parsed)) {
      return null;
    }
    if (typeof parsed.ticketId === 'string') {
      const ordersPayload =
        isPlainObject(parsed.orders) ? (parsed.orders as { beverages?: unknown; foods?: unknown }) : {};
      const beverages = Array.isArray(ordersPayload.beverages) ? ordersPayload.beverages : [];
      const foods = Array.isArray(ordersPayload.foods) ? ordersPayload.foods : [];
      const entries = [...beverages, ...foods]
        .filter(isPlainObject)
        .map((entry) => {
          const item = entry as Record<string, unknown>;
          return {
            name: typeof item.name === 'string' ? item.name : 'Producto',
            quantity: safeQuantity(item.quantity as number | null | undefined) ?? 1,
            unitPrice:
              typeof item.unitPrice === 'number'
                ? item.unitPrice
                : typeof item.price === 'number'
                  ? item.price
                  : null,
          };
        });
      const rawCustomer = isPlainObject(parsed.customer) ? parsed.customer : null;
      const resolvedTicketClientId =
        typeof parsed.clientId === 'string'
          ? parsed.clientId
          : typeof parsed.customerId === 'string'
            ? parsed.customerId
            : typeof parsed['Id cliente'] === 'string'
              ? (parsed['Id cliente'] as string)
              : typeof rawCustomer?.clientId === 'string'
                ? rawCustomer.clientId
                : null;
      const ticketCustomer = rawCustomer || resolvedTicketClientId
        ? {
            id:
              typeof rawCustomer?.id === 'string'
                ? rawCustomer.id
                : resolvedTicketClientId ?? null,
            clientId:
              typeof rawCustomer?.clientId === 'string'
                ? rawCustomer.clientId
                : resolvedTicketClientId ?? null,
            email:
              typeof rawCustomer?.email === 'string'
                ? rawCustomer.email
                : typeof parsed.clientEmail === 'string'
                  ? parsed.clientEmail
                  : null,
            name:
              typeof rawCustomer?.name === 'string'
                ? rawCustomer.name
                : typeof parsed.customerName === 'string'
                  ? parsed.customerName
                  : null,
          }
        : undefined;
      return {
        type: 'ticket',
        data: {
          ticketId: parsed.ticketId,
          clientEmail: typeof parsed.clientEmail === 'string' ? parsed.clientEmail : null,
          issuedAt: typeof parsed.issuedAt === 'string' ? parsed.issuedAt : null,
          orders: entries,
          totals: isPlainObject(parsed.totals)
            ? {
                itemsCount:
                  typeof parsed.totals.itemsCount === 'number' ? parsed.totals.itemsCount : null,
                totalAmount:
                  typeof parsed.totals.totalAmount === 'number'
                    ? parsed.totals.totalAmount
                    : null,
              }
            : undefined,
          customer: ticketCustomer ?? null,
        },
      };
    }
    if (typeof parsed.reservationId === 'string' || typeof parsed.code === 'string') {
      const reservationClientId =
        typeof parsed.clientId === 'string'
          ? parsed.clientId
          : typeof parsed.customerId === 'string'
            ? parsed.customerId
            : typeof parsed['Id cliente'] === 'string'
              ? (parsed['Id cliente'] as string)
              : null;
      return {
        type: 'reservation',
        data: {
          id: (parsed.reservationId as string) ?? (parsed.code as string),
          code: typeof parsed.code === 'string' ? parsed.code : null,
          user: typeof parsed.user === 'string' ? parsed.user : null,
          date: typeof parsed.date === 'string' ? parsed.date : null,
          time: typeof parsed.time === 'string' ? parsed.time : null,
          people:
            typeof parsed.people === 'number'
              ? parsed.people
              : typeof parsed.people === 'string'
                ? Number(parsed.people)
                : null,
          branch: typeof parsed.branch === 'string' ? parsed.branch : null,
          branchNumber: typeof parsed.branchNumber === 'string' ? parsed.branchNumber : null,
          message: typeof parsed.message === 'string' ? parsed.message : null,
          clientId: reservationClientId,
          email: typeof parsed.email === 'string' ? parsed.email : null,
          phone: typeof parsed.phone === 'string' ? parsed.phone : null,
        },
      };
    }
    const embeddedCustomer = isPlainObject(parsed.customer)
      ? parsed.customer
      : isPlainObject(parsed.user)
        ? parsed.user
        : null;
    const customerId =
      typeof parsed['Id cliente'] === 'string'
        ? (parsed['Id cliente'] as string)
        : typeof parsed.clientId === 'string'
          ? (parsed.clientId as string)
          : typeof parsed.customerId === 'string'
            ? (parsed.customerId as string)
            : typeof parsed.userId === 'string'
              ? (parsed.userId as string)
              : typeof embeddedCustomer?.clientId === 'string'
                ? embeddedCustomer.clientId
                : typeof embeddedCustomer?.id === 'string'
                  ? embeddedCustomer.id
                  : null;
    if (customerId) {
      const resolveString = (...candidates: Array<unknown>) =>
        candidates.find((value): value is string => typeof value === 'string') ?? null;
      return {
        type: 'customer',
        data: {
          id: customerId,
          firstName: resolveString(
            parsed['Nombre del cliente'],
            parsed.firstName,
            embeddedCustomer?.firstName,
            embeddedCustomer?.name
          ),
          lastName: resolveString(
            parsed.Apellido,
            parsed.lastName,
            embeddedCustomer?.lastName
          ),
          beverage: resolveString(
            parsed['Bebida favorita'],
            parsed.favoriteBeverage,
            embeddedCustomer?.favoriteBeverage,
            embeddedCustomer?.preferredDrink
          ),
          food: resolveString(
            parsed['Alimento favorito'],
            parsed.favoriteFood,
            embeddedCustomer?.favoriteFood,
            embeddedCustomer?.preferredFood
          ),
          phone: resolveString(parsed.Número, parsed.phone, embeddedCustomer?.phone),
          email: resolveString(parsed.Mail, parsed.email, embeddedCustomer?.email),
        },
      };
    }
  } catch {
    return null;
  }
  return null;
};

const buildOrderFromTicketDetail = (detail: TicketDetail, fallback?: ScannedTicket): Order => {
  const items = (detail.items ?? []).map((item) => ({
    id: item.id,
    productId: item.productId ?? null,
    name: item.product?.name ?? item.productId ?? 'Producto',
    category: item.product?.category ?? null,
    quantity: item.quantity ?? 0,
    price: item.price ?? null,
  }));

  const fallbackItems = fallback?.orders ?? [];
  const combinedItems = items.length
    ? items
    : fallbackItems.map((entry, index) => ({
        id: `${detail.ticket.ticketCode}-${index}`,
        productId: null,
        name: entry.name,
        category: null,
        quantity: entry.quantity ?? 0,
        price: entry.unitPrice ?? null,
      }));

  const firstName = detail.customer?.firstName ?? null;
  const lastName = detail.customer?.lastName ?? null;
  const nameSegments = (detail.customer?.name ?? '').trim().split(' ');
  const fallbackFirst = firstName ?? (nameSegments.length ? nameSegments[0] : null);
  const fallbackLast = lastName ?? (nameSegments.length > 1 ? nameSegments.slice(1).join(' ') : null);

  const itemsCount = combinedItems.reduce((sum, item) => sum + (item.quantity ?? 0), 0);

  return {
    id: detail.order.id,
    userId: detail.order.userId ?? detail.ticket.userId ?? detail.customer?.id ?? '',
    clientId: detail.customer?.clientId ?? fallback?.customer?.clientId ?? null,
    orderNumber: detail.ticket.ticketCode ?? detail.order.id,
    ticketCode: detail.ticket.ticketCode ?? null,
    status: (detail.order.status as Order['status']) ?? 'pending',
    total: detail.order.total ?? fallback?.totals?.totalAmount ?? 0,
    currency: detail.order.currency ?? detail.ticket.currency ?? 'MXN',
    items: combinedItems,
    itemsCount,
    user: {
      firstName: fallbackFirst,
      lastName: fallbackLast,
      email: detail.customer?.email ?? null,
      clientId: detail.customer?.clientId ?? null,
      phone: detail.customer?.phone ?? null,
    },
    createdAt: detail.order.createdAt ?? detail.ticket.createdAt ?? null,
    type: 'POS',
  } as Order;
};

const buildOrderFromTicketPayload = (ticket: ScannedTicket): Order => {
  const items = (ticket.orders ?? []).map((item, index) => ({
    id: `${ticket.ticketId}-${index}`,
    productId: null,
    name: item.name ?? 'Producto',
    category: null,
    quantity: item.quantity ?? 0,
    price: item.unitPrice ?? null,
  }));

  const itemsCount = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);

  const nameSegments = (ticket.customer?.name ?? '').trim().split(' ');
  const firstName = nameSegments.length ? nameSegments[0] : null;
  const lastName = nameSegments.length > 1 ? nameSegments.slice(1).join(' ') : null;

  return {
    id: ticket.ticketId,
    userId: ticket.customer?.id ?? '',
    clientId: ticket.customer?.clientId ?? null,
    orderNumber: ticket.ticketId,
    ticketCode: ticket.ticketId,
    status: 'pending',
    total: ticket.totals?.totalAmount ?? 0,
    currency: 'MXN',
    items,
    itemsCount,
  user: {
    firstName,
    lastName,
    email: ticket.customer?.email ?? ticket.clientEmail ?? null,
    clientId: ticket.customer?.clientId ?? null,
    phone: typeof ticket.customer?.phone === 'string' ? ticket.customer.phone : null,
  },
    createdAt: ticket.issuedAt ?? null,
    type: 'POS',
  } as Order;
};

const formatReservationCustomer = (reservation: Reservation) =>
  formatCustomerDisplay(reservation.user, reservation.userId);

const STAFF_ID_DISPLAY_OVERRIDES: Record<string, string> = {
  'barista-demo': 'Demo Barista',
  'manager-demo': 'Demo Gerente',
  'socio-demo': 'Socio socio.demo',
  'socio-cots': 'Socio cots.21d',
  'socio-ale': 'Socio aleisgales99',
  'socio-jhon': 'Socio garcia.aragon.jhon23',
  'super-criptec': 'Super donovan',
  'super-demo': 'Super demo',
  'socio-donovan': 'Socio donovanriano',
};

const firstToken = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const token = trimmed.split(/\s+/)[0];
  return token?.trim() || null;
};

const deriveHandlerNameFromStaffId = (staffId?: string | null) => {
  if (!staffId) {
    return null;
  }
  const trimmed = staffId.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  const override = STAFF_ID_DISPLAY_OVERRIDES[normalized];
  if (override) {
    return firstToken(override) ?? override;
  }
  if (trimmed.includes('@')) {
    return trimmed.split('@')[0];
  }
  return firstToken(trimmed) ?? trimmed;
};

const getPrepTaskHandlerShortName = (task: PrepTask) => {
  const handler = task.handler;
  const resolved =
    firstToken(task.handlerName) ??
    firstToken(handler?.firstName) ??
    firstToken(handler?.firstNameEncrypted) ??
    firstToken(handler?.lastName) ??
    firstToken(handler?.lastNameEncrypted);
  if (resolved) {
    return resolved;
  }
  if (handler?.email) {
    const userPart = handler.email.split('@')[0]?.trim();
    if (userPart) {
      return userPart;
    }
  }
  return deriveHandlerNameFromStaffId(task.handledByStaffId);
};

const buildReservationSearchTerms = (reservation: Reservation) => {
  const names = [
    reservation.user?.firstName,
    reservation.user?.lastName,
    reservation.user?.firstNameEncrypted,
    reservation.user?.lastNameEncrypted,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim());
  const fullName = names.length ? names.join(' ') : null;
  const extras = [
    reservation.user?.email,
    reservation.user?.clientId,
    reservation.userId,
    fullName,
    reservation.branchId,
    reservation.branchNumber,
  ];
  return [
    reservation.id,
    reservation.reservationCode,
    ...names,
    ...extras,
  ].filter((value): value is string => Boolean(value && value.trim()));
};

const buildPrepTaskSearchTerms = (task: PrepTask) => {
  const customerValues = [
    task.customer?.name,
    task.customer?.email,
    task.customer?.clientId,
    task.order?.clientId,
    task.order?.userId,
  ];
  const productValues = [task.product?.name, task.product?.category, task.product?.subcategory];
  const orderValues = [task.order?.orderNumber, task.order?.id, task.id];
  const handlerValues = [
    task.handlerName,
    task.handler?.email,
    task.handledByStaffId,
    getPrepTaskHandlerShortName(task),
  ];
  return [...customerValues, ...productValues, ...orderValues, ...handlerValues].filter(
    (value): value is string => Boolean(value && value.trim())
  );
};

const extractCustomerPhone = (user?: MaybeCustomer | null) => {
  if (!user || typeof user.phone !== 'string') {
    return '';
  }
  const trimmed = user.phone.trim();
  return trimmed;
};

const getCustomerDisplayName = (customer?: LoyaltyCustomer | null) => {
  if (!customer) {
    return 'Sin datos';
  }
  return customer.clientId || customer.email || `${customer.userId.slice(0, 6)}…`;
};

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const PREP_HIDE_MS = 2 * 24 * 60 * 60 * 1000;
const PREP_PURGE_MS = 365 * 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const groupPrepTasks = (tasks: PrepTask[]) => {
  const activeStatuses = new Set(['pending', 'in_progress']);
  const active: PrepTask[] = [];
  const completed: PrepTask[] = [];
  const past: PrepTask[] = [];
  const now = Date.now();

  tasks.forEach((task) => {
    const createdAtMs = task.createdAt ? new Date(task.createdAt).getTime() : null;
    const age = createdAtMs ? now - createdAtMs : 0;
    const isHidden = createdAtMs ? age >= PREP_HIDE_MS : false;
    const isPurged = createdAtMs ? age >= PREP_PURGE_MS : false;

    if (isPurged) {
      return;
    }

    if (task.status === 'completed') {
      if (isHidden) {
        return;
      }
      completed.push(task);
      return;
    }

    if (activeStatuses.has(task.status)) {
      if (age >= THREE_HOURS_MS) {
        if (!isHidden) {
          past.push(task);
        }
        return;
      }
      active.push(task);
      return;
    }

    if (age >= THREE_HOURS_MS) {
      if (!isHidden) {
        past.push(task);
      }
    } else {
      active.push(task);
    }
  });

  return { active, completed, past };
};

type DetailState =
  | { type: 'order'; data: Order }
  | { type: 'reservation'; data: Reservation }
  | { type: 'prep'; data: PrepTask }
  | { type: 'customer'; data: LoyaltyCustomer }
  | { type: 'scan-reservation'; data: ScannedReservation }
  | { type: 'scan-customer'; data: ScannedCustomer }
  | null;

type DetailActionState = {
  isLoading: boolean;
  message: string | null;
  error: string | null;
};

type ScannedTicket = {
  ticketId: string;
  clientEmail?: string | null;
  issuedAt?: string | null;
  orders: { name: string; quantity: number; unitPrice?: number | null }[];
  totals?: { itemsCount?: number | null; totalAmount?: number | null };
  customer?: {
    id?: string | null;
    clientId?: string | null;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
  } | null;
  orderDetails?: {
    id: string;
    status: string;
    total?: number | null;
    currency?: string | null;
    createdAt?: string | null;
  } | null;
  lineItems?: Array<{
    id: string;
    productId?: string | null;
    name?: string | null;
    category?: string | null;
    quantity: number;
    price?: number | null;
  }>;
};

type ScannedReservation = {
  id: string;
  code?: string | null;
  user?: string | null;
  date?: string | null;
  time?: string | null;
  people?: number | null;
  branch?: string | null;
  branchNumber?: string | null;
  message?: string | null;
  clientId?: string | null;
  email?: string | null;
  phone?: string | null;
};

type ScannedCustomer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  beverage?: string | null;
  food?: string | null;
  phone?: string | null;
  email?: string | null;
};

type ScanResult =
  | { type: 'ticket'; data: ScannedTicket }
  | { type: 'reservation'; data: ScannedReservation }
  | { type: 'customer'; data: ScannedCustomer };

type NavSection =
  | 'home'
  | 'metrics'
  | 'advancedMetrics'
  | 'forecasts'
  | 'marketing'
  | 'employees'
  | 'payments'
  | 'permissions'
  | 'notifications';

const NAV_ITEMS: { id: NavSection; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'metrics', label: 'Métricas' },
  { id: 'advancedMetrics', label: 'Métricas avanzadas' },
  { id: 'forecasts', label: 'Pronósticos' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'employees', label: 'Empleados' },
  { id: 'payments', label: 'Pagos y cortes' },
  { id: 'permissions', label: 'Permisos' },
  { id: 'notifications', label: 'Notificaciones' },
];

type StaffPanelView =
  | 'profile'
  | 'metrics'
  | 'salary'
  | 'cleaning'
  | 'inventory'
  | 'managerSalaries'
  | 'managerTips'
  | 'managerEmployees'
  | 'managerPayments'
  | 'governance'
  | 'approvals'
  | 'campaign'
  | 'superuser'
  | null;

const BARISTA_NAV_EXCLUSIONS: NavSection[] = ['employees', 'payments'];
const GERENTE_NAV_EXCLUSIONS: NavSection[] = ['employees', 'payments'];

const HOURLY_RATE = 38.1;

const MX_HOLIDAYS = new Set(['01-01', '02-05', '03-21', '05-01', '09-16', '11-20', '12-25']);

type FiscalFolioConfig = {
  series: string;
  nextNumber: number;
  issuer: string;
  rfc: string;
  lastIssuedAt: string | null;
  notes: string;
};

const DEFAULT_FOLIO_CONFIG: FiscalFolioConfig = {
  series: 'XC',
  nextNumber: 1284,
  issuer: 'Xoco Café',
  rfc: 'XOC0101019A5',
  lastIssuedAt: null,
  notes: 'Timbrado manual pendiente de automatizar con SAT sandbox.',
};

type InventoryCategoryId = 'foods' | 'beverages' | 'cleaning' | 'disposables';

type InventoryItem = {
  id: string;
  name: string;
  quantity: number;
  unit?: string;
};

type InventoryState = Record<InventoryCategoryId, InventoryItem[]>;

const FOOD_SUPPLIES = [
  'Pulpa de maracuyá',
  'Chorizo artesanal',
  'Frijoles refritos',
  'Lechuga fresca',
  'Pan gourmet',
  'Lechera condensada',
  'Queso manchego',
  'Huevo orgánico',
  'Espinacas baby',
  'Tocino ahumado',
];
const BEVERAGE_SUPPLIES = [
  'Café espresso blend',
  'Café de olla molido',
  'Concentrado de chai',
  'Té negro',
  'Té verde',
  'Infusión herbal',
  'Base frappé neutra',
  'Base frappé de vainilla',
  'Polvo de matcha',
  'Polvo de chocolate',
  'Jarabe de vainilla',
  'Jarabe de caramelo',
  'Salsa mocha',
  'Leche entera',
  'Leche deslactosada',
  'Leche de almendra',
  'Crema batida',
  'Agua embotellada',
  'Agua mineral',
];
const CLEANING_SUPPLIES = ['Jabón multiusos', 'Detergente', 'Desinfectante', 'Fibra verde', 'Cloro', 'Desengrasante'];
const DISPOSABLE_SUPPLIES = [
  'Vasos 12oz',
  'Vasos 16oz',
  'Tapas compostables',
  'Servilletas',
  'Removedores',
  'Cucharas biodegradables',
  'Mangas térmicas para vasos',
  'Platos desechables',
  'Bowls compostables',
  'Cajas para paninis',
  'Tenedores biodegradables',
  'Cuchillos biodegradables',
  'Popotes compostables',
];
const MAX_DYNAMIC_SUPPLIES = 8;
const FOOD_MENU_PREFIX = 'food-menu';
const BEVERAGE_MENU_PREFIX = 'bev-menu';
const PRIMARY_SUPER_USERS = new Set(['donovan@criptec.io']);
const SUPER_USER_EMAILS = new Set(['donovan@criptec.io', 'super.demo@xoco.local']);
const GOVERNANCE_REVIEWERS = PRIMARY_SUPER_USERS;
const SOCIO_REVIEW_DEADLINE_DAYS = 5;

type ManagerSalaryDraft = {
  baseMonthly: number;
  bonusPercent: number;
  remarks: string;
  paidLeaveDays: number;
};

type ManagerTipsDraft = {
  pool: number;
  manualAdjustment: number;
  distributionNote: string;
  lastModified: string | null;
};

type SuperUserAction = {
  id: string;
  email: string;
  role: StaffRole;
  status: 'pending' | 'completed';
  note?: string;
};

type GovernanceRequest = {
  id: string;
  type:
    | 'salary'
    | 'role'
    | 'branch'
    | 'manager'
    | 'termination'
    | 'branch-edit'
    | 'inventory'
    | 'evaluation';
  employee: string;
  branch: string;
  createdBy: string;
  createdAt: string;
  status: 'pending' | 'requires_changes' | 'approved' | 'declined';
  watchers: string[];
  approvals: Array<{ reviewer: string; decision: 'pending' | 'approved' | 'declined'; comment?: string }>;
  comments: { author: string; body: string; createdAt: string }[];
};

type ApprovalTicket = {
  id: string;
  category: 'paid_leave' | 'cleaning' | 'comments' | 'performance';
  employee: string;
  dueDate: string;
  status: 'pending' | 'approved' | 'declined';
  notes: string;
};

type CampaignNotification = {
  id: string;
  title: string;
  body: string;
  relatedView: StaffPanelView;
};

const createInventoryFromList = (names: string[], prefix: string): InventoryItem[] =>
  names.map((name, index) => ({
    id: `${prefix}-${index}`,
    name,
    quantity: 12,
  }));

const mapMenuToInventory = (items: MenuItem[], prefix: string): InventoryItem[] =>
  items.slice(0, MAX_DYNAMIC_SUPPLIES).map((item, index) => ({
    id: `${prefix}-${item.id ?? index}`,
    name: item.label,
    quantity: 16,
    unit: 'pzas',
  }));

const hasMenuInventory = (items: InventoryItem[], prefix: string) =>
  items.some((item) => item.id.startsWith(`${prefix}-`));

const mergeMenuInventory = (items: InventoryItem[], menuItems: InventoryItem[], prefix: string) => {
  const tag = `${prefix}-`;
  const staticItems = items.filter((item) => !item.id.startsWith(tag));
  return [...staticItems, ...menuItems];
};

type CleaningAssignment = {
  date: string;
  owner: string;
  shift: string;
  approver: string;
  status: 'pending' | 'in_review' | 'approved';
  note?: string;
  isWeekend: boolean;
  isHoliday: boolean;
};

type TenureBreakdown = {
  years: number;
  months: number;
  days: number;
  totalDays: number;
};

type PaidLeaveDay = {
  date: string;
  isEligible: boolean;
  reason: string;
  isWeekend: boolean;
};

type BenefitsPackage = {
  vacationBonus: number;
  aguinaldo: number;
  paidLeaveDays: number;
  bonusEligible: boolean;
  tipSharePercent: number;
};

export function PosDashboard() {
  const { orders, refresh } = useOrders();
  const {
    reservations,
    isLoading: reservationsLoading,
    error: reservationsError,
    refresh: refreshReservations,
  } = useReservations();
  const {
    stats: loyaltyStats,
    isLoading: loyaltyLoading,
    error: loyaltyError,
    refresh: refreshLoyalty,
  } = useLoyalty();
  const {
    tasks: prepTasks,
    isLoading: prepLoading,
    error: prepError,
    refresh: refreshPrep,
  } = usePrepQueue();
  const {
    payments,
    isLoading: paymentsLoading,
    error: paymentsError,
    refresh: refreshPayments,
  } = usePayments();
  const {
    staffData: rawStaffData,
    isLoading: staffLoading,
    error: staffError,
    refresh: refreshStaff,
  } = useStaff();
  const {
    metrics: partnerMetrics,
    isLoading: partnerLoading,
    error: partnerError,
    refresh: refreshPartnerMetrics,
    selectedDays: partnerDays,
    setDays: setPartnerDays,
  } = usePartnerMetrics();
  const {
    metrics: advancedMetrics,
    isLoading: advancedMetricsLoading,
    error: advancedMetricsError,
    selectedRange: advancedMetricsRange,
    setRange: setAdvancedMetricsRange,
    refresh: refreshAdvancedMetrics,
    setExtraParams: setAdvancedMetricsQuery,
  } = useAdvancedMetrics('14d');
  const [marketingRange, setMarketingRange] = useState('14d');
  const [activeSection, setActiveSection] = useState<NavSection>('home');
  const [reservationOverrides, setReservationOverrides] = useState<
    Record<string, 'completed' | 'cancelled'>
  >({});
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [showNewOrderForm, setShowNewOrderForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [prepSearchInput, setPrepSearchInput] = useState('');
  const [prepFilter, setPrepFilter] = useState('');
  const [showPastPrepModal, setShowPastPrepModal] = useState(false);
  const {
    beverageOptions,
    foodOptions,
    isLoading: menuLoading,
    error: menuError,
    refresh: refreshMenu,
  } = useMenuOptions();
  const { user, sessionSeconds, logout, changePassword } = useAuth();
  const [isStaffBarOpen, setStaffBarOpen] = useState(false);
  const [activeStaffPanel, setActiveStaffPanel] = useState<StaffPanelView>(null);
  const [managerInventory, setManagerInventory] = useState<InventoryState>({
    foods: createInventoryFromList(FOOD_SUPPLIES, 'food-base'),
    beverages: createInventoryFromList(BEVERAGE_SUPPLIES, 'bev-base'),
    cleaning: createInventoryFromList(CLEANING_SUPPLIES, 'cleaning'),
    disposables: createInventoryFromList(DISPOSABLE_SUPPLIES, 'disposable'),
  });
  const [managerSalaryDraft, setManagerSalaryDraft] = useState<ManagerSalaryDraft>({
    baseMonthly: 14800,
    bonusPercent: 12,
    remarks: 'Pendiente automatización de nómina.',
    paidLeaveDays: 6,
  });
  const [managerTipsDraft, setManagerTipsDraft] = useState<ManagerTipsDraft>({
    pool: 0,
    manualAdjustment: 0,
    distributionNote: 'Registrar transferencias manuales en corte.',
    lastModified: null,
  });
  const [tipsInitialized, setTipsInitialized] = useState(false);
  const staffData = useMemo(() => {
    if (!rawStaffData || !user?.email || !user?.id) {
      return rawStaffData;
    }
    const normalizedEmail = user.email.toLowerCase();
    if (!SUPER_USER_EMAILS.has(normalizedEmail)) {
      return rawStaffData;
    }
    const staffList = rawStaffData.staff ?? [];
    let resolvedMember =
      staffList.find((member) => member.email?.toLowerCase() === normalizedEmail) ?? null;
    let staffWithSuper = staffList;
    if (!resolvedMember) {
      resolvedMember = {
        id: user.id,
        email: user.email,
        role: user.role,
        branchId: user.branchId ?? null,
        isActive: true,
        firstNameEncrypted: user.firstName ?? null,
        lastNameEncrypted: user.lastName ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
      staffWithSuper = [resolvedMember, ...staffList];
    }
    const hasSession = (rawStaffData.sessions ?? []).some(
      (session) =>
        session.staffId === user.id || session.staff?.email?.toLowerCase() === normalizedEmail
    );
    const startTimestamp = new Date(Date.now() - Math.max(sessionSeconds, 1) * 1000).toISOString();
    const syntheticSession: StaffSessionRecord = {
      id: `virtual-${user.id}`,
      staffId: user.id,
      sessionStart: startTimestamp,
      sessionEnd: null,
      durationSeconds: sessionSeconds,
      ipAddress: 'pos-local',
      deviceType: 'Panel',
      createdAt: startTimestamp,
      updatedAt: startTimestamp,
      staff: resolvedMember,
      isActive: true,
    };
    const sessionsWithSuper = hasSession
      ? rawStaffData.sessions
      : [syntheticSession, ...(rawStaffData.sessions ?? [])];
    const metrics = rawStaffData.metrics
      ? {
          ...rawStaffData.metrics,
          totalStaff: staffWithSuper.length,
          activeStaff: staffWithSuper.filter((member) => member.isActive !== false).length,
        }
      : rawStaffData.metrics;
    return {
      ...rawStaffData,
      staff: staffWithSuper,
      sessions: sessionsWithSuper,
      metrics,
    };
  }, [rawStaffData, sessionSeconds, user?.branchId, user?.email, user?.firstName, user?.id, user?.lastName, user?.role]);

  const isSuperUser = Boolean(
    user?.role === 'superuser' || (user?.email && SUPER_USER_EMAILS.has(user.email.toLowerCase()))
  );
  const isSocio = Boolean(user?.role === 'socio' || isSuperUser);
  const [governanceRequests, setGovernanceRequests] = useState<GovernanceRequest[]>([
    {
      id: 'gov-001',
      type: 'salary',
      employee: 'barista.demo@xoco.local',
      branch: 'Matriz',
      createdBy: 'gerente.demo@xoco.local',
      createdAt: new Date().toISOString(),
      status: 'pending',
      watchers: ['cots.21d@gmail.com', 'aleisgales99@gmail.com', 'garcia.aragon.jhon23@gmail.com'],
      approvals: [
        { reviewer: 'cots.21d@gmail.com', decision: 'pending' },
        { reviewer: 'aleisgales99@gmail.com', decision: 'pending' },
      ],
      comments: [],
    },
  ]);
  const [approvalTickets, setApprovalTickets] = useState<ApprovalTicket[]>([
    {
      id: 'apr-001',
      category: 'paid_leave',
      employee: 'barista.demo@xoco.local',
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
      status: 'pending',
      notes: 'Solicitud de 2 días con goce de sueldo.',
    },
    {
      id: 'apr-002',
      category: 'cleaning',
      employee: 'gerente.demo@xoco.local',
      dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      status: 'pending',
      notes: 'Revisión de limpieza de baños matutina.',
    },
  ]);
  const [campaignFeed, setCampaignFeed] = useState<CampaignNotification[]>([
    {
      id: 'camp-001',
      title: 'Revisión de salario pendiente',
      body: 'Necesitas aprobar la solicitud GOV-001 antes de 5 días hábiles.',
      relatedView: 'governance',
    },
    {
      id: 'camp-002',
      title: 'Evaluación de desempeño',
      body: 'Completa la evaluación trimestral de baristas senior.',
      relatedView: 'approvals',
    },
  ]);
  const [superUserQueue, setSuperUserQueue] = useState<SuperUserAction[]>([
    { id: 'sup-001', email: 'nuevo.socio@xoco.local', role: 'socio', status: 'pending' },
  ]);
  const [secureSnapshot, setSecureSnapshot] = useState<Record<string, string>>({});
  const hiddenQueueOrderIds = useMemo(() => {
    const ids = new Set<string>();
    prepTasks
      .filter((task) => task.status === 'pending' || task.status === 'in_progress')
      .forEach((task) => {
        if (task.order?.id) {
          ids.add(task.order.id);
        }
      });
    return ids;
  }, [prepTasks]);
  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          !order.isHidden && !(order.status !== 'completed' && hiddenQueueOrderIds.has(order.id))
      ),
    [orders, hiddenQueueOrderIds]
  );
  const visibleReservations = useMemo(
    () => reservations.filter((reservation) => !reservation.isHidden),
    [reservations]
  );
  const reservationsWithOverrides = useMemo(
    () =>
      visibleReservations.map((reservation) =>
        reservationOverrides[reservation.id]
          ? { ...reservation, status: reservationOverrides[reservation.id] }
          : reservation
      ),
    [reservationOverrides, visibleReservations]
  );
  const { pending, past: pastOrders, completed } = useMemo(
    () => groupOrders(visibleOrders),
    [visibleOrders]
  );
  const monthStart = useMemo(() => getMonthStart(), []);
  const orderPaymentMetrics = useMemo(() => {
    const dayThreshold = Date.now() - DAY_MS;
    const monthStartMs = monthStart.getTime();
    let sales24h = 0;
    let tips24h = 0;
    let monthlyTips = 0;
    const methodTotals = new Map<string, number>();
    const entries: OrderPaymentMetricsSummary['entries'] = [];
    completed.forEach((order) => {
      const timestamp = Date.parse(order.updatedAt ?? order.createdAt ?? '');
      if (!Number.isFinite(timestamp)) {
        return;
      }
      const total = Number(order.total ?? 0);
      const tip = Number(order.tipAmount ?? 0);
      const paymentMethod = (order.queuedPaymentMethod ?? 'otro').toLowerCase();
      const reference = getOrderDisplayCode(order);
      const entryDate = new Date(timestamp).toISOString();
      entries.push({
        id: order.id,
        date: entryDate,
        reference,
        paymentMethod,
        debitAccount: paymentMethodAccount(paymentMethod),
        creditAccount: 'Ventas cafetería',
        amount: total,
        tipAmount: tip,
      });
      if (tip > 0) {
        entries.push({
          id: `${order.id}-tip`,
          date: entryDate,
          reference,
          paymentMethod,
          debitAccount: paymentMethodAccount(paymentMethod),
          creditAccount: 'Propinas por distribuir',
          amount: tip,
          tipAmount: tip,
        });
      }
      methodTotals.set(paymentMethod, (methodTotals.get(paymentMethod) ?? 0) + total + tip);
      if (timestamp >= dayThreshold) {
        sales24h += total;
        tips24h += tip;
      }
      if (timestamp >= monthStartMs) {
        monthlyTips += tip;
      }
    });
    const tipShare = {
      total: monthlyTips,
      barista: monthlyTips * 0.4,
      manager: monthlyTips * 0.6,
    };
    return {
      sales24h,
      tips24h,
      monthlyTips,
      monthStart,
      hasData: completed.length > 0,
      methodTotals: Array.from(methodTotals.entries()).map(([method, amount]) => ({
        method,
        amount,
      })),
      entries: entries
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 15),
      tipShare,
    };
  }, [completed, monthStart]);
  const {
    pending: basePendingReservations,
    past: basePastReservations,
    completed: baseCompletedReservations,
  } = useMemo(() => groupReservations(reservationsWithOverrides), [reservationsWithOverrides]);
  const [reservationFilter, setReservationFilter] = useState('');
  const filteredReservations = useMemo(() => {
    if (!reservationFilter.trim()) {
      return {
        pending: basePendingReservations,
        past: basePastReservations,
        completed: baseCompletedReservations,
      };
    }
    const term = reservationFilter.trim().toLowerCase();
    const matches = (value?: string | null) => value?.toLowerCase().includes(term) ?? false;
    const filterList = (list: Reservation[]) =>
      list.filter((reservation) => buildReservationSearchTerms(reservation).some(matches));
    return {
      pending: filterList(basePendingReservations),
      past: filterList(basePastReservations),
      completed: filterList(baseCompletedReservations),
    };
  }, [baseCompletedReservations, basePastReservations, basePendingReservations, reservationFilter]);
  const pendingReservations = filteredReservations.pending;
  const pastReservations = filteredReservations.past;
  const completedReservations = filteredReservations.completed;
  const completedReservationsLastWeek = useMemo(() => {
    const threshold = Date.now() - WEEK_MS;
    return baseCompletedReservations.filter((reservation) => {
      const timestamp =
        (reservation.updatedAt && Date.parse(reservation.updatedAt)) ||
        (reservation.reservationDate && parseReservationDate(reservation)?.getTime()) ||
        (reservation.createdAt && Date.parse(reservation.createdAt)) ||
        NaN;
      return Number.isFinite(timestamp) && timestamp >= threshold;
    });
  }, [baseCompletedReservations]);
  const reservationCounts = {
    pending: basePendingReservations.length,
    past: basePastReservations.length,
    completed: baseCompletedReservations.length,
  };
  const { active: baseActivePrep, completed: baseCompletedPrep, past: pastPrep } = useMemo(
    () => groupPrepTasks(prepTasks),
    [prepTasks]
  );
  const normalizedPrepFilter = prepFilter.trim().toLowerCase();
  const filterPrepList = useCallback(
    (list: PrepTask[]) => {
      if (!normalizedPrepFilter) {
        return list;
      }
      const matches = (value?: string | null) =>
        value?.toLowerCase().includes(normalizedPrepFilter) ?? false;
      return list.filter((task) => buildPrepTaskSearchTerms(task).some(matches));
    },
    [normalizedPrepFilter]
  );
  const activePrep = useMemo(
    () => filterPrepList(baseActivePrep),
    [baseActivePrep, filterPrepList]
  );
  const completedPrep = useMemo(
    () => filterPrepList(baseCompletedPrep),
    [baseCompletedPrep, filterPrepList]
  );
  const topCustomer = loyaltyStats?.topCustomer ?? null;
  const totalSales = payments?.totalAmount ?? 0;
  const totalTips = payments?.totalTips ?? 0;
  const staffActive = staffData?.metrics.activeStaff ?? 0;
  const staffTotal = staffData?.metrics.totalStaff ?? 0;
  const reservationsSectionId = 'reservations-panel';
  const [detail, setDetail] = useState<DetailState>(null);
  const [showReservationHistory, setShowReservationHistory] = useState(false);
  const [showReservationCompletedHistory, setShowReservationCompletedHistory] = useState(false);
  const [actionState, setActionState] = useState<DetailActionState>({
    isLoading: false,
    message: null,
    error: null,
  });
  const [scannerFeedback, setScannerFeedback] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [prefilledClientId, setPrefilledClientId] = useState<string | null>(null);
  const loyaltyCustomers = useMemo(
    () => loyaltyStats?.customers ?? [],
    [loyaltyStats]
  );
  const filteredCustomers = useMemo(() => {
    if (!customerFilter.trim()) {
      return loyaltyCustomers;
    }
    const term = customerFilter.trim().toLowerCase();
    return loyaltyCustomers.filter((customer) => {
      const idMatch = customer.clientId?.toLowerCase().includes(term) ?? false;
      const userMatch = customer.userId.toLowerCase().includes(term);
      return idMatch || userMatch;
    });
  }, [customerFilter, loyaltyCustomers]);

  const notificationsFeed = useMemo(() => {
    const feed: { id: string; message: string; timestamp: string }[] = [];
    (payments?.pendingReports ?? []).forEach((report) => {
      feed.push({
        id: `report-${report.id}`,
        message: `Reporte ${report.scope ?? 'POS'} · ${report.status ?? 'pendiente'}`,
        timestamp: report.createdAt ?? report.updatedAt ?? new Date().toISOString(),
      });
    });
    (prepTasks ?? []).slice(0, 5).forEach((task) => {
      feed.push({
        id: `prep-${task.id}`,
        message: `${task.product?.name ?? 'Producto'} · ${task.status.toUpperCase()}`,
        timestamp: task.updatedAt ?? task.createdAt ?? new Date().toISOString(),
      });
    });
    return feed;
  }, [payments, prepTasks]);

  const navItems = useMemo(() => {
    let items = NAV_ITEMS;
    if (user?.role === 'barista') {
      items = items.filter((item) => !BARISTA_NAV_EXCLUSIONS.includes(item.id));
    } else if (user?.role === 'gerente') {
      items = items.filter((item) => !GERENTE_NAV_EXCLUSIONS.includes(item.id));
    }
    if (!isSocio) {
      items = items.filter(
        (item) => item.id !== 'advancedMetrics' && item.id !== 'forecasts' && item.id !== 'marketing'
      );
    }
    return items;
  }, [user?.role, isSocio]);

  useEffect(() => {
    setAdvancedMetricsQuery({ marketing_range: marketingRange });
  }, [marketingRange, setAdvancedMetricsQuery]);

  useEffect(() => {
    setManagerInventory((prev) => {
      const next: InventoryState = { ...prev };
      let changed = false;
      if (foodOptions.length > 0 && !hasMenuInventory(prev.foods, FOOD_MENU_PREFIX)) {
        next.foods = mergeMenuInventory(prev.foods, mapMenuToInventory(foodOptions, FOOD_MENU_PREFIX), FOOD_MENU_PREFIX);
        changed = true;
      }
      if (beverageOptions.length > 0 && !hasMenuInventory(prev.beverages, BEVERAGE_MENU_PREFIX)) {
        next.beverages = mergeMenuInventory(
          prev.beverages,
          mapMenuToInventory(beverageOptions, BEVERAGE_MENU_PREFIX),
          BEVERAGE_MENU_PREFIX
        );
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [foodOptions, beverageOptions]);

  useEffect(() => {
    if (!tipsInitialized && typeof payments?.totalTips === 'number') {
      setManagerTipsDraft((prev) => ({
        ...prev,
        pool: payments.totalTips ?? prev.pool,
        lastModified: new Date().toISOString(),
      }));
      setTipsInitialized(true);
    }
  }, [payments?.totalTips, tipsInitialized]);

  useEffect(() => {
    if (!user?.email) {
      setSecureSnapshot({});
      return;
    }
    const payload = {
      salaryBase: managerSalaryDraft.baseMonthly,
      bonusPercent: managerSalaryDraft.bonusPercent,
      paidLeaveDays: managerSalaryDraft.paidLeaveDays,
      tipPool: managerTipsDraft.pool,
      manualAdjustment: managerTipsDraft.manualAdjustment,
    };
    void encryptSensitiveSnapshot(payload, user.email)
      .then(setSecureSnapshot)
      .catch(() => setSecureSnapshot({}));
  }, [user?.email, managerSalaryDraft, managerTipsDraft]);

  const handleInventoryQuantityChange = useCallback(
    (category: InventoryCategoryId, itemId: string, quantity: number) => {
      setManagerInventory((prev) => ({
        ...prev,
        [category]: prev[category].map((item) =>
          item.id === itemId ? { ...item, quantity: Math.max(0, quantity) } : item
        ),
      }));
    },
    []
  );

  const handleInventorySyncFromMenu = useCallback(() => {
    setManagerInventory((prev) => ({
      ...prev,
      foods:
        foodOptions.length > 0
          ? mergeMenuInventory(prev.foods, mapMenuToInventory(foodOptions, FOOD_MENU_PREFIX), FOOD_MENU_PREFIX)
          : prev.foods,
      beverages:
        beverageOptions.length > 0
          ? mergeMenuInventory(
              prev.beverages,
              mapMenuToInventory(beverageOptions, BEVERAGE_MENU_PREFIX),
              BEVERAGE_MENU_PREFIX
            )
          : prev.beverages,
    }));
    void refreshMenu();
  }, [beverageOptions, foodOptions, refreshMenu]);

  const updateManagerSalaryDraft = useCallback(
    (patch: Partial<ManagerSalaryDraft>) => {
      setManagerSalaryDraft((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const updateManagerTipsDraft = useCallback(
    (patch: Partial<ManagerTipsDraft>) => {
      setManagerTipsDraft((prev) => ({
        ...prev,
        ...patch,
        lastModified: new Date().toISOString(),
      }));
    },
    []
  );

  const handleGovernanceDecision = useCallback(
    (requestId: string, reviewer: string, decision: 'approved' | 'declined', comment: string) => {
      setGovernanceRequests((prev) =>
        prev.map((request) => {
          if (request.id !== requestId) {
            return request;
          }
          const approvals = request.approvals.map((approval) =>
            approval.reviewer === reviewer ? { ...approval, decision, comment } : approval
          );
          const allApproved = approvals.every((approval) => approval.decision === 'approved');
          const anyDeclined = approvals.some((approval) => approval.decision === 'declined');
          let status: GovernanceRequest['status'] = request.status;
          if (allApproved) {
            status = 'approved';
          } else if (anyDeclined) {
            status = 'requires_changes';
          }
          return {
            ...request,
            status,
            approvals,
            comments:
              comment?.trim() && decision === 'declined'
                ? [
                    ...request.comments,
                    {
                      author: reviewer,
                      body: comment,
                      createdAt: new Date().toISOString(),
                    },
                  ]
                : request.comments,
          };
        })
      );
    },
    []
  );

  const handleApprovalTicket = useCallback((ticketId: string, decision: 'approved' | 'declined', note?: string) => {
    setApprovalTickets((prev) =>
      prev.map((ticket) => (ticket.id === ticketId ? { ...ticket, status: decision, notes: note ?? ticket.notes } : ticket))
    );
  }, []);

  const handleSuperUserAction = useCallback(
    (payload: { email: string; role: StaffRole; note?: string }) => {
      setSuperUserQueue((prev) => [
        ...prev,
        {
          id: `sup-${prev.length + 1}`.padStart(3, '0'),
          email: payload.email.toLowerCase(),
          role: payload.role,
          status: 'pending',
          note: payload.note,
        },
      ]);
    },
    []
  );

  const scrollToReservations = () => {
    const el = document.getElementById(reservationsSectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const normalizeCode = (value?: string | null) => value?.trim().toLowerCase() ?? '';

  const tryMatchOrder = useCallback(
    (code: string) =>
      visibleOrders.find((order) =>
        [order.id, order.orderNumber, order.ticketCode, order.shortCode].some(
          (candidate) => normalizeCode(candidate) === code
        )
      ),
    [visibleOrders]
  );

  const tryMatchReservation = useCallback(
    (code: string) =>
      visibleReservations.find((reservation) =>
        [reservation.id, reservation.reservationCode].some(
          (candidate) => normalizeCode(candidate) === code
        )
      ),
    [visibleReservations]
  );

  const tryMatchCustomer = useCallback(
    (code: string) =>
      loyaltyCustomers.find((customer) =>
        [customer.clientId, customer.userId, customer.email].some(
          (candidate) => normalizeCode(candidate) === code
        )
      ),
    [loyaltyCustomers]
  );

  const rememberClientId = useCallback((value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed) {
      setPrefilledClientId(trimmed);
    }
  }, []);

  const handleScannerPayload = useCallback(
    async (payload: string) => {
      const trimmed = payload.trim();
      if (!trimmed) {
        setScannerFeedback('No pudimos leer el código, intenta nuevamente.');
        return;
      }

      const parsed = parseScannedPayload(trimmed);
      const tryCloseScanner = () => {
        setScannerFeedback(null);
        setShowScanner(false);
      };

      if (parsed) {
        if (parsed.type === 'ticket') {
          if (parsed.data.ticketId) {
            try {
              const detail = await fetchTicketDetail(parsed.data.ticketId);
              const orderFromDetail = buildOrderFromTicketDetail(detail, parsed.data);
              setDetail({ type: "order", data: orderFromDetail });
              rememberClientId(
                orderFromDetail.clientId ??
                  orderFromDetail.user?.clientId ??
                  detail.customer?.clientId ??
                  parsed.data.customer?.clientId ??
                  parsed.data.customer?.id ??
                  null
              );
              tryCloseScanner();
              return;
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : 'No encontramos el ticket en la base de datos.';
              setSnackbar(message);
            }
          }
          const fallbackOrder = buildOrderFromTicketPayload(parsed.data);
          setDetail({ type: 'order', data: fallbackOrder });
          rememberClientId(
            fallbackOrder.clientId ??
              fallbackOrder.user?.clientId ??
              parsed.data.customer?.clientId ??
              parsed.data.customer?.id ??
              null
          );
          tryCloseScanner();
          return;
        }
        if (parsed.type === 'reservation') {
          setDetail({ type: 'scan-reservation', data: parsed.data });
          rememberClientId(parsed.data.clientId ?? null);
          tryCloseScanner();
          return;
        }
        if (parsed.type === 'customer') {
          setDetail({ type: 'scan-customer', data: parsed.data });
          rememberClientId(parsed.data.id);
          tryCloseScanner();
          return;
        }
      }

      const normalized = normalizeCode(trimmed);
      if (!normalized) {
        setSnackbar('No encontramos un registro con ese código.');
        return;
      }

      try {
        const detail = await fetchTicketDetail(trimmed);
        const orderFromDetail = buildOrderFromTicketDetail(detail);
        setDetail({ type: 'order', data: orderFromDetail });
        rememberClientId(
          orderFromDetail.clientId ??
            orderFromDetail.user?.clientId ??
            detail.customer?.clientId ??
            null
        );
        tryCloseScanner();
        return;
      } catch (error) {
        console.warn('Ticket lookup fallback:', error);
      }

      const orderMatch = tryMatchOrder(normalized);
      if (orderMatch) {
        setDetail({ type: 'order', data: orderMatch });
        setScannerFeedback(null);
        tryCloseScanner();
        rememberClientId(orderMatch.clientId ?? orderMatch.user?.clientId ?? null);
        return;
      }

      const reservationMatch = tryMatchReservation(normalized);
      if (reservationMatch) {
        setDetail({ type: 'reservation', data: reservationMatch });
        setScannerFeedback(null);
        tryCloseScanner();
        rememberClientId(reservationMatch.user?.clientId ?? null);
        return;
      }

      const customerMatch = tryMatchCustomer(normalized);
      if (customerMatch) {
        setDetail({ type: 'customer', data: customerMatch });
        setScannerFeedback(null);
        tryCloseScanner();
        rememberClientId(customerMatch.clientId ?? customerMatch.userId);
        return;
      }

      setSnackbar('No encontramos un registro con ese código.');
    },
    [rememberClientId, tryMatchCustomer, tryMatchOrder, tryMatchReservation]
  );

  useEffect(() => {
    setActionState({ isLoading: false, message: null, error: null });
  }, [detail]);

  useEffect(() => {
    if (showScanner) {
      setScannerFeedback(null);
    }
  }, [showScanner]);

  useEffect(() => {
    if (!snackbar) {
      return;
    }
    const timer = setTimeout(() => setSnackbar(null), 4000);
    return () => clearTimeout(timer);
  }, [snackbar]);

  const handleCustomerSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCustomerFilter(customerQuery.trim());
    },
    [customerQuery]
  );

  const handleOpenNewOrder = useCallback(
    (clientId?: string | null) => {
      if (clientId?.trim()) {
        setPrefilledClientId(clientId.trim());
      }
      setActiveSection('home');
      setShowNewOrderForm(true);
    },
    [setActiveSection]
  );

  const handleCloseNewOrder = useCallback(() => {
    setShowNewOrderForm(false);
    setPrefilledClientId(null);
  }, []);

  const handleOpenScanner = useCallback(() => {
    setActiveSection('home');
    setShowScanner(true);
  }, [setActiveSection]);

  const handleCloseScanner = useCallback(() => {
    setShowScanner(false);
    setScannerFeedback(null);
  }, []);

  const getCurrentStaffName = useCallback(
    () => {
      if (!user) {
        return null;
      }
      const direct = user.firstName?.trim();
      if (direct) {
        return direct.split(/\s+/)[0] ?? direct;
      }
      const display = buildStaffDisplayName(user);
      const [first] = display.split(/\s+/);
      return first ?? display;
    },
    [user]
  );

  const handleMoveOrderToQueue = useCallback(
    async (order: Order, options?: { paymentMethod?: string | null }) => {
      if (!user) {
        return;
      }
      setActionState({ isLoading: true, message: null, error: null });
      try {
        await enqueueOrder(order.id, {
          staffId: user.id,
          staffName: getCurrentStaffName(),
          paymentMethod: options?.paymentMethod ?? null,
        });
        await Promise.all([refresh(), refreshPrep()]);
        setActionState({
          isLoading: false,
          message: 'Pedido enviado a la cola de producción',
          error: null,
        });
        setDetail(null);
      } catch (error) {
        setActionState({
          isLoading: false,
          message: null,
          error:
            error instanceof Error
              ? error.message
              : 'No pudimos mover el pedido a la cola. Intenta más tarde.',
        });
      }
    },
    [getCurrentStaffName, refresh, refreshPrep, user]
  );

  const handleReturnOrderToQueue = useCallback(
    async (order: Order, options?: { paymentMethod?: string | null }) => {
      if (!user) {
        return;
      }
      setActionState({ isLoading: true, message: null, error: null });
      try {
        await enqueueOrder(order.id, {
          staffId: user.id,
          staffName: getCurrentStaffName(),
          paymentMethod: options?.paymentMethod ?? null,
        });
        await Promise.all([refresh(), refreshPrep()]);
        setActionState({
          isLoading: false,
          message: 'Pedido regresado a la cola de producción',
          error: null,
        });
        setDetail(null);
        setSnackbar('El ticket regresó a la cola.');
      } catch (error) {
        setActionState({
          isLoading: false,
          message: null,
          error:
            error instanceof Error
              ? error.message
              : 'No pudimos regresar el pedido a la cola. Intenta más tarde.',
        });
      }
    },
    [getCurrentStaffName, refresh, refreshPrep, user]
  );

  const handleMarkPrepCompleted = useCallback(
    async (task: PrepTask) => {
      if (!task.order?.id) {
        setActionState({
          isLoading: false,
          message: null,
          error: 'No encontramos el pedido relacionado a esta preparación',
        });
        return;
      }

      setActionState({ isLoading: true, message: null, error: null });
      try {
        await completePrepTask(task.id);
        await completeOrder(task.order.id);
        await Promise.all([refresh(), refreshPrep()]);
        setActionState({
          isLoading: false,
          message: 'Pedido marcado como completado',
          error: null,
        });
        setDetail(null);
      } catch (error) {
        setActionState({
          isLoading: false,
          message: null,
          error:
            error instanceof Error
              ? error.message
              : 'No pudimos cerrar la preparación. Reintenta en unos minutos.',
        });

        console.error(error);
      }
    },
    [refresh, refreshPrep]
  );

  const [scannerInput, setScannerInput] = useState('');

  const handleScanInput = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget as HTMLFormElement);
      const value = String(formData.get('scanner') ?? '').trim();

      if (!value) {
        return;
      }

      if (value.startsWith('http')) {
        const normalizedUrl = new URL(value);
        const code = normalizedUrl.searchParams.get('code');
        if (code) {
          setScannerFeedback(null);
          setShowScanner(false);
          setScannerInput(code);
          return;
        }
      }

      setScannerInput(value);
      setScannerFeedback(null);
    },
    []
  );

  const staffSessions = useMemo(
    () => {
      if (!user?.id) {
        return [];
      }
      return (staffData?.sessions ?? []).filter((session) => session.staffId === user.id);
    },
    [staffData?.sessions, user?.id]
  );

  const staffSessionDailyTotals = useMemo(() => {
    const map = new Map<string, number>();
    (staffData?.sessions ?? []).forEach((session) => {
      const staffId = session.staffId ?? session.staff?.id;
      const start = session.sessionStart;
      if (!staffId || !start) {
        return;
      }
      const day = start.substring(0, 10);
      if (!day) {
        return;
      }
      const key = `${staffId}-${day}`;
      const duration = resolveSessionDurationSeconds(session);
      map.set(key, (map.get(key) ?? 0) + duration);
    });
    return map;
  }, [staffData?.sessions]);

  const aggregatedSessionSeconds = useMemo(
    () => staffSessions.reduce((total, session) => total + resolveSessionDurationSeconds(session), 0),
    [staffSessions]
  );

  const sessionDaysSet = useMemo(() => {
    const set = new Set<string>();
    staffSessions.forEach((session) => {
      if (session.sessionStart) {
        set.add(session.sessionStart.substring(0, 10));
      }
    });
    return set;
  }, [staffSessions]);

  const totalSessionSeconds = aggregatedSessionSeconds + sessionSeconds;
  const hoursWorked = totalSessionSeconds / 3600;
  const roundedHours = Math.floor(hoursWorked);

  const emptyUser: AuthenticatedStaff = {
    id: 'anon',
    email: 'anon@xoco.local',
    role: 'barista',
    shiftType: 'full_time',
    hourlyRate: HOURLY_RATE,
  };

  const activeUser = user ?? emptyUser;

  const branchLabel = activeUser.branchName ?? activeUser.branchId ?? 'Sin sucursal';
  const staffDisplayName = buildStaffDisplayName(activeUser);
  const tenure = useMemo(() => computeTenure(activeUser.startedAt), [activeUser.startedAt]);
  const sessionDurationLabel = formatSessionDuration(totalSessionSeconds);
  const hourlyRate = activeUser.hourlyRate ?? HOURLY_RATE;
  const salaryEstimate = roundedHours * hourlyRate;

  const userPrepTasks = useMemo(
    () =>
      (prepTasks ?? []).filter(
        (task) => task.handledByStaffId === activeUser.id || task.handler?.id === activeUser.id
      ),
    [prepTasks, activeUser.id]
  );

  const ordersHandled = useMemo(() => {
    const ids = new Set<string>();
    userPrepTasks.forEach((task) => {
      if (task.order?.id) {
        ids.add(task.order.id);
      }
    });
    return ids.size;
  }, [userPrepTasks]);

  const totalOrdersHandled = useMemo(() => {
    const ids = new Set<string>();
    (prepTasks ?? []).forEach((task) => {
      if (task.order?.id) {
        ids.add(task.order.id);
      }
    });
    return Math.max(1, ids.size);
  }, [prepTasks]);

  const tipShareBase = activeUser.shiftType === 'full_time' ? 0.6 : 0.4;
  const tipShare = (payments?.totalTips ?? 0) * tipShareBase * (ordersHandled / totalOrdersHandled);

  const punctualityRate = useMemo(() => computePunctualityScore(staffSessions), [staffSessions]);
  const administrativeFaults = useMemo(
    () => computeAdministrativeFaults(staffSessions),
    [staffSessions]
  );
  const benefits = useMemo(
    () =>
      buildBenefitsPackage({
        salaryBase: salaryEstimate,
        daysWorked: sessionDaysSet.size,
        shiftType: activeUser.shiftType,
      }),
    [salaryEstimate, sessionDaysSet.size, activeUser.shiftType]
  );
  const paidLeaveCalendar = useMemo(
    () => buildPaidLeaveCalendar(activeUser.startedAt ?? null, sessionDaysSet.size),
    [activeUser.startedAt, sessionDaysSet.size]
  );
  const cleaningSchedule = useMemo(
    () =>
      buildCleaningSchedule({
        user: activeUser,
        staff: staffData?.staff ?? [],
      }),
    [activeUser, staffData?.staff]
  );

  const profilePanelData = {
    name: staffDisplayName,
    branch: branchLabel,
    role: activeUser.role,
    tenure,
    startedAt: activeUser.startedAt,
    sessionDuration: sessionDurationLabel,
    hourlyRate,
  };

  const metricsPanelData = {
    hoursWorked,
    roundedHours,
    daysWorked: sessionDaysSet.size,
    ordersHandled,
    tipShare,
    salaryEstimate,
    punctualityRate,
    administrativeFaults,
    benefits,
    sessions: staffSessions,
    prepTasks: userPrepTasks,
  };

  const salaryPanelData = {
    hourlyRate,
    roundedHours,
    salaryEstimate,
    tipShare,
    benefits,
    paidLeaveCalendar,
  };

  const cleaningPanelData = {
    schedule: cleaningSchedule,
    branch: branchLabel,
  };

  if (!user) {
    return null;
  }

  const handleConfirmReservation = async (reservation: Reservation) => {
    setActionState({ isLoading: true, message: null, error: null });
    try {
      await completeReservation(reservation.id);
      setReservationOverrides((prev) => ({ ...prev, [reservation.id]: 'completed' }));
      await refreshReservations();
      setActionState({
        isLoading: false,
        message: 'Reservación confirmada y movida a completadas',
        error: null,
      });
      setSnackbar('Reservación confirmada y movida a completadas.');
      setDetail(null);
    } catch (error) {
      setActionState({
        isLoading: false,
        message: null,
        error:
          error instanceof Error
            ? error.message
            : 'No pudimos confirmar la reservación. Intenta más tarde.',
      });
      setSnackbar(
        error instanceof Error
          ? error.message
          : 'No pudimos confirmar la reservación. Intenta más tarde.'
      );
    }
  };

  const handleCancelReservation = async (reservation: Reservation) => {
    setActionState({ isLoading: true, message: null, error: null });
    try {
      await cancelReservation(reservation.id);
      setReservationOverrides((prev) => ({ ...prev, [reservation.id]: 'cancelled' }));
      await refreshReservations();
      setActionState({
        isLoading: false,
        message: 'Reservación cancelada correctamente',
        error: null,
      });
      setSnackbar('Reservación cancelada.');
      setDetail(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No pudimos cancelar la reservación. Intenta más tarde.';
      setActionState({ isLoading: false, message: null, error: message });
      setSnackbar(message);
    }
  };

  const handleScannedReservationConfirm = async (reservation: ScannedReservation) => {
    if (!reservation.id) {
      setSnackbar('El QR no incluye un ID de reservación válido.');
      return;
    }
    setActionState({ isLoading: true, message: null, error: null });
    try {
      await completeReservation(reservation.id);
      await refreshReservations();
      setActionState({
        isLoading: false,
        message: 'Reservación confirmada desde QR',
        error: null,
      });
      setSnackbar('Reservación confirmada desde QR.');
      setDetail(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No pudimos confirmar la reservación del QR. Intenta más tarde.';
      setActionState({ isLoading: false, message: null, error: message });
      setSnackbar(message);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--brand-bg)] text-[var(--brand-text)]">
      <header className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Image
              src="/xoco-logo.svg"
              alt="Xoco Café"
              width={72}
              height={72}
              className="h-16 w-16 flex-shrink-0"
              priority
            />
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-primary-500 dark:text-primary-200">
                {branchLabel}
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-[var(--brand-text)] dark:text-primary-50">
                Hola, {staffDisplayName}
              </h1>
              <p className="text-sm text-[var(--brand-muted)]">
                Sesión activa: <span className="font-semibold text-primary-600 dark:text-primary-200">{sessionDurationLabel}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3 text-sm text-[var(--brand-muted)]">
            <p className="text-right">Turno {user.shiftType === 'full_time' ? 'tiempo completo' : 'medio tiempo'}</p>
            <button
              type="button"
              className="rounded-full border border-primary-200 px-4 py-2 text-xs font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-white/20 dark:text-primary-200"
              onClick={() => setStaffBarOpen((prev) => !prev)}
            >
              {isStaffBarOpen ? 'Cerrar barra' : 'Barra de control'}
            </button>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`rounded-full border px-4 py-1 text-xs font-semibold transition ${
                  isActive
                    ? 'border-primary-500 bg-primary-100 text-primary-700'
                    : 'border-primary-100 text-[var(--brand-muted)] hover:border-primary-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      <StaffUtilityDrawer
        open={isStaffBarOpen}
        onClose={() => setStaffBarOpen(false)}
        onSelect={(view) => {
          setActiveStaffPanel(view);
          setStaffBarOpen(false);
        }}
        onLogout={logout}
        user={user}
        sessionDuration={sessionDurationLabel}
        hasCampaignNotifications={campaignFeed.length > 0}
      />
      <StaffSidePanel
        view={activeStaffPanel}
        onClose={() => setActiveStaffPanel(null)}
        onSwitchView={(next) => setActiveStaffPanel(next)}
        viewerEmail={user.email}
        profile={profilePanelData}
        metrics={metricsPanelData}
        salary={salaryPanelData}
        cleaning={cleaningPanelData}
        onChangePassword={changePassword}
        shiftType={user.shiftType}
        isManager={user.role === 'gerente' || isSocio}
        isSocio={isSocio}
        isSuperUser={isSuperUser}
        managerInventory={managerInventory}
        onInventoryChange={handleInventoryQuantityChange}
        onInventorySync={handleInventorySyncFromMenu}
        managerSalaryDraft={managerSalaryDraft}
        onManagerSalaryDraftChange={updateManagerSalaryDraft}
        managerTipsDraft={managerTipsDraft}
        onManagerTipsDraftChange={updateManagerTipsDraft}
        staffData={staffData}
        staffLoading={staffLoading}
        staffError={staffError}
        onRefreshStaff={refreshStaff}
        payments={payments}
        paymentsLoading={paymentsLoading}
        onRefreshPayments={refreshPayments}
        canViewAccounting={isSocio}
        branchName={branchLabel}
        orderPaymentMetrics={orderPaymentMetrics}
        governanceRequests={governanceRequests}
        onGovernanceDecision={handleGovernanceDecision}
        approvalTickets={approvalTickets}
        onApprovalDecision={handleApprovalTicket}
        campaignFeed={campaignFeed}
        onCampaignNavigate={(view) => setActiveStaffPanel(view)}
        secureSnapshot={secureSnapshot}
        superUserQueue={superUserQueue}
        onCreateSuperUserAction={handleSuperUserAction}
      />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16">
        {activeSection === 'home' && (
          <>
            <section className="card space-y-4 p-6">
              <div className="flex items-center justify-between">
                <p className="badge">Acciones rápidas</p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
                >
                  Actualizar tickets
                </button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <QuickAction
                  title="Abrir nuevo pedido"
                  description="Escanea el QR de un cliente o crea un pedido POS manual."
                  cta="Nuevo pedido"
                  onClick={() => handleOpenNewOrder()}
                />
                <QuickAction
                  title="Escanear QR inteligente"
                  description="Escanea tickets, reservas o clientes en un solo lector."
                  cta="Abrir lector"
                  onClick={() => handleOpenScanner()}
                />
              </div>
              {menuError && (
                <p className="rounded-2xl border border-danger-200/70 bg-danger-50/50 px-4 py-2 text-xs text-danger-600 dark:border-danger-500/40 dark:bg-danger-900/20 dark:text-danger-200">
                  {menuError} ·{' '}
                  <button type="button" onClick={() => void refreshMenu()} className="underline">
                    Reintentar
                  </button>
                </p>
              )}
            </section>

            {showNewOrderForm && (
              <section className="card space-y-4 p-6">
                <div className="flex items-center justify-between">
                  <p className="badge">Nuevo pedido POS</p>
                  <button type="button" className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]" onClick={handleCloseNewOrder}>
                    Cerrar
                  </button>
                </div>
                <NewOrderModal
                  onClose={handleCloseNewOrder}
                  prefillClientId={prefilledClientId}
                  onSuccess={async () => {
                    await refresh();
                    setSnackbar('Nuevo pedido creado manualmente.');
                    handleCloseNewOrder();
                  }}
                />
              </section>
            )}

            {showScanner && (
              <section className="card space-y-4 p-6">
                <SmartScannerPanel onPayload={handleScannerPayload} onClose={handleCloseScanner} feedback={scannerFeedback} />
              </section>
            )}

            <OrdersPanel
              hiddenOrderIds={hiddenQueueOrderIds}
              onSelect={(order) => setDetail({ type: 'order', data: order })}
            />

            <section className="card space-y-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="badge">Cola de producción</p>
                  <p className="text-sm text-[var(--brand-muted)]">Ordena y asigna preparaciones de bebidas y alimentos.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--brand-muted)]">
                  {prepLoading && <p>Actualizando...</p>}
                  <button
                    type="button"
                    onClick={() => setShowPastPrepModal(true)}
                    className="brand-button text-xs"
                    disabled={pastPrep.length === 0}
                  >
                    Pasados ({pastPrep.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshPrep()}
                    className="rounded-full border border-primary-200 px-3 py-1 font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-white/20 dark:text-primary-200 disabled:opacity-50"
                  >
                    Actualizar cola
                  </button>
                </div>
              </div>
              <form
                className="flex flex-wrap items-center gap-3 text-xs text-[var(--brand-muted)]"
                onSubmit={(event) => {
                  event.preventDefault();
                  setPrepFilter(prepSearchInput);
                }}
              >
                <label className="flex flex-col text-[var(--brand-muted)]">
                  <span className="font-semibold uppercase tracking-[0.25em]">Buscar cliente</span>
                  <input
                    value={prepSearchInput}
                    onChange={(event) => setPrepSearchInput(event.target.value)}
                    placeholder="Nombre, email o ID del cliente"
                    className="mt-1 rounded-xl border border-primary-100/70 px-3 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-white"
                  />
                </label>
                <button type="submit" className="brand-button text-xs">
                  Buscar
                </button>
                {prepFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setPrepSearchInput('');
                      setPrepFilter('');
                    }}
                    className="brand-button--ghost text-xs"
                  >
                    Limpiar
                  </button>
                )}
              </form>

              {prepError ? (
                <div className="rounded-2xl border border-dashed border-danger-300/70 bg-danger-50/60 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-900/30 dark:text-danger-100">
                  {prepError}
                </div>
              ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                  <PrepQueueColumn
                    title="En barra"
                    tasks={activePrep}
                    highlight="text-primary-400"
                    onSelect={(task) => setDetail({ type: 'prep', data: task })}
                  />
                  <PrepQueueColumn
                    title="Entregados recientes"
                    tasks={completedPrep}
                    highlight="text-emerald-600"
                    onSelect={(task) => setDetail({ type: 'prep', data: task })}
                  />
                </div>
              )}
            </section>

            <section id={reservationsSectionId} className="card space-y-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="badge">Reservas compartidas</p>
                  <p className="text-sm text-[var(--brand-muted)]">Seguimos la lógica de corte 23:59; ocultamos reservas pasadas después de 3 días y las depuramos al año.</p>
                </div>
                <ReservationsSearchBar
                  onSearch={(value) => setReservationFilter(value)}
                  isLoading={reservationsLoading}
                  onRefresh={refreshReservations}
                  onShowPast={() => setShowReservationHistory(true)}
                  onShowCompleted={
                    baseCompletedReservations.length > 3
                      ? () => setShowReservationCompletedHistory(true)
                      : undefined
                  }
                  showCompletedButton={baseCompletedReservations.length > 3}
                />
              </div>

              {reservationsError ? (
                <div className="rounded-2xl border border-dashed border-danger-300/70 bg-danger-50/60 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-900/30 dark:text-danger-100">
                  {reservationsError}
                </div>
              ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                  <ReservationColumn
                    title="Pendientes"
                    highlight="text-primary-400"
                    reservations={pendingReservations}
                    onSelect={(reservation) => setDetail({ type: 'reservation', data: reservation })}
                  />
                  <ReservationColumn
                    title="Completadas"
                    highlight="text-emerald-600"
                    reservations={completedReservations}
                    onSelect={(reservation) => setDetail({ type: 'reservation', data: reservation })}
                  />
                </div>
              )}
            </section>

            <section id="loyalty-panel" className="card space-y-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="badge">Lealtad & clientes</p>
                  <p className="text-sm text-[var(--brand-muted)]">Identificamos a los clientes con más tickets y reservas compartidos.</p>
                </div>
                <div className="flex items-center gap-4 text-sm text-[var(--brand-muted)]">
                  {loyaltyLoading && <p>Actualizando...</p>}
                  <button
                    type="button"
                    onClick={() => void refreshLoyalty()}
                    className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
                  >
                    Actualizar lealtad
                  </button>
                </div>
              </div>

              {loyaltyError ? (
                <div className="rounded-2xl border border-dashed border-danger-300/70 bg-danger-50/60 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-900/30 dark:text-danger-100">
                  {loyaltyError}
                </div>
              ) : (
                <>
                  <TopCustomerHighlight customer={topCustomer} onSelect={(customer) => customer && setDetail({ type: 'customer', data: customer })} />
                  <form className="flex flex-wrap items-center gap-3 text-xs text-[var(--brand-muted)]" onSubmit={handleCustomerSearch}>
                    <label className="flex flex-col text-[var(--brand-muted)]">
                      <span className="font-semibold uppercase tracking-[0.25em]">Buscar ID</span>
                      <input
                        value={customerQuery}
                        onChange={(event) => setCustomerQuery(event.target.value)}
                        placeholder="Cliente o userId"
                        className="mt-1 rounded-xl border border-primary-100/70 bg-transparent px-3 py-2 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20"
                      />
                    </label>
                    <button type="submit" className="brand-button text-xs">
                      Buscar ID
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerQuery('');
                        setCustomerFilter('');
                      }}
                      className="brand-button--ghost text-xs"
                    >
                      Limpiar
                    </button>
                    <span>
                      Resultados: <strong>{filteredCustomers.length}</strong>
                    </span>
                  </form>
                  <CustomerLeaderboard customers={filteredCustomers} onSelect={(customer) => setDetail({ type: 'customer', data: customer })} />
                </>
              )}
            </section>

            {detail && (
              <DetailModal onClose={() => setDetail(null)}>
                <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <p className="badge">Detalle seleccionado</p>
                  <button
                    type="button"
                    className="text-xs font-bold uppercase tracking-[0.3em] text-[var(--brand-text)] dark:text-white"
                    onClick={() => setDetail(null)}
                  >
                    Cerrar
                  </button>
                </div>
                {detail.type === 'order' && (
                    <OrderDetailContent
                      order={detail.data}
                      onMoveToQueue={() => void handleMoveOrderToQueue(detail.data)}
                      onReturnToQueue={() => void handleReturnOrderToQueue(detail.data)}
                      actionState={actionState}
                    />
                  )}
                  {detail.type === 'reservation' && (
                    <ReservationDetailContent
                      reservation={detail.data}
                      onConfirmReservation={handleConfirmReservation}
                      onCancelReservation={handleCancelReservation}
                      actionState={actionState}
                    />
                  )}
                  {detail.type === 'prep' && (
                    <PrepTaskDetailContent
                      task={detail.data}
                      onMarkCompleted={() => void handleMarkPrepCompleted(detail.data)}
                      actionState={actionState}
                    />
                  )}
                {detail.type === 'customer' && (
                  <CustomerDetailContent
                    customer={detail.data}
                    beverageOptions={beverageOptions}
                    foodOptions={foodOptions}
                    isMenuLoading={menuLoading}
                    onClose={() => setDetail(null)}
                  />
                )}
                  {detail.type === 'scan-reservation' && (
                    <ScannedReservationContent
                      reservation={detail.data}
                      onConfirm={(reservation) => void handleScannedReservationConfirm(reservation)}
                    />
                  )}
                  {detail.type === 'scan-customer' && (
                    <ScannedCustomerContent
                      customer={detail.data}
                      beverageOptions={beverageOptions}
                      foodOptions={foodOptions}
                      isMenuLoading={menuLoading}
                    />
                  )}
                </div>
              </DetailModal>
            )}
            {showReservationHistory && (
              <DetailModal onClose={() => setShowReservationHistory(false)}>
                <ReservationHistoryContent
                  title="Reservas pasadas"
                  reservations={pastReservations}
                  onClose={() => setShowReservationHistory(false)}
                  hasFilter={Boolean(reservationFilter.trim())}
                  onSelect={(reservation) => setDetail({ type: 'reservation', data: reservation })}
                />
              </DetailModal>
            )}
            {showReservationCompletedHistory && (
              <DetailModal onClose={() => setShowReservationCompletedHistory(false)}>
                <ReservationHistoryContent
                  title="Reservas completadas"
                  reservations={completedReservationsLastWeek}
                  onClose={() => setShowReservationCompletedHistory(false)}
                  hasFilter={Boolean(reservationFilter.trim())}
                  onSelect={(reservation) => setDetail({ type: 'reservation', data: reservation })}
                />
              </DetailModal>
            )}
            {showPastPrepModal && (
              <DetailModal onClose={() => setShowPastPrepModal(false)}>
                <PrepQueuePastContent
                  tasks={pastPrep}
                  onClose={() => setShowPastPrepModal(false)}
                  onSelect={(task) => setDetail({ type: 'prep', data: task })}
                />
              </DetailModal>
            )}
          </>
        )}

        {activeSection === 'metrics' && (
          <>
            <section className="card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="badge">Resumen diario</span>
                  <h2 className="mt-3 text-2xl font-semibold">Corte del día</h2>
                </div>
                <div className="text-right text-sm text-[var(--brand-muted)]">
                  <p>Turno: Matutino</p>
                  <p>POS Matriz Roma Norte</p>
                </div>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryCard label="Ventas turno" value={formatCurrency(totalSales)} subtitle="Últimas 24h" isCurrency />
                <SummaryCard label="Pedidos activos" value={pending.length} subtitle="Pendientes" />
                <SummaryCard label="Pedidos totales" value={visibleOrders.length} subtitle="Últimos 100 visibles" />
                <SummaryCard label="Pasados" value={pastOrders.length} subtitle="Se ocultan a 3 días" />
                <SummaryCard label="Completados" value={completed.length} subtitle="Histórico cercano" />
                <SummaryCard label="Reservas activas" value={reservationCounts.pending} subtitle="Próximas 24h" />
                <SummaryCard label="En barra" value={baseActivePrep.length} subtitle="Cola de producción" />
                <SummaryCard label="Staff en turno" value={`${staffActive}/${staffTotal}`} subtitle="Activos / total" />
                <SummaryCard label="Cliente top" value={topCustomer?.totalInteractions ?? 0} subtitle={getCustomerDisplayName(topCustomer)} />
                <SummaryCard label="Propinas" value={formatCurrency(totalTips)} subtitle="Monto acumulado" isCurrency />
              </div>
            </section>
            {user.role === 'socio' && (
              <section className="card p-6">
                <PartnerMetricsContent
                  partnerDays={partnerDays}
                  setPartnerDays={setPartnerDays}
                  partnerLoading={partnerLoading}
                  partnerError={partnerError}
                  partnerMetrics={partnerMetrics}
                  refreshPartnerMetrics={refreshPartnerMetrics}
                />
              </section>
            )}
      </>
    )}

        {activeSection === 'advancedMetrics' && isSocio && (
          <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="badge">Analítica consolidada</span>
                <h2 className="mt-3 text-2xl font-semibold">Métricas avanzadas</h2>
              </div>
            </div>
            <AdvancedMetricsPanel
              metrics={advancedMetrics}
              isLoading={advancedMetricsLoading}
              error={advancedMetricsError}
              selectedRange={advancedMetricsRange}
              onRangeChange={setAdvancedMetricsRange}
              onRefresh={() => void refreshAdvancedMetrics()}
            />
          </section>
        )}

        {activeSection === 'forecasts' && isSocio && (
          <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="badge">Planeación operativa</span>
                <h2 className="mt-3 text-2xl font-semibold">Pronósticos</h2>
              </div>
            </div>
            <ForecastPanel
              forecasts={advancedMetrics?.forecasts ?? null}
              isLoading={advancedMetricsLoading}
              error={advancedMetricsError}
              onRefresh={() => void refreshAdvancedMetrics()}
            />
          </section>
        )}

        {activeSection === 'marketing' && isSocio && (
          <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="badge">Inteligencia comercial</span>
                <h2 className="mt-3 text-2xl font-semibold">Marketing & analítica predictiva</h2>
              </div>
            </div>
            <MarketingPanel
              insights={advancedMetrics?.marketing ?? null}
              selectedRange={marketingRange}
              onRangeChange={(value) => setMarketingRange(value)}
              onRefresh={() => void refreshAdvancedMetrics()}
            />
          </section>
        )}

        {activeSection === 'payments' && user.role !== 'gerente' && (
          <section className="card space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="badge">Pagos & cortes</p>
                <p className="text-sm text-[var(--brand-muted)]">Ventas sincronizadas con el POS y reportes pendientes.</p>
              </div>
              <div className="flex items-center gap-4 text-sm text-[var(--brand-muted)]">
                {paymentsLoading && <p>Actualizando...</p>}
                <button
                  type="button"
                  onClick={() => void refreshPayments()}
                  className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
                >
                  Actualizar pagos
                </button>
              </div>
            </div>

            {paymentsError ? (
              <div className="rounded-2xl border border-dashed border-danger-300/70 bg-danger-50/60 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-900/30 dark:text-danger-100">
                {paymentsError}
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <PaymentBreakdown payments={payments} totalTips={totalTips} />
                <PaymentActivity payments={payments} />
              </div>
            )}
          </section>
        )}

        {activeSection === 'employees' && user.role !== 'gerente' && (
          <section className="card space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="badge">Staff & sesiones</p>
                <p className="text-sm text-[var(--brand-muted)]">Controla roles, usuarios activos y sesiones abiertas.</p>
              </div>
              <div className="flex items-center gap-4 text-sm text-[var(--brand-muted)]">
                {staffLoading && <p>Actualizando...</p>}
                <button
                  type="button"
                  onClick={() => void refreshStaff()}
                  className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
                >
                  Actualizar staff
                </button>
              </div>
            </div>

            {staffError ? (
              <div className="rounded-2xl border border-dashed border-danger-300/70 bg-danger-50/60 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-900/30 dark:text-danger-100">
                {staffError}
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/10">
                  <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-200">Plantilla y roles</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Roles</p>
                      <div className="mt-2 space-y-2">
                        {(staffData?.metrics?.roles?.length ?? 0) === 0 ? (
                          <p className="text-sm text-[var(--brand-muted)]">Sin registros de staff.</p>
                        ) : (
                          (staffData?.metrics?.roles ?? []).map((role) => (
                            <div key={role.role} className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10">
                              <span className="capitalize">{role.role}</span>
                              <span className="font-semibold">{role.count}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Integrantes</p>
                      <div className="mt-2 space-y-2">
                        {(staffData?.staff.length ?? 0) === 0 ? (
                          <p className="text-sm text-[var(--brand-muted)]">Sin usuarios dados de alta.</p>
                        ) : (
                          (staffData?.staff ?? []).slice(0, 5).map((member) => (
                            <div key={member.id} className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10">
                              <div>
                                <p className="font-semibold">{member.email ?? member.id.slice(0, 6)}</p>
                                <p className="text-xs text-[var(--brand-muted)] capitalize">{member.role}</p>
                              </div>
                              <span className="text-xs uppercase tracking-[0.3em] text-primary-500">
                                {member.isActive ? 'Activo' : 'Inactivo'}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/10">
                  <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-200">Sesiones activas</h3>
                  {(staffData?.sessions.length ?? 0) === 0 ? (
                    <p className="mt-3 text-sm text-[var(--brand-muted)]">Sin sesiones registradas.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(staffData?.sessions ?? []).slice(0, 6).map((session) => {
                        const sessionDayKey = session.sessionStart?.substring(0, 10);
                        const sessionKey =
                          session.staffId && sessionDayKey ? `${session.staffId}-${sessionDayKey}` : null;
                        const aggregatedSeconds = sessionKey
                          ? staffSessionDailyTotals.get(sessionKey) ?? 0
                          : 0;
                        return (
                          <div
                            key={session.id}
                            className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10"
                          >
                            <div>
                              <p className="font-semibold">
                                {session.staff?.email ?? session.staffId ?? session.id.slice(0, 6)}
                              </p>
                              <p className="text-xs text-[var(--brand-muted)]">
                                Inicio: {session.sessionStart ? formatDate(session.sessionStart) : '—'}
                              </p>
                              {sessionKey && (
                                <p className="text-xs text-[var(--brand-muted)]">
                                  Duración hoy: {formatSessionDuration(aggregatedSeconds)}
                                </p>
                              )}
                            </div>
                            <span className="text-xs uppercase tracking-[0.3em] text-primary-500">
                              {session.isActive ? 'En turno' : 'Cerrada'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {activeSection === 'permissions' && (
          <section className="card space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="badge">Permisos y roles</p>
                <p className="text-sm text-[var(--brand-muted)]">Define quién puede crear tickets, mover pedidos o ver métricas.</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveSection('employees')}
                className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline"
              >
                Ir a empleados
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(staffData?.metrics?.roles ?? []).map((role) => (
                <span key={role.role} className="rounded-full border border-primary-100/70 px-3 py-1 text-xs font-semibold">
                  {role.role} · {role.count}
                </span>
              ))}
              {(staffData?.metrics?.roles?.length ?? 0) === 0 && (
                <p className="text-sm text-[var(--brand-muted)]">No hay roles configurados.</p>
              )}
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-200">Permisos críticos</h3>
                <ul className="mt-3 space-y-2 text-xs text-[var(--brand-muted)]">
                  <li className="rounded-xl border border-primary-50/80 px-3 py-2">Crear y cerrar tickets</li>
                  <li className="rounded-xl border border-primary-50/80 px-3 py-2">Mover pedidos a la cola</li>
                  <li className="rounded-xl border border-primary-50/80 px-3 py-2">Ver métricas financieras</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-200">Seguimiento</h3>
                <p className="text-sm text-[var(--brand-muted)]">
                  Las sesiones activas y los cambios de rol quedan registrados para auditoría interna.
                </p>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'notifications' && (
          <section className="card space-y-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="badge">Centro de notificaciones</p>
                <p className="text-sm text-[var(--brand-muted)]">Alertas de reportes, preparaciones y actividad reciente.</p>
              </div>
              <button type="button" onClick={() => setSnackbar('Centro actualizado.')} className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline">
                Registrar lectura
              </button>
            </div>
            {notificationsFeed.length === 0 ? (
              <p className="text-sm text-[var(--brand-muted)]">Sin notificaciones por ahora.</p>
            ) : (
              <ul className="space-y-3">
                {notificationsFeed.map((entry) => (
                  <li key={entry.id} className="rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/5">
                    <p className="font-semibold text-primary-700 dark:text-primary-200">{entry.message}</p>
                    <p className="text-xs text-[var(--brand-muted)]">{formatDate(entry.timestamp)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {snackbar && <Snackbar message={snackbar} onClose={() => setSnackbar(null)} />}
      </main>
    </div>
  );
}

const DetailModal = ({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        role="presentation"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 text-[var(--brand-text)] shadow-2xl dark:bg-[#1f1613] dark:text-white">
        {children}
      </div>
    </div>
  );
};

const SummaryCard = ({
  label,
  value,
  subtitle,
  isCurrency = false,
}: {
  label: string;
  value: number | string;
  subtitle: string;
  isCurrency?: boolean;
}) => (
  <div className="rounded-2xl border border-primary-100/60 bg-white/70 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/5">
    <p className="text-[var(--brand-muted)]">{label}</p>
    <p className="mt-1 text-2xl font-semibold">
      {typeof value === 'number' && isCurrency ? formatCurrency(value) : value}
    </p>
    <p className="text-xs text-primary-500">{subtitle}</p>
  </div>
);

const QuickAction = ({
  title,
  description,
  cta,
  onClick,
}: {
  title: string;
  description: string;
  cta: string;
  onClick?: () => void;
}) => (
  <div className="rounded-2xl border border-primary-50/80 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-[var(--brand-muted)]">{description}</p>
      </div>
      <button type="button" onClick={onClick} className="brand-button text-xs">
        {cta}
      </button>
    </div>
  </div>
);

const InfoCard = ({ title, description }: { title: string; description: string }) => (
  <div>
    <p className="text-xs uppercase tracking-[0.35em] text-primary-500">{title}</p>
    <p className="mt-2 text-lg font-semibold">{title === 'Tickets' ? 'JSON compartidos' : title}</p>
    <p className="text-sm text-[var(--brand-muted)]">{description}</p>
  </div>
);

const TopCustomerHighlight = ({
  customer,
  onSelect,
}: {
  customer: LoyaltyCustomer | null;
  onSelect?: (customer: LoyaltyCustomer) => void;
}) => {
  if (!customer) {
    return (
      <div className="rounded-2xl border border-dashed border-primary-200/60 bg-white/70 px-4 py-5 text-sm text-[var(--brand-muted)] dark:border-white/10 dark:bg-white/5">
        Aún no tenemos suficiente actividad para determinar al cliente más leal.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary-100/80 bg-gradient-to-r from-white/90 to-primary-50/70 px-4 py-5 shadow-sm dark:border-white/10 dark:from-white/5 dark:to-white/10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-primary-400">Cliente destacado</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--brand-text)]">
            {getCustomerDisplayName(customer)}
          </p>
          <p className="text-sm text-[var(--brand-muted)]">
            {customer.city ?? 'Ciudad desconocida'} · {customer.country ?? 'País'}
          </p>
        </div>
        <div className="text-right text-sm text-[var(--brand-muted)]">
          <p className="text-3xl font-semibold text-primary-600 dark:text-primary-200">
            {customer.totalInteractions}
          </p>
          <p>interacciones</p>
          <p className="mt-1 font-semibold">{formatCurrency(customer.totalSpent)}</p>
          <p>consumo estimado</p>
        </div>
      </div>
      <div className="mt-3 text-xs text-[var(--brand-muted)]">
        Última actividad: {customer.lastActivity ? formatDate(customer.lastActivity) : '—'}
      </div>
      {onSelect && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onSelect(customer)}
            className="brand-button text-xs"
          >
            Ver detalle
          </button>
        </div>
      )}
    </div>
  );
};

const CustomerLeaderboard = ({
  customers,
  onSelect,
}: {
  customers: LoyaltyCustomer[];
  onSelect?: (customer: LoyaltyCustomer) => void;
}) => {
  const pagination = usePagination(customers, 4);

  if (!customers.length) {
    return (
      <div className="rounded-2xl border border-dashed border-primary-200/60 bg-white/70 px-4 py-4 text-sm text-[var(--brand-muted)] dark:border-white/10 dark:bg-white/5">
        Sin registros recientes de tickets o reservas.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/10">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">
        <span>Cliente</span>
        <span>Pedidos · Reservas</span>
      </div>
      <div className="mt-3 space-y-2">
        {pagination.items.map((customer) => (
          <button
            type="button"
            key={customer.userId}
            onClick={() => onSelect?.(customer)}
            className="flex w-full items-center justify-between rounded-2xl border border-primary-50/70 bg-white/90 px-3 py-2 text-left text-sm transition hover:border-primary-300 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-white/5 dark:bg-white/5"
          >
            <div>
              <p className="font-semibold text-[var(--brand-text)]">
                {getCustomerDisplayName(customer)}
              </p>
              <p className="text-xs text-[var(--brand-muted)]">
                {customer.email ?? 'Email oculto'} · {customer.city ?? '—'}
              </p>
            </div>
            <div className="text-right text-xs text-[var(--brand-muted)]">
              <p>
                {customer.orders} · {customer.reservations}
              </p>
              <p className="font-semibold text-primary-500">
                {formatCurrency(customer.totalSpent)}
              </p>
            </div>
          </button>
        ))}
      </div>
      {pagination.hasPagination && (
        <ColumnPager
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          onPrev={pagination.prev}
          onNext={pagination.next}
        />
      )}
    </div>
  );
};

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
  past: 'bg-amber-200 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100',
  confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
  completed: 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-200',
  cancelled: 'bg-danger-100 text-danger-700 dark:bg-danger-500/20 dark:text-danger-200',
};

function ReservationColumn({
  title,
  reservations,
  onSelect,
  highlight,
}: {
  title: string;
  reservations: Reservation[];
  onSelect?: (reservation: Reservation) => void;
  highlight: string;
}) {
  const pagination = usePagination(reservations, 3);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className={`text-lg font-semibold ${highlight}`}>{title}</h3>
        <span className="text-sm text-[var(--brand-muted)]">{reservations.length} reservas</span>
      </div>
      <div className="mt-4 space-y-3">
        {reservations.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-primary-200/60 bg-white/70 px-4 py-3 text-sm text-[var(--brand-muted)] dark:border-white/10 dark:bg-white/5">
            No hay reservaciones registradas.
          </p>
        ) : (
          pagination.items.map((reservation) => (
            <ReservationCard
              key={reservation.id}
              reservation={reservation}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
      {pagination.hasPagination && (
        <ColumnPager
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          onPrev={pagination.prev}
          onNext={pagination.next}
        />
      )}
    </div>
  );
}

const ColumnPager = ({
  page,
  totalPages,
  totalItems,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPrev: () => void;
  onNext: () => void;
}) => (
  <div className="mt-3 flex items-center justify-between text-xs text-[var(--brand-muted)]">
    <button
      type="button"
      onClick={onPrev}
      className="rounded-full border border-primary-100/70 px-2 py-1 transition hover:border-primary-300 hover:text-primary-600 dark:border-white/10 disabled:opacity-40"
      disabled={page === 0}
    >
      ‹
    </button>
    <span className="font-semibold">
      Página {page + 1} de {totalPages} · {totalItems} registros
    </span>
    <button
      type="button"
      onClick={onNext}
      className="rounded-full border border-primary-100/70 px-2 py-1 transition hover:border-primary-300 hover:text-primary-600 dark:border-white/10 disabled:opacity-40"
      disabled={page >= totalPages - 1}
    >
      ›
    </button>
  </div>
);

function ReservationCard({
  reservation,
  onSelect,
}: {
  reservation: Reservation;
  onSelect?: (reservation: Reservation) => void;
}) {
  const peopleCount = reservation.peopleCount ?? 1;
  const statusKey = (reservation.status ?? 'pending').toLowerCase();
  const statusClass = statusStyles[statusKey] ?? statusStyles.pending;

  return (
    <article
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect ? () => onSelect(reservation) : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(reservation);
              }
            }
          : undefined
      }
      className="rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 text-sm shadow-sm transition hover:border-primary-300 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-white/10 dark:bg-white/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-primary-400 font-bold underline">
            {reservation.reservationCode ?? reservation.id.slice(0, 6)}
          </p>
          <p className="text-base font-semibold">{formatReservationDate(reservation)}</p>
          <p className="text-xs text-[var(--brand-muted)]">
            {peopleCount} {peopleCount === 1 ? 'persona' : 'personas'} · Sucursal{' '}
            {reservation.branchNumber ?? reservation.branchId ?? 'Matriz'}
          </p>
          <p className="text-xs text-[var(--brand-muted)]">{formatReservationCustomer(reservation)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusClass}`}>
          {statusKey}
        </span>
      </div>
      {reservation.message && (
        <p className="mt-2 text-xs text-[var(--brand-muted)] break-words">{reservation.message}</p>
      )}
    </article>
  );
}

const PrepQueueColumn = ({
  title,
  tasks,
  highlight,
  onSelect,
}: {
  title: string;
  tasks: PrepTask[];
  highlight: string;
  onSelect?: (task: PrepTask) => void;
}) => (
  <div>
    <div className="flex items-center justify-between">
      <h3 className={`text-lg font-semibold ${highlight}`}>{title}</h3>
      <span className="text-sm text-[var(--brand-muted)]">{tasks.length} items</span>
    </div>
    <div className="mt-4 space-y-3">
      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-primary-200/60 bg-white/70 px-4 py-3 text-sm text-[var(--brand-muted)] dark:border-white/10 dark:bg-white/5">
          Nada pendiente por ahora.
        </p>
      ) : (
        tasks.slice(0, 10).map((task) => (
          <PrepTaskCard key={task.id} task={task} onSelect={onSelect} />
        ))
      )}
    </div>
  </div>
);

const PrepTaskCard = ({ task, onSelect }: { task: PrepTask; onSelect?: (task: PrepTask) => void }) => {
  const quantity = task.orderItem?.quantity ?? 1;
  const productName = task.product?.name ?? 'Producto';
  const orderNumber = task.order?.orderNumber ?? task.order?.id?.slice(0, 6) ?? 'Sin código';
  const amount = task.amount ?? 0;
  const statusLabel =
    task.status === 'in_progress'
      ? 'En preparación'
      : task.status === 'completed'
        ? 'Listo'
        : 'Pendiente';
  const customerLabel =
    task.customer?.name?.trim() ||
    task.customer?.email?.trim() ||
    task.customer?.clientId?.trim() ||
    task.order?.clientId ||
    task.order?.userId ||
    'Cliente sin registro';
  const handlerDisplayName = getPrepTaskHandlerShortName(task);

  return (
    <article
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect ? () => onSelect(task) : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(task);
              }
            }
          : undefined
      }
      className="rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 text-sm shadow-sm transition hover:border-primary-300 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-white/10 dark:bg-white/10"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-primary-400 font-bold underline">
            {orderNumber}
          </p>
          <p className="text-base font-semibold">
            {quantity} × {productName}
          </p>
          <p className="text-xs text-[var(--brand-muted)]">
            Cliente:{' '}
            <span className="font-semibold text-primary-900 dark:text-white">{customerLabel}</span>
          </p>
        </div>
        <span className="text-xs font-semibold text-[var(--brand-muted)]">
          {task.createdAt ? formatDate(task.createdAt) : '—'}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-[var(--brand-muted)]">
        <p>
          {handlerDisplayName
            ? `Asignado a ${handlerDisplayName}`
            : task.status === 'completed'
              ? 'Entregado'
              : 'Sin asignar'}
        </p>
        <p className="font-semibold text-primary-400">{formatCurrency(amount)}</p>
      </div>
      <div className="mt-2 text-xs font-semibold text-primary-600 dark:text-primary-200">
        {statusLabel}
      </div>
    </article>
  );
};

const PrepQueuePastContent = ({
  tasks,
  onClose,
  onSelect,
}: {
  tasks: PrepTask[];
  onClose: () => void;
  onSelect?: (task: PrepTask) => void;
}) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return tasks;
    }
    const term = query.trim().toLowerCase();
    const matches = (value?: string | null) => value?.toLowerCase().includes(term) ?? false;
    return tasks.filter((task) => buildPrepTaskSearchTerms(task).some(matches));
  }, [query, tasks]);

  return (
    <div className="space-y-4 text-[var(--brand-text)] dark:text-white">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-semibold">Pedidos pasados en barra</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold uppercase tracking-[0.3em] text-[var(--brand-text)] underline dark:text-white"
        >
          Cerrar
        </button>
      </div>
      <p className="text-sm text-[var(--brand-muted)]">
        Listado de pedidos que superaron las 3 horas sin marcarse como entregados. Los ocultamos
        después de 2 días y los depuramos automáticamente al cumplirse un año.
      </p>
      <form
        className="flex flex-wrap items-center gap-2 text-xs text-[var(--brand-muted)] dark:text-white/80"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="flex flex-col">
          <span className="font-semibold uppercase tracking-[0.25em]">Buscar cliente</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre, email o ID"
            className="mt-1 rounded-xl border border-primary-100/70 bg-transparent px-3 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:text-white"
          />
        </label>
        <button type="submit" className="brand-button text-xs">
          Buscar
        </button>
        {query && (
          <button type="button" onClick={() => setQuery('')} className="brand-button--ghost text-xs">
            Limpiar
          </button>
        )}
      </form>
      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--brand-muted)] dark:text-white/80">
          {query ? 'No encontramos pedidos pasados con ese dato.' : 'Sin pedidos pendientes de seguimiento.'}
        </p>
      ) : (
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-2">
          {filtered.map((task) => (
            <PrepTaskCard
              key={task.id}
              task={task}
              onSelect={(selected) => {
                onSelect?.(selected);
                onClose();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

type OrderItemEntry = {
  productId?: string | null;
  quantity?: number | null;
  price?: number | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
};

const coerceQuantity = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? value : 1;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

const coerceAmount = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const categoryFromKey = (key?: string | null) => {
  if (!key) return null;
  const lower = key.toLowerCase();
  if (lower.includes('bebida') || lower.includes('drink') || lower.includes('beverage')) {
    return 'Bebidas';
  }
  if (lower.includes('food') || lower.includes('comida') || lower.includes('dish')) {
    return 'Alimentos';
  }
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
};

const normalizeItemEntry = (entry: unknown, fallbackCategory?: string | null): OrderItemEntry | null => {
  if (typeof entry === 'string') {
    const name = entry.trim();
    return name ? { name, quantity: 1, category: fallbackCategory ?? null } : null;
  }
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const rawName =
    typeof record.name === 'string'
      ? record.name
      : typeof record.title === 'string'
        ? record.title
        : typeof record.productName === 'string'
          ? record.productName
          : typeof record.product === 'string'
            ? record.product
            : null;
  const name = rawName?.trim();
  if (!name) {
    return null;
  }
  const quantity =
    coerceQuantity(record.quantity ?? record.qty ?? record.count ?? record.amount ?? record.total) ??
    1;
  const price = coerceAmount(record.price ?? record.unitPrice ?? record.amount ?? record.total);
  const category =
    (typeof record.category === 'string' && record.category.trim()) ||
    (typeof record.type === 'string' && record.type.trim()) ||
    fallbackCategory ||
    null;
  const subcategory =
    typeof record.subcategory === 'string'
      ? record.subcategory.trim()
      : typeof record.group === 'string'
        ? record.group.trim()
        : null;
  return {
    name,
    quantity,
    category,
    subcategory,
    price: price ?? undefined,
  };
};

const collectSectionItems = (
  value: unknown,
  sectionKey?: string
): OrderItemEntry[] => {
  const categoryHint = categoryFromKey(sectionKey);
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeItemEntry(entry, categoryHint))
      .filter(Boolean) as OrderItemEntry[];
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return record.items
        .map((entry) => normalizeItemEntry(entry, categoryHint))
        .filter(Boolean) as OrderItemEntry[];
    }
    const single = normalizeItemEntry(record, categoryHint);
    return single ? [single] : [];
  }
  return [];
};

const tryParseJsonItems = (raw: string): OrderItemEntry[] | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (parsed && typeof parsed === 'object') {
      const root = parsed as Record<string, unknown>;

      if (root.orders && typeof root.orders === 'object') {
        const flattened = Object.entries(root.orders as Record<string, unknown>)
          .flatMap(([section, value]) => collectSectionItems(value, section))
          .filter(Boolean) as OrderItemEntry[];
        if (flattened.length > 0) {
          return flattened;
        }
      }

      const structured = Object.entries(root)
        .flatMap(([section, value]) => collectSectionItems(value, section))
        .filter(Boolean) as OrderItemEntry[];
      if (structured.length > 0) {
        return structured;
      }
    }

    if (Array.isArray(parsed)) {
      const items = parsed
        .map((entry) => {
          if (typeof entry === 'string' || (entry && typeof entry === 'object')) {
            return normalizeItemEntry(entry);
          }
          return null;
        })
        .filter(Boolean) as OrderItemEntry[];
      if (items.length > 0) {
        return items;
      }
    }
    if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed as Record<string, unknown>);
      const items = entries
        .map(([key, value]) => {
          if (typeof value === 'string') {
            return { name: `${key}: ${value}`, quantity: 1 };
          }
          const quantity = coerceQuantity(value) ?? 1;
          return { name: key, quantity };
        })
        .filter((item) => Boolean(item.name));
      if (items.length > 0) {
        return items;
      }
    }
  } catch {
    return null;
  }
  return null;
};

const parsePreOrderItems = (raw?: string | null): OrderItemEntry[] => {
  if (!raw) {
    return [];
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const jsonItems = tryParseJsonItems(trimmed);
  if (jsonItems) {
    return jsonItems;
  }

  const segments = trimmed
    .split(/\r?\n|;/)
    .flatMap((segment) => segment.split(','))
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments
    .map((segment) => {
      const quantityMatch = segment.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s*(.+)$/i);
      if (quantityMatch) {
        const quantity = coerceQuantity(quantityMatch[1]) ?? 1;
        const name = quantityMatch[2]?.trim();
        if (name) {
          return { name, quantity };
        }
      }
      return { name: segment, quantity: 1 };
    })
    .filter((item) => Boolean(item.name?.trim()));
};

const safeQuantity = (quantity?: number | null) => {
  if (typeof quantity === 'number' && Number.isFinite(quantity)) {
    return quantity > 0 ? quantity : 1;
  }
  return 1;
};

const BEVERAGE_KEYWORDS = [
  'beverage',
  'bebida',
  'agua',
  'cafe',
  'drink',
  'drinks',
  'coffee',
  'espresso',
  'latte',
  'tea',
  'tisana',
  'refresc',
  'juice',
  'frapp',
  'café',
  'matcha',
];

const FOOD_KEYWORDS = [
  'food',
  'comida',
  'pan',
  'bakery',
  'postre',
  'dessert',
  'cake',
  'sandwich',
  'bagel',
  'tostada',
  'ensalada',
  'toast',
];

const normalizeText = (value?: string | null) =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFD');

const classifyOrderItem = (item: OrderItemEntry) => {
  const haystack = [
    normalizeText(item.category),
    normalizeText(item.subcategory),
    normalizeText(item.name),
    normalizeText(item.productId),
  ].join(' ');

  if (BEVERAGE_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'beverage';
  }
  if (FOOD_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'food';
  }
  return 'other';
};

const summarizeOrderItems = (items: OrderItemEntry[]) =>
  items.reduce(
    (acc, item) => {
      const quantity = safeQuantity(item.quantity);
      const classification = classifyOrderItem(item);
      acc.total += quantity;
      if (classification === 'beverage') {
        acc.beverages += quantity;
      } else if (classification === 'food') {
        acc.foods += quantity;
      } else {
        acc.other += quantity;
      }
      return acc;
    },
    { beverages: 0, foods: 0, other: 0, total: 0 }
  );

const ConsumptionSummary = ({ items }: { items: OrderItemEntry[] }) => {
  const summary = summarizeOrderItems(items);
  if (summary.total === 0) {
    return null;
  }

  const stats = [
    { label: 'Bebidas', value: summary.beverages },
    { label: 'Alimentos', value: summary.foods },
  ];

  if (summary.other > 0) {
    stats.push({ label: 'Otros', value: summary.other });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">
        Resumen de consumo
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 text-center dark:border-white/10 dark:bg-white/5"
          >
            <p className="text-[var(--brand-muted)] text-xs">{stat.label}</p>
            <p className="text-2xl font-semibold text-primary-900 dark:text-white">
              {stat.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

const OrderItemsSection = ({ items }: { items: OrderItemEntry[] }) => (
  <div className="space-y-2">
    <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Artículos</p>
    {items.length === 0 ? (
      <p className="rounded-xl border border-dashed border-primary-200/60 px-3 py-2 text-xs text-[var(--brand-muted)]">
        Sin detalle registrado.
      </p>
    ) : (
      <ul className="space-y-2">
        {items.map((item, index) => {
          const quantity = safeQuantity(item.quantity);
          const hasUnitPrice = typeof item.price === 'number' && Number.isFinite(item.price);
          const unitPrice = hasUnitPrice ? (item.price as number) : null;
          const lineTotal = hasUnitPrice && unitPrice !== null ? unitPrice * quantity : null;
          return (
            <li
              key={`${item.productId ?? index}`}
              className="flex items-center justify-between rounded-xl border border-white px-3 py-2 text-xs dark:border-white/70"
            >
              <div>
                <p className="font-bold text-primary-900 dark:text-white">
                  {item.name ?? item.productId ?? 'Producto'}
                </p>
                <p className="text-sm font-bold text-primary-800 dark:text-white/90">
                  {quantity} uds ·{' '}
                  {item.category ?? item.subcategory ?? 'Sin categoría'}
                </p>
              </div>
              <span className="font-bold text-primary-400 dark:text-white">
                {hasUnitPrice ? formatCurrency(lineTotal ?? 0) : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

const DetailActionFooter = ({
  label,
  onClick,
  disabled,
  actionState,
  variant = 'primary',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  actionState?: DetailActionState;
  variant?: 'primary' | 'danger';
}) => {
  const baseClasses =
    variant === 'danger'
      ? 'bg-danger-600 hover:bg-danger-700'
      : 'bg-primary-600 hover:bg-primary-700';

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-full rounded-2xl px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-40 ${baseClasses}`}
      >
        {disabled ? 'Procesando…' : label}
      </button>
      {actionState?.message && (
        <p className="text-xs font-semibold text-emerald-600">{actionState.message}</p>
      )}
      {actionState?.error && (
        <p className="text-xs font-semibold text-danger-600">{actionState.error}</p>
      )}
    </div>
  );
};

const OrderDetailContent = ({
  order,
  onMoveToQueue,
  onReturnToQueue,
  actionState,
}: {
  order: Order;
  onMoveToQueue?: (order: Order, options?: { paymentMethod?: string | null }) => void;
  onReturnToQueue?: (order: Order, options?: { paymentMethod?: string | null }) => void;
  actionState?: DetailActionState;
}) => {
  const [items, setItems] = useState<OrderItemEntry[]>(
    Array.isArray(order.items) ? (order.items as OrderItemEntry[]) : []
  );
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null);
  const [showPaymentSelector, setShowPaymentSelector] = useState<boolean>(!order.queuedPaymentMethod);
  const paymentMethodLabel = selectedPaymentMethod
    ? PAYMENT_METHOD_LABELS[selectedPaymentMethod] ?? selectedPaymentMethod
    : null;

  useEffect(() => {
    setItems(Array.isArray(order.items) ? (order.items as OrderItemEntry[]) : []);
    setItemsError(null);
    setSelectedPaymentMethod(order.queuedPaymentMethod ?? null);
    setShowPaymentSelector(!order.queuedPaymentMethod);
  }, [order]);

  useEffect(() => {
    if (items.length > 0) {
      return;
    }
    const identifier = order.ticketCode ?? order.orderNumber ?? order.id;
    if (!identifier) {
      return;
    }
    let cancelled = false;
    const hydrateItems = async () => {
      setItemsLoading(true);
      setItemsError(null);
      try {
        const detail = await fetchTicketDetail(identifier);
        if (cancelled) {
          return;
        }
        const fallback = buildOrderFromTicketDetail(detail);
        const resolvedItems = Array.isArray(fallback.items) ? fallback.items : [];
        if (resolvedItems.length) {
          setItems(resolvedItems);
        } else {
          setItems([]);
        }
        setItemsError(null);
      } catch (error) {
        if (!cancelled) {
          setItemsError(
            error instanceof Error
              ? error.message
              : 'No pudimos recuperar los artículos del ticket.'
          );
        }
      } finally {
        if (!cancelled) {
          setItemsLoading(false);
        }
      }
    };

    void hydrateItems();

    return () => {
      cancelled = true;
    };
  }, [items.length, order.id, order.orderNumber, order.ticketCode]);

  const totalItemsFromList = items.reduce((sum, item) => sum + safeQuantity(item.quantity), 0);
  const totalItems =
    totalItemsFromList > 0 ? totalItemsFromList : order.itemsCount ?? items.length ?? 0;
  const customerName = extractCustomerName(order.user);
  const customerPhone = extractCustomerPhone(order.user);
  return (
    <div className="space-y-5 text-base">
      <header>
        <p className="text-xs uppercase tracking-[0.35em] text-primary-400 font-bold underline">
          {getOrderDisplayCode(order)}
        </p>
        <h3 className="text-2xl font-semibold text-primary-700 dark:text-primary-100">Pedido</h3>
        <p className="text-sm font-semibold text-primary-900 dark:text-white">
          {formatDate(order.createdAt)}
        </p>
      </header>
      <div className="grid gap-3 rounded-2xl border border-primary-100/70 bg-primary-50/60 p-4 text-base dark:border-white/10 dark:bg-white/5">
        <DetailRow
          label="Cliente"
          value={
            <span className="font-bold text-primary-900 dark:text-white">
              {customerName || 'Cliente anónimo'}
            </span>
          }
        />
        <DetailRow label="Ticket POS" value={order.ticketCode ?? 'Sin ticket'} />
        <DetailRow
          label="Total"
          value={
            <span className="font-bold text-primary-900 dark:text-white">
              {formatCurrency(order.total)}
            </span>
          }
        />
        <DetailRow
          label="Artículos"
          value={`${totalItems} ${totalItems === 1 ? 'artículo' : 'artículos'}`}
        />
        <DetailRow
          label="Método de pago"
          value={
            <span className="text-sm font-normal text-[var(--brand-text)] dark:text-white">
              {paymentMethodLabel ?? 'Pendiente por definir'}
            </span>
          }
        />
      </div>
      <ConsumptionSummary items={items} />
      {itemsLoading && (
        <p className="rounded-xl border border-dashed border-primary-200/60 bg-white/60 px-3 py-2 text-xs text-[var(--brand-muted)] dark:border-white/10 dark:bg-white/5">
          Buscando detalle del ticket…
        </p>
      )}
      {itemsError && (
        <p className="rounded-xl border border-danger-200/70 bg-danger-50/70 px-3 py-2 text-xs text-danger-700 dark:border-danger-600/40 dark:bg-danger-900/30 dark:text-danger-100">
          {itemsError}
        </p>
      )}
      <OrderItemsSection items={items} />
      {order.status !== 'completed' && onMoveToQueue && (
        <div className="space-y-3">
          {selectedPaymentMethod && !showPaymentSelector ? (
            <div className="rounded-2xl border border-primary-100/70 bg-white/70 p-4 text-sm dark:border-white/10 dark:bg-white/5">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Método de pago</p>
              <p className="mt-2 text-sm">{paymentMethodLabel ?? selectedPaymentMethod}</p>
              <button
                type="button"
                className="mt-3 text-xs font-semibold text-primary-600 underline-offset-2 hover:underline dark:text-primary-200"
                onClick={() => setShowPaymentSelector(true)}
              >
                Cambiar método
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-primary-100/70 bg-white/70 p-4 text-sm dark:border-white/10 dark:bg-white/5">
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">
                Selecciona método de pago
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {PAYMENT_METHOD_OPTIONS.map((method) => {
                  const isActive = selectedPaymentMethod === method.key;
                  return (
                    <button
                      type="button"
                      key={method.key}
                      onClick={() => {
                        setSelectedPaymentMethod(method.key);
                        setShowPaymentSelector(false);
                      }}
                      className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
                        isActive
                          ? 'border-primary-500 bg-primary-100 text-primary-800 dark:border-primary-300 dark:bg-primary-500/20 dark:text-primary-100'
                          : 'border-primary-100 text-[var(--brand-text)] dark:border-white/20 dark:text-white'
                      }`}
                    >
                      {method.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <DetailActionFooter
            label="Mover a la cola"
            onClick={() => onMoveToQueue(order, { paymentMethod: selectedPaymentMethod })}
            disabled={!selectedPaymentMethod || actionState?.isLoading}
            actionState={actionState}
          />
        </div>
      )}
      {order.status === 'completed' && onReturnToQueue && (
        <DetailActionFooter
          label="Regresar a la cola"
          onClick={() => onReturnToQueue(order)}
          disabled={actionState?.isLoading}
          actionState={actionState}
        />
      )}
    </div>
  );
};

const ReservationDetailContent = ({
  reservation,
  onConfirmReservation,
  onCancelReservation,
  actionState,
}: {
  reservation: Reservation;
  onConfirmReservation?: (reservation: Reservation) => void;
  onCancelReservation?: (reservation: Reservation) => void;
  actionState?: DetailActionState;
}) => {
  const customerName = extractCustomerName(reservation.user);
  const customerPhone = extractCustomerPhone(reservation.user);
  const qrItems = parsePreOrderItems(reservation.preOrderItems);
  const preOrderText = reservation.preOrderItems?.trim() ?? '';

  return (
    <div className="space-y-5 text-base">
      <header>
        <p className="text-xs uppercase tracking-[0.35em] text-primary-400 font-bold underline">
          {reservation.reservationCode ?? reservation.id}
        </p>
        <h3 className="text-2xl font-semibold text-primary-700 dark:text-primary-100">Reservación</h3>
        <p className="text-sm font-semibold text-primary-900 dark:text-white">
          {formatReservationDate(reservation)}
        </p>
      </header>
      <div className="grid gap-3 rounded-2xl border border-primary-100/70 bg-primary-50/60 p-4 text-base dark:border-white/10 dark:bg-white/5">
        <DetailRow
          label="Personas"
          value={
            <span className="font-bold text-primary-900 dark:text-white">
              {`${reservation.peopleCount ?? 1} ${
                (reservation.peopleCount ?? 1) === 1 ? 'persona' : 'personas'
              }`}
            </span>
          }
        />
        <DetailRow
          label="Cliente"
          value={
            <span className="font-bold text-primary-900 dark:text-white">
              {customerName || 'Cliente anónimo'}
            </span>
          }
        />
      </div>
      {qrItems.length > 0 && (
        <>
          <ConsumptionSummary items={qrItems} />
          <OrderItemsSection items={qrItems} />
        </>
      )}
      {preOrderText && (
        <div className="rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/10">
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Pre-orden</p>
          <p className="mt-1 whitespace-pre-line">{preOrderText}</p>
        </div>
      )}
      {reservation.message && (
        <div className="rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/10">
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Mensaje</p>
          <p className="mt-1">{reservation.message}</p>
        </div>
      )}
      {(onConfirmReservation || onCancelReservation) && (
        <div className="space-y-3">
          {onConfirmReservation && (
            <DetailActionFooter
              label="Confirmar reservación"
              onClick={() => onConfirmReservation(reservation)}
              disabled={actionState?.isLoading}
              actionState={actionState}
            />
          )}
          {onCancelReservation && (
            <DetailActionFooter
              label="Cancelar reservación"
              onClick={() => onCancelReservation(reservation)}
              disabled={actionState?.isLoading}
              actionState={undefined}
              variant="danger"
            />
          )}
        </div>
      )}
    </div>
  );
};

const PrepTaskDetailContent = ({
  task,
  onMarkCompleted,
  actionState,
}: {
  task: PrepTask;
  onMarkCompleted?: (task: PrepTask) => void;
  actionState?: DetailActionState;
}) => {
  const orderItems = Array.isArray(task.order?.items)
    ? (task.order?.items as OrderItemEntry[])
    : [];
  const matchingOrderItem =
    (task.orderItem?.productId &&
      orderItems.find((item) => item.productId === task.orderItem?.productId)) ??
    null;
  const displayProductName =
    task.product?.name ??
    (matchingOrderItem ? matchingOrderItem.name : null) ??
    task.orderItem?.productId ??
    'Sin producto';
  const rawQuantity = task.orderItem?.quantity;
  const normalizedQuantity =
    typeof rawQuantity === 'number' && Number.isFinite(rawQuantity)
      ? rawQuantity
      : matchingOrderItem
        ? matchingOrderItem.quantity ?? null
        : null;
  const displayQuantity = safeQuantity(normalizedQuantity);
  const detailItems: OrderItemEntry[] =
    orderItems.length > 0
      ? orderItems
      : displayProductName !== 'Sin producto'
        ? [
            {
              productId: task.orderItem?.productId ?? task.product?.id ?? null,
              name: displayProductName,
              quantity: displayQuantity,
              price: task.orderItem?.price ?? null,
              category: task.product?.category ?? null,
              subcategory: task.product?.subcategory ?? null,
            },
          ]
        : [];
  const handlerDisplayName = getPrepTaskHandlerShortName(task);
  const customerLabel =
    task.customer?.name?.trim() ||
    task.customer?.email?.trim() ||
    task.customer?.clientId?.trim() ||
    task.order?.clientId ||
    task.order?.userId ||
    'Cliente sin registro';

  return (
    <div className="space-y-4 text-base">
      <div className="rounded-2xl bg-primary-100/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-primary-700 dark:bg-primary-500/20 dark:text-primary-100">
        Pedido en elaboración
      </div>
      <header>
        <p className="text-xs uppercase tracking-[0.35em] text-primary-400 font-bold underline">
          {task.order?.orderNumber ?? task.order?.id ?? task.id}
        </p>
        <h3 className="text-2xl font-semibold text-primary-700 dark:text-primary-100">Pedido en barra</h3>
        <p className="text-sm font-semibold text-primary-900 dark:text-white">
          {formatDate(task.createdAt)}
        </p>
      </header>
      <div className="grid gap-3 rounded-2xl border border-primary-100/70 bg-primary-50/60 p-4 text-base dark:border-white/10 dark:bg-white/5">
        <DetailRow
          label="Cliente"
          value={
            <span className="font-bold text-primary-900 dark:text-white">{customerLabel}</span>
          }
        />
        <DetailRow
          label="Producto"
          value={
            <span className="font-bold text-primary-900 dark:text-white">
              {displayProductName}
            </span>
          }
        />
        <DetailRow
          label="Cantidad"
          value={
            <span className="font-bold text-primary-900 dark:text-white">
              {String(displayQuantity)}
            </span>
          }
        />
        <DetailRow
          label="Total estimado"
          value={
            <span className="font-bold text-primary-900 dark:text-white">
              {formatCurrency(task.amount)}
            </span>
          }
        />
          <DetailRow
            label="Asignado a"
            value={
              <span className="font-bold text-primary-900 dark:text-white">
                {handlerDisplayName ?? 'Sin asignar'}
              </span>
            }
          />
      </div>
      {detailItems.length > 0 && (
        <div className="space-y-4">
          <ConsumptionSummary items={detailItems} />
          <OrderItemsSection items={detailItems} />
        </div>
      )}
      {onMarkCompleted && (
        <DetailActionFooter
          label="Marcar como completado"
          onClick={() => onMarkCompleted(task)}
          disabled={actionState?.isLoading}
          actionState={actionState}
        />
      )}
    </div>
  );
};

const CustomerDetailContent = ({
  customer,
  beverageOptions,
  foodOptions,
  isMenuLoading,
  onClose,
}: {
  customer: LoyaltyCustomer;
  beverageOptions: MenuItem[];
  foodOptions: MenuItem[];
  isMenuLoading?: boolean;
  onClose?: () => void;
}) => {
  const name = getCustomerDisplayName(customer);
  const coffees = customer.loyaltyCoffees ?? customer.orders ?? 0;
  const [preferences, setPreferences] = useState({
    beverage: customer.favoriteBeverage ?? '',
    food: customer.favoriteFood ?? '',
  });
  const [editingField, setEditingField] = useState<'beverage' | 'food' | null>(null);
  const [draftPreference, setDraftPreference] = useState('');
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(null);

  const startEditing = (field: 'beverage' | 'food') => {
    setEditingField(field);
    setDraftPreference(preferences[field] ?? '');
  };

  const savePreference = () => {
    if (!editingField) {
      return;
    }
    setPreferences((prev) => ({ ...prev, [editingField]: draftPreference }));
    setEditingField(null);
    setPreferenceMessage('Preferencia actualizada (solo vista previa).');
  };

  return (
    <div className="space-y-4 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-primary-500">
            {customer.clientId ?? customer.userId}
          </p>
          <h3 className="text-2xl font-semibold text-primary-700 dark:text-primary-100">{name}</h3>
          <p className="text-xs text-[var(--brand-muted)]">
            {customer.city ?? 'Ciudad desconocida'} · {customer.country ?? 'País'}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold uppercase tracking-[0.3em] text-[var(--brand-text)] underline dark:text-white"
          >
            Cerrar
          </button>
        )}
      </header>
      {preferenceMessage && (
        <p className="text-xs font-semibold text-emerald-600">{preferenceMessage}</p>
      )}
      <CustomerLoyaltyCoffees
        count={coffees}
        customerName={name}
        statusLabel="Programa semanal"
        subtitle="Sello por cada bebida registrada en POS"
      />
      <div className="grid gap-3 rounded-2xl border border-primary-100/70 bg-primary-50/60 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <DetailRow label="Pedidos" value={customer.orders} />
        <DetailRow label="Reservas" value={customer.reservations} />
        <DetailRow
          label="Interacciones"
          value={`${customer.totalInteractions} totales`}
        />
        <DetailRow label="Última actividad" value={customer.lastActivity ? formatDate(customer.lastActivity) : '—'} />
        <DetailRow label="Email" value={customer.email ?? 'Sin registro'} />
      </div>
      <div className="rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/10">
        <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Preferencias</p>
        <PreferenceField
          id="customer-preference-beverage"
          label="Bebida favorita"
          value={preferences.beverage}
          options={beverageOptions}
          isEditing={editingField === 'beverage'}
          draftValue={draftPreference}
          onEdit={() => startEditing('beverage')}
          onCancel={() => setEditingField(null)}
          onChange={setDraftPreference}
          onSave={savePreference}
          isLoading={isMenuLoading}
        />
        <PreferenceField
          id="customer-preference-food"
          label="Alimento favorito"
          value={preferences.food}
          options={foodOptions}
          isEditing={editingField === 'food'}
          draftValue={draftPreference}
          onEdit={() => startEditing('food')}
          onCancel={() => setEditingField(null)}
          onChange={setDraftPreference}
          onSave={savePreference}
          isLoading={isMenuLoading}
        />
      </div>
    </div>
  );
};

const PartnerMetricsContent = ({
  partnerDays,
  setPartnerDays,
  partnerLoading,
  partnerError,
  partnerMetrics,
  refreshPartnerMetrics,
}: {
  partnerDays: number;
  setPartnerDays: (days: number) => void;
  partnerLoading: boolean;
  partnerError: string | null;
  partnerMetrics: PartnerMetrics | null;
  refreshPartnerMetrics: () => Promise<void>;
}) => {
  const [fiscalFolio, setFiscalFolio] = useState<FiscalFolioConfig>(DEFAULT_FOLIO_CONFIG);

  const handleFolioUpdate = useCallback((patch: Partial<FiscalFolioConfig>) => {
    setFiscalFolio((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleIssueFolio = useCallback(() => {
    setFiscalFolio((prev) => ({
      ...prev,
      lastIssuedAt: new Date().toISOString(),
      nextNumber: prev.nextNumber + 1,
    }));
  }, []);

  return (
    <div className="space-y-6 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="badge">Panel de socios</p>
          <p className="text-sm text-[var(--brand-muted)]">
            Métricas avanzadas de ventas y clientes para dirección ({partnerDays} días).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--brand-muted)]">
          <label className="flex items-center gap-2 text-xs font-semibold">
            Periodo:
            <select
              value={partnerDays}
              onChange={(event) => setPartnerDays(Number(event.target.value))}
            className="rounded-lg border border-primary-100/70 bg-transparent px-3 py-1 text-sm text-[var(--brand-text)] dark:border-white/10"
          >
            {[30, 60, 90, 180, 360].map((daysOption) => (
                <option key={daysOption} value={daysOption}>
                  {daysOption} días
                </option>
              ))}
            </select>
          </label>
          {partnerLoading && <p>Actualizando...</p>}
          <button
            type="button"
            onClick={() => void refreshPartnerMetrics()}
            className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
          >
            Actualizar métricas
          </button>
        </div>
      </div>

      {partnerError ? (
        <div className="rounded-2xl border border-dashed border-danger-300/70 bg-danger-50/60 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-900/30 dark:text-danger-100">
          {partnerError}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/10">
            <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-200">
              Ventas {partnerDays} días
            </h3>
            {partnerMetrics?.metrics ? (
              <>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">
                      Ingresos
                    </p>
                    <p className="text-2xl font-semibold">
                      {formatCurrency(partnerMetrics.metrics.salesTotal)}
                    </p>
                    <p className="text-xs text-[var(--brand-muted)]">
                      Órdenes completadas: {partnerMetrics.metrics.completedOrders}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">
                      Pagos
                    </p>
                    <p className="text-2xl font-semibold">
                      {formatCurrency(partnerMetrics.metrics.paymentsTotal)}
                    </p>
                    <p className="text-xs text-[var(--brand-muted)]">
                      Ticket promedio: {formatCurrency(partnerMetrics.metrics.avgTicket)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl bg-primary-50/80 px-3 py-2 text-sm dark:bg-white/5">
                  Propinas capturadas:{' '}
                  <span className="font-semibold">
                    {formatCurrency(partnerMetrics.metrics.tipsTotal)}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--brand-muted)]">Sin datos de ventas en este periodo.</p>
            )}
          </div>

          <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/10">
            <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-200">
              Clientes estratégicos
            </h3>
            {partnerMetrics?.loyalty ? (
              <>
                <p className="mt-1 text-xs text-[var(--brand-muted)]">
                  {partnerMetrics.loyalty.customersTracked} clientes · {partnerMetrics.loyalty.totalOrders}{' '}
                  órdenes · {formatCurrency(partnerMetrics.loyalty.totalSpent)} en {partnerDays} días
                </p>
                <div className="mt-3 space-y-2">
                  {partnerMetrics.loyalty.topCustomers.length === 0 ? (
                    <p className="text-sm text-[var(--brand-muted)]">Sin clientes destacados.</p>
                  ) : (
                    partnerMetrics.loyalty.topCustomers.map((customer, index) => (
                      <div
                        key={customer.clientId ?? String(index)}
                        className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10"
                      >
                        <div>
                          <p className="font-semibold">{customer.clientId ?? 'Cliente'}</p>
                          <p className="text-xs text-[var(--brand-muted)]">
                            {customer.orders} órdenes · {customer.items ?? 0} artículos
                          </p>
                        </div>
                        <p className="font-semibold text-primary-600 dark:text-primary-200">
                          {formatCurrency(customer.spent ?? 0)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--brand-muted)]">Sin datos de clientes.</p>
            )}
            <div className="mt-4 rounded-2xl border border-primary-50/80 px-3 py-2 text-xs text-[var(--brand-muted)] dark:border-white/10">
              <p className="uppercase tracking-[0.35em]">Reportes generados</p>
              {partnerMetrics?.reports?.length ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {partnerMetrics.reports.map((report) => (
                    <li key={report.id} className="flex items-center justify-between">
                      <span>
                        {report.scope} · {report.status}
                      </span>
                      {report.resultUrl && (
                        <a
                          href={report.resultUrl}
                          className="text-xs font-semibold text-primary-500 hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm">No hay reportes recientes.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <PartnerFiscalControls folio={fiscalFolio} onUpdate={handleFolioUpdate} onIssue={handleIssueFolio} />
    </div>
  );
};
const PartnerFiscalControls = ({
  folio,
  onUpdate,
  onIssue,
}: {
  folio: FiscalFolioConfig;
  onUpdate: (patch: Partial<FiscalFolioConfig>) => void;
  onIssue: () => void;
}) => {
  const currentFolio = `${folio.series}-${String(folio.nextNumber).padStart(4, '0')}`;
  return (
    <div className="rounded-3xl border border-primary-100/70 bg-gradient-to-br from-white/90 to-amber-50/60 p-5 text-sm shadow-sm dark:border-white/10 dark:from-slate-900/40 dark:to-amber-900/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="badge">Foliado y comprobantes fiscales</p>
          <p className="text-xs text-[var(--brand-muted)]">
            Replica ligera de la herramienta contable de Frappe: controla series, RFC y bitácora de timbrado.
          </p>
        </div>
        <p className="text-xs text-[var(--brand-muted)]">
          Último folio:{' '}
          {folio.lastIssuedAt
            ? new Date(folio.lastIssuedAt).toLocaleString('es-MX')
            : 'sin emisión'}
        </p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Serie</span>
          <input
            type="text"
            value={folio.series}
            maxLength={4}
            onChange={(event) => onUpdate({ series: event.target.value.toUpperCase() })}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Próximo folio</span>
          <input
            type="number"
            value={folio.nextNumber}
            min={1}
            onChange={(event) => onUpdate({ nextNumber: Number(event.target.value) || folio.nextNumber })}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">RFC</span>
          <input
            type="text"
            value={folio.rfc}
            onChange={(event) => onUpdate({ rfc: event.target.value.toUpperCase() })}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Razón social</span>
          <input
            type="text"
            value={folio.issuer}
            onChange={(event) => onUpdate({ issuer: event.target.value })}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
      </div>
      <label className="mt-4 block space-y-1">
        <span className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Notas</span>
        <textarea
          rows={3}
          value={folio.notes}
          onChange={(event) => onUpdate({ notes: event.target.value })}
          className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
        />
      </label>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--brand-muted)]">
          Folio listo para timbrar:{' '}
          <span className="font-semibold text-primary-700 dark:text-primary-200">{currentFolio}</span>
        </p>
        <button type="button" className="brand-button text-xs" onClick={onIssue}>
          Generar folio
        </button>
      </div>
  </div>
);
};

const ADVANCED_RANGE_OPTIONS: Array<{ value: string; label: string; disabled?: boolean }> = [
  { value: '1d', label: '24h' },
  { value: '3d', label: '3 días' },
  { value: '7d', label: '7 días' },
  { value: '14d', label: '14 días' },
  { value: '30d', label: '30 días · mantenimiento', disabled: true },
  { value: '60d', label: '60 días' },
  { value: '90d', label: '90 días' },
  { value: '180d', label: '180 días' },
  { value: '365d', label: '365 días' },
  { value: '2y', label: '2 años' },
  { value: '3y', label: '3 años' },
  { value: '5y', label: '5 años' },
  { value: '10y', label: '10 años' },
];

const MARKETING_RANGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '7d', label: '7 días' },
  { value: '14d', label: '14 días' },
  { value: '30d', label: '30 días' },
  { value: '60d', label: '60 días' },
  { value: '90d', label: '90 días' },
];

const ADVANCED_SECTION_ORDER: AdvancedMetricsSectionId[] = [
  'clients',
  'sales',
  'payments',
  'orders',
  'analytics',
  'employees',
  'inventory',
];

const EXPORT_FORMATS: Array<{ value: 'csv' | 'xlsx'; label: string }> = [
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Excel' },
];

const AdvancedMetricsPanel = ({
  metrics,
  isLoading,
  error,
  selectedRange,
  onRangeChange,
  onRefresh,
}: {
  metrics: AdvancedMetricsPayload | null;
  isLoading: boolean;
  error: string | null;
  selectedRange: string;
  onRangeChange: (range: string) => void;
  onRefresh: () => void;
}) => {
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv');
  const [focusedSection, setFocusedSection] = useState<AdvancedMetricsSectionId>('clients');

  const handleExport = () => {
    if (typeof window === 'undefined' || !metrics) {
      return;
    }
    const params = new URLSearchParams({
      range: selectedRange,
      section: focusedSection,
      export: exportFormat,
    });
    const anchor = document.createElement('a');
    anchor.href = `/api/advanced-metrics?${params.toString()}`;
    anchor.setAttribute('target', '_blank');
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const availability = metrics?.rangeAvailability ?? {};
  const sectionData = metrics?.sections ?? ({} as Record<AdvancedMetricsSectionId, AdvancedMetricsSection>);

  return (
    <div className="mt-4 rounded-3xl border border-primary-100/70 bg-gradient-to-br from-white/90 to-amber-50/60 p-5 text-sm shadow-sm dark:border-white/10 dark:from-slate-900/40 dark:to-amber-900/20">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2 text-xs font-semibold">
          Periodo:
          <select
            value={selectedRange}
            onChange={(event) => onRangeChange(event.target.value)}
            className="rounded-lg border border-primary-100/70 bg-transparent px-3 py-1 text-sm text-[var(--brand-text)] dark:border-white/10"
          >
            {ADVANCED_RANGE_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled || (availability ? availability[option.value] === false : false)}
              >
                {option.label}
                {availability && availability[option.value] === false ? ' · sin datos' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 text-xs">
          {EXPORT_FORMATS.map((format) => (
            <label key={format.value} className="flex items-center gap-1">
              <input
                type="radio"
                name="advanced-export"
                value={format.value}
                checked={exportFormat === format.value}
                onChange={() => setExportFormat(format.value)}
              />
              {format.label}
            </label>
          ))}
          <button type="button" className="brand-button" onClick={handleExport} disabled={!metrics}>
            Descargar vista
          </button>
        </div>
        <button
          type="button"
          className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
          onClick={onRefresh}
        >
          Refrescar métricas
        </button>
      </div>
      {error && (
        <div className="rounded-2xl border border-danger-200 bg-danger-50/70 px-4 py-3 text-sm text-danger-700 dark:border-danger-500/40 dark:bg-danger-900/30 dark:text-danger-100">
          {error}
        </div>
      )}
      {isLoading && <p className="text-sm text-[var(--brand-muted)]">Cargando métricas avanzadas…</p>}
      {!isLoading && metrics && !metrics.hasData && (
        <p className="text-sm text-[var(--brand-muted)]">Rango seleccionado sin datos disponibles.</p>
      )}
      {!isLoading && metrics && (
        <div className="mt-5 space-y-5">
          {ADVANCED_SECTION_ORDER.map((sectionId) => (
            <AdvancedMetricsSectionBlock
              key={sectionId}
              sectionId={sectionId}
              section={sectionData[sectionId]}
              isFocused={focusedSection === sectionId}
              onFocus={() => setFocusedSection(sectionId)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const AdvancedMetricsSectionBlock = ({
  sectionId,
  section,
  isFocused,
  onFocus,
}: {
  sectionId: AdvancedMetricsSectionId;
  section?: AdvancedMetricsSection;
  isFocused: boolean;
  onFocus: () => void;
}) => {
  if (!section) {
    return null;
  }
  return (
    <div
      className={`rounded-3xl border p-5 text-sm shadow-sm transition dark:border-white/10 ${
        isFocused ? 'border-primary-400/80 shadow-lg' : 'border-primary-100/70'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">{section.title}</p>
          {!section.hasData && <p className="text-xs text-[var(--brand-muted)]">Sin datos en este rango.</p>}
        </div>
        <button
          type="button"
          className="rounded-full border border-primary-100/70 px-3 py-1 text-xs font-semibold text-primary-600 hover:border-primary-300 dark:border-white/10"
          onClick={onFocus}
        >
          {isFocused ? 'Seleccionado para exportar' : 'Exportar esta sección'}
        </button>
      </div>
      {section.cards.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {section.cards.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 font-semibold text-primary-700 dark:border-white/10 dark:bg-white/5 dark:text-primary-100"
            >
              <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">{card.label}</p>
              <p className="mt-1 text-2xl">{card.value}</p>
              {card.hint && <p className="text-xs text-[var(--brand-muted)]">{card.hint}</p>}
            </div>
          ))}
        </div>
      )}
      {section.bars.length > 0 && (
        <div className="mt-4 space-y-2">
          {section.bars.map((bar) => {
            const secondaryValue =
              typeof bar.secondary === 'number'
                ? sectionId === 'clients'
                  ? formatCurrency(bar.secondary)
                  : bar.secondary
                : null;
            const secondaryLabel = sectionId === 'clients' ? 'Gastado' : 'Secundario';
            return (
              <div key={`${sectionId}-${bar.label}`} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>{bar.label}</span>
                  <span className="font-semibold underline text-primary-700 dark:text-primary-200">{bar.value}</span>
                </div>
                <div className="h-2 rounded-full bg-primary-50/70 dark:bg-white/10">
                  <div
                    className="h-2 rounded-full bg-primary-500"
                    style={{ width: `${Math.min(100, (bar.value / (section.bars[0]?.value || 1)) * 100)}%` }}
                  />
                </div>
                {secondaryValue !== null && (
                  <p className="text-xs text-[var(--brand-muted)]">
                    {secondaryLabel}:{' '}
                    <span className="font-semibold underline">{secondaryValue}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {section.table && section.table.rows.length > 0 && (
        <MetricsTable table={section.table} tableKey={`${sectionId}-primary`} />
      )}
      {section.extraTables?.map((extra) => (
        <div key={`${sectionId}-${extra.title}`} className="mt-4 rounded-2xl border border-primary-50/80 bg-white/70 p-3 dark:border-white/10 dark:bg-white/5">
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">{extra.title}</p>
          <MetricsTable table={extra.table} tableKey={`${sectionId}-${extra.title}-extra`} compact />
        </div>
      ))}
      {section.message && <p className="mt-3 text-xs text-[var(--brand-muted)]">{section.message}</p>}
    </div>
  );
};

const MetricsTable = ({
  table,
  tableKey,
  compact,
}: {
  table: NonNullable<AdvancedMetricsSection['table']>;
  tableKey: string;
  compact?: boolean;
}) => {
  const visibleRows = table.rows.slice(0, 5);
  return (
    <div className={`mt-4 overflow-x-auto ${compact ? 'text-[0.7rem]' : ''}`}>
      <table className="w-full min-w-[420px] table-auto text-xs">
        <thead>
          <tr className="text-left text-[var(--brand-muted)]">
            {table.columns.map((column) => (
              <th key={`${tableKey}-${column}`} className="px-3 py-2 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => (
            <tr
              key={`${tableKey}-row-${index}`}
              className="border-t border-primary-50/80 text-[var(--brand-text)] dark:border-white/10 dark:text-white"
            >
              {table.columns.map((column) => (
                <td key={`${tableKey}-${column}-${index}`} className="px-3 py-2">
                  {row[column] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > 5 && (
        <p className="mt-2 text-[0.7rem] text-[var(--brand-muted)]">Mostrando 5 de {table.rows.length} registros.</p>
      )}
    </div>
  );
};

const ForecastPanel = ({
  forecasts,
  isLoading,
  error,
  onRefresh,
}: {
  forecasts: ForecastPayload | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}) => {
  const branchHighlights = forecasts?.branchDemand
    ? forecasts.branchDemand
        .flatMap((branch) =>
          branch.points.map((point) => ({
            branch: branch.branch,
            date: point.date,
            revenue: point.revenue,
          }))
        )
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
    : [];

  return (
    <div className="mt-4 rounded-3xl border border-primary-100/70 bg-gradient-to-br from-white/90 to-amber-50/60 p-5 text-sm shadow-sm dark:border-white/10 dark:from-slate-900/40 dark:to-amber-900/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--brand-muted)]">
          Genera recomendaciones con base en consumos, inventario y horarios de venta.
        </p>
        <button
          type="button"
          className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
          onClick={onRefresh}
        >
          Recalcular pronóstico
        </button>
      </div>
      {error && (
        <div className="mt-4 rounded-2xl border border-danger-200 bg-danger-50/70 px-4 py-3 text-sm text-danger-700 dark:border-danger-500/40 dark:bg-danger-900/30 dark:text-danger-100">
          {error}
        </div>
      )}
      {isLoading && <p className="mt-4 text-sm text-[var(--brand-muted)]">Calculando pronósticos…</p>}
      {!isLoading && !forecasts && !error && (
        <p className="mt-4 text-sm text-[var(--brand-muted)]">Sin datos disponibles para generar pronósticos.</p>
      )}
      {!isLoading && forecasts && (
        <>
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <ForecastTable
              title="Reposición de insumos"
              columns={['#', 'Insumo', 'Stock actual', 'Consumo diario', 'Días restantes', 'Próximo surtido']}
              rows={(forecasts.restock ?? []).map((entry, index) => ({
                '#': index + 1,
                Insumo: entry.name,
                'Stock actual': `${entry.quantity.toFixed(1)} u`,
                'Consumo diario': `${entry.avgDailyUse} u`,
                'Días restantes': entry.daysRemaining ?? '—',
                'Próximo surtido': entry.nextRestock
                  ? new Date(entry.nextRestock).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
                  : 'Calcular manual',
              }))}
            />
            <ForecastTable
              title="Producción sugerida"
              columns={['#', 'Producto', 'Demanda semanal', 'Promedio diario', 'Hora pico']}
              rows={(forecasts.production ?? []).map((entry, index) => ({
                '#': index + 1,
                Producto: entry.name,
                'Demanda semanal': `${entry.weeklyDemand}`,
                'Promedio diario': `${entry.dailyAverage}`,
                'Hora pico': entry.peakHour,
              }))}
            />
          </div>
          <div className="mt-6 space-y-4">
            {(forecasts.salesWindows ?? []).map((window) => (
              <ForecastSalesWindow key={window.days} window={window} />
            ))}
          </div>
          {forecasts.branchDemand && forecasts.branchDemand.length > 0 && (
            <div className="mt-6 space-y-3">
              <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Curvas por sucursal</p>
              {forecasts.branchDemand.map((branch) => (
                <div
                  key={branch.branch}
                  className="rounded-2xl border border-primary-50/80 bg-white/80 p-4 text-xs dark:border-white/10 dark:bg-white/5"
                >
                  <p className="font-semibold text-primary-700 dark:text-primary-100">{branch.branch}</p>
                  {branch.points.length === 0 ? (
                    <p className="text-[var(--brand-muted)]">Sin historial.</p>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {branch.points.map((point) => (
                        <div key={`${branch.branch}-${point.date}`} className="flex items-center justify-between">
                          <span>{point.date}</span>
                          <span className="font-semibold">{formatCurrency(point.revenue)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <p className="text-[0.7rem] text-[var(--brand-muted)]">
                Nota: cada curva refleja la demanda estimada diaria por sucursal; una pendiente al alza indica mayor venta esperada y sirve para ajustar personal e inventario local.
              </p>
              {branchHighlights.length > 0 && (
                <div className="rounded-2xl border border-primary-50/80 bg-white/90 p-4 text-xs dark:border-white/10 dark:bg-white/5">
                  <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Top 5 picos por sucursal</p>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-[0.7rem] uppercase tracking-widest text-[var(--brand-muted)]">
                          <th className="py-1 pr-2">#</th>
                          <th className="py-1 pr-2">Sucursal</th>
                          <th className="py-1 pr-2">Fecha</th>
                          <th className="py-1 text-right">Venta estimada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branchHighlights.map((highlight, index) => (
                          <tr key={`${highlight.branch}-${highlight.date}`} className="border-t border-primary-50/70 text-[var(--brand-text)] dark:border-white/10">
                            <td className="py-1 pr-2 font-semibold">{index + 1}</td>
                            <td className="py-1 pr-2">{highlight.branch}</td>
                            <td className="py-1 pr-2">{highlight.date}</td>
                            <td className="py-1 text-right font-semibold">{formatCurrency(highlight.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const ForecastTable = ({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number>>;
}) => (
  <div className="rounded-2xl border border-primary-50/80 bg-white/80 p-4 text-xs dark:border-white/10 dark:bg-white/5">
    <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">{title}</p>
    {rows.length === 0 ? (
      <p className="mt-3 text-[var(--brand-muted)]">Sin datos suficientes.</p>
    ) : (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] table-auto text-[0.7rem]">
          <thead>
            <tr className="text-left text-[var(--brand-muted)]">
              {columns.map((column) => (
                <th key={`${title}-${column}`} className="px-3 py-2 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${title}-row-${index}`} className="border-t border-primary-50/80 text-[var(--brand-text)] dark:border-white/10 dark:text-white">
                {columns.map((column) => (
                  <td key={`${title}-${column}-${index}`} className="px-3 py-2">
                    {row[column] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const ForecastSalesWindow = ({
  window,
}: {
  window: ForecastPayload['salesWindows'][number];
}) => (
  <div className="rounded-3xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
    <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">{window.label}</p>
    <div className="mt-3 flex flex-wrap gap-3">
      <MetricPill label="Venta estimada" value={formatCurrency(window.revenue)} />
      <MetricPill label="Órdenes previstas" value={`${window.orders}`} />
      <MetricPill
        label="Día más activo"
        value={
          window.busiestDay !== 'Sin datos'
            ? new Date(window.busiestDay).toLocaleDateString('es-MX', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })
            : 'Sin datos'
        }
      />
    </div>
    <p className="mt-3 text-xs text-[var(--brand-muted)]">
      Ajusta el inventario dinámico del dropdown de bebidas/alimentos según el pico esperado para garantizar abasto.
    </p>
    {window.topActivity && window.topActivity.length > 0 ? (
      <div className="mt-4 text-xs">
        <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Horarios más activos</p>
        <ul className="mt-2 space-y-1">
          {window.topActivity.map((slot, index) => (
            <li
              key={`${window.days}-${slot.day}-${slot.hour}-${index}`}
              className="flex items-center justify-between rounded-2xl border border-primary-50/80 px-3 py-2 text-[var(--brand-text)] dark:border-white/10 dark:text-white"
            >
              <span>
                {slot.day} · {slot.hour}
              </span>
              <span className="font-semibold">{slot.count} órdenes</span>
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <p className="mt-2 text-xs text-[var(--brand-muted)]">Sin datos de horarios activos.</p>
    )}
  </div>
);

type ClusterChartData = MarketingInsights['salesClusters'][number]['chart'];

const ClusterChartGraphic = ({
  chart,
  width = 260,
  height = 160,
  className = '',
  svgRef,
}: {
  chart: ClusterChartData;
  width?: number;
  height?: number;
  className?: string;
  svgRef?: (element: SVGSVGElement | null) => void;
}) => {
  const basePoints = chart.points.length
    ? chart.points
    : [{ orders: chart.centroid.orders, spent: chart.centroid.spent }];
  const orderedPoints = [...basePoints].sort((a, b) => a.orders - b.orders);
  const orderValues = [...basePoints.map((point) => point.orders), chart.centroid.orders];
  const spentValues = [...basePoints.map((point) => point.spent), chart.centroid.spent];
  const minOrders = Math.min(...orderValues);
  const maxOrders = Math.max(...orderValues);
  const minSpent = Math.min(...spentValues);
  const maxSpent = Math.max(...spentValues);
  const ordersRange = maxOrders - minOrders || 1;
  const spentRange = maxSpent - minSpent || 1;
  const padX = width * 0.08;
  const padY = height * 0.12;
  const scaleX = (value: number) => padX + ((value - minOrders) / ordersRange) * (width - padX * 2);
  const scaleY = (value: number) => height - padY - ((value - minSpent) / spentRange) * (height - padY * 2);
  const buildTicks = (min: number, max: number, count = 4) => {
    const ticks: Array<{ value: number; label: string }> = [];
    const step = (max - min) / count;
    for (let i = 0; i <= count; i += 1) {
      const value = min + step * i;
      ticks.push({ value, label: typeof value === 'number' ? value.toFixed(0) : `${value}` });
    }
    return ticks;
  };
  const ticksX = buildTicks(minOrders, maxOrders);
  const ticksY = buildTicks(minSpent, maxSpent);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full ${className}`}
      role="img"
      aria-label="Diagrama de dispersión del cluster"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="cluster-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.4)" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={width} height={height} rx={20} fill="url(#cluster-bg)" />
      <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#c7b9b3" strokeWidth={1} />
      <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="#c7b9b3" strokeWidth={1} />
      {ticksX.map((tick) => (
        <g key={`tick-x-${tick.value}`}>
          <line
            x1={scaleX(tick.value)}
            y1={height - padY}
            x2={scaleX(tick.value)}
            y2={height - padY + 6}
            stroke="#9b6a4c"
            strokeWidth={1}
          />
          <text
            x={scaleX(tick.value)}
            y={height - padY + 16}
            fontSize={9}
            textAnchor="middle"
            fill="#7b5b44"
          >
            {tick.label}
          </text>
        </g>
      ))}
      {ticksY.map((tick) => (
        <g key={`tick-y-${tick.value}`}>
          <line
            x1={padX - 6}
            y1={scaleY(tick.value)}
            x2={padX}
            y2={scaleY(tick.value)}
            stroke="#9b6a4c"
            strokeWidth={1}
          />
          <text
            x={padX - 8}
            y={scaleY(tick.value) + 3}
            fontSize={9}
            textAnchor="end"
            fill="#7b5b44"
          >
            {tick.label}
          </text>
        </g>
      ))}
      {orderedPoints.length > 1 && (
        <polyline
          points={orderedPoints
            .map((point) => `${scaleX(point.orders)},${scaleY(point.spent)}`)
            .join(' ')}
          fill="none"
          stroke="#8c4b2f"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
      )}
      {orderedPoints.map((point, index) => (
        <g key={`point-${point.orders}-${point.spent}-${index}`}>
          <circle
            cx={scaleX(point.orders)}
            cy={scaleY(point.spent)}
            r={4.5}
            fill="rgba(148, 64, 30, 0.65)"
            stroke="#7a2f13"
            strokeWidth={0.8}
          />
          <text
            x={scaleX(point.orders) + 6}
            y={scaleY(point.spent) - 6}
            fontSize={9}
            fill="#4a2412"
          >
            {formatCurrency(point.spent)}
          </text>
        </g>
      ))}
      <circle
        cx={scaleX(chart.centroid.orders)}
        cy={scaleY(chart.centroid.spent)}
        r={7}
        fill="#cb6120"
        stroke="#fff"
        strokeWidth={1.5}
      />
      <text
        x={scaleX(chart.centroid.orders)}
        y={scaleY(chart.centroid.spent) - 10}
        fontSize={10}
        textAnchor="middle"
        fontWeight="bold"
        fill="#552b1a"
      >
        {`${chart.centroid.orders.toFixed(1)} ord · ${formatCurrency(chart.centroid.spent)}`}
      </text>
      <text x={width - padX} y={height - padY / 3} fontSize={10} textAnchor="end" fill="#7b6c65">
        Órdenes
      </text>
      <text
        x={padX / 3}
        y={padY}
        fontSize={10}
        fill="#7b6c65"
        transform={`rotate(-90 ${padX / 3} ${padY})`}
      >
        Consumo
      </text>
    </svg>
  );
};

const MarketingPanel = ({
  insights,
  selectedRange,
  onRangeChange,
  onRefresh,
}: {
  insights: MarketingInsights | null;
  selectedRange: string;
  onRangeChange: (range: string) => void;
  onRefresh: () => void;
}) => {
  const [activeCluster, setActiveCluster] = useState<MarketingInsights['salesClusters'][number] | null>(null);
  const [chartZoom, setChartZoom] = useState(1);
  const modalSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (activeCluster) {
      setChartZoom(1);
    }
  }, [activeCluster]);

  const clampZoom = (value: number) => Number(Math.min(3, Math.max(1, value)).toFixed(2));

  const handleModalWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY * -0.001;
    setChartZoom((prev) => clampZoom(prev + delta));
  };

  const handleZoomStep = (step: number) => {
    setChartZoom((prev) => clampZoom(prev + step));
  };

  const handleDownload = () => {
    if (!modalSvgRef.current || !activeCluster) return;
    if (typeof window === 'undefined') {
      return;
    }
    const svgElement = modalSvgRef.current;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgElement);
    const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = new window.Image();
    const width = svgElement.viewBox?.baseVal?.width || svgElement.clientWidth || 640;
    const height = svgElement.viewBox?.baseVal?.height || svgElement.clientHeight || 380;

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(svgUrl);
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((blob) => {
        if (!blob) {
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `${activeCluster.name.replace(/\s+/g, '-').toLowerCase()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };

    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
    };

    image.src = svgUrl;
  };

  const modalChartBase = { width: 640, height: 380 };
  const zoomedWidth = Math.round(modalChartBase.width * chartZoom);
  const zoomedHeight = Math.round(modalChartBase.height * chartZoom);

  return (
    <div className="mt-4 space-y-6 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs font-semibold">
          Horizonte:
          <select
            value={selectedRange}
            onChange={(event) => onRangeChange(event.target.value)}
            className="rounded-lg border border-primary-100/70 bg-transparent px-3 py-1 text-sm text-[var(--brand-text)] dark:border-white/10"
          >
            {MARKETING_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
          onClick={onRefresh}
        >
          Recalcular marketing
        </button>
      </div>

      {!insights ? (
        <p className="text-sm text-[var(--brand-muted)]">Sin datos suficientes para marketing.</p>
      ) : (
        <>
          <div>
            <p className="badge">Segmentación (k-means simulado)</p>
            <p className="mt-2 text-xs text-[var(--brand-muted)]">
              Agrupamos clientes por gasto y frecuencia para activar campañas personalizadas.
            </p>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              {insights.salesClusters.map((cluster) => (
                <div
                  key={cluster.name}
                  className="rounded-2xl border border-primary-50/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5"
                >
                  <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">{cluster.name}</p>
                  <p className="mt-1 text-sm">{cluster.description}</p>
                  <p className="mt-2 text-sm">
                    Clientes: <span className="font-semibold">{cluster.count}</span>
                  </p>
                  <p className="text-sm">
                    Ticket promedio:{' '}
                    <span className="font-semibold">{formatCurrency(cluster.avgTicket)}</span>
                  </p>
                  <div className="mt-3">
                    <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Gráfico</p>
                    <button
                      type="button"
                      onClick={() => setActiveCluster(cluster)}
                      className="mt-2 block w-full rounded-2xl border border-primary-100/70 bg-gradient-to-br from-white to-primary-50/30 p-2 text-left transition hover:border-primary-300 dark:border-white/10"
                    >
                      <ClusterChartGraphic chart={cluster.chart} />
                      <p className="mt-2 text-xs text-[var(--brand-muted)]">
                        Clic para ampliar, zoom y descarga.
                      </p>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-primary-50/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Sugerencias de producto</p>
              <ul className="mt-3 space-y-2 text-sm">
                {insights.productSuggestions.length === 0 ? (
                  <li className="text-[var(--brand-muted)]">Sin recomendaciones por ahora.</li>
                ) : (
                  insights.productSuggestions.map((item) => (
                    <li
                      key={item.product}
                      className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 dark:border-white/10"
                    >
                      <span className="font-semibold">{item.product}</span>
                      <span className="text-xs text-[var(--brand-muted)]">{item.reason}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="rounded-2xl border border-primary-50/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Top horarios</p>
              <ul className="mt-3 space-y-2">
                {insights.bestHours.length === 0 ? (
                  <li className="text-[var(--brand-muted)]">Sin registros.</li>
                ) : (
                  insights.bestHours.map((slot) => (
                    <li
                      key={`${slot.day}-${slot.hour}`}
                      className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 dark:border-white/10"
                    >
                      <span>
                        {slot.day} · {slot.hour}
                      </span>
                      <span className="font-semibold">{slot.count} pedidos</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-primary-50/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="badge">Inferencia de pedidos</p>
              <p className="mt-1 text-xs text-[var(--brand-muted)]">
                Modelo heurístico que estima tipo de pedido (pick-up, reservación, delivery).
              </p>
              <ul className="mt-3 space-y-2">
                {insights.orderInference.map((entry) => (
                  <li key={entry.type} className="rounded-xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10">
                    <p className="font-semibold">
                      {entry.type}: {entry.probability}%
                    </p>
                    <p className="text-xs text-[var(--brand-muted)]">{entry.drivers}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-primary-50/80 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
              <p className="badge">Cadenas de Markov (landing)</p>
              <ul className="mt-3 space-y-2">
                {insights.landingMarkov.length === 0 ? (
                  <li className="text-xs text-[var(--brand-muted)]">Sin navegación registrada.</li>
                ) : (
                  insights.landingMarkov.map((transition) => (
                    <li
                      key={`${transition.from}-${transition.to}`}
                      className="rounded-xl border border-primary-50/80 px-3 py-2 dark:border-white/10"
                    >
                      <p className="font-semibold">
                        {transition.from} ➜ {transition.to}
                      </p>
                      <p className="text-xs text-[var(--brand-muted)]">{transition.probability}% probabilidad</p>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-primary-50/80 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
              <p className="badge">Inventario · Redes Bayesianas</p>
              <ul className="mt-3 space-y-2">
                {insights.inventoryBayesian.length === 0 ? (
                  <li className="text-xs text-[var(--brand-muted)]">Sin indicadores críticos.</li>
                ) : (
                  insights.inventoryBayesian.map((item) => (
                    <li key={item.item} className="rounded-xl border border-primary-50/80 px-3 py-2 dark:border-white/10">
                      <p className="font-semibold">
                        {item.item} · Riesgo {item.risk}
                      </p>
                      <p className="text-xs text-[var(--brand-muted)]">{item.recommendation}</p>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="rounded-2xl border border-primary-50/80 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
              <p className="badge">Anomalías detectadas</p>
              <ul className="mt-3 space-y-2">
                {insights.anomalies.length === 0 ? (
                  <li className="text-xs text-[var(--brand-muted)]">No se detectaron eventos atípicos.</li>
                ) : (
                  insights.anomalies.map((anom, index) => (
                    <li
                      key={`${anom.label}-${index}`}
                      className="rounded-xl border border-danger-200/70 px-3 py-2 text-danger-700 dark:border-danger-500/30 dark:text-danger-100"
                    >
                      <p className="font-semibold">{anom.label}</p>
                      <p className="text-xs">{anom.description}</p>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </>
      )}

      {activeCluster && (
        <DetailModal onClose={() => setActiveCluster(null)}>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="badge">Cluster k-means</p>
                <h3 className="mt-2 text-2xl font-semibold text-primary-700 dark:text-primary-100">
                  {activeCluster.name}
                </h3>
                <p className="text-sm text-[var(--brand-muted)]">{activeCluster.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveCluster(null)}
                className="rounded-full border border-primary-100/70 px-3 py-1 text-xs font-semibold text-[var(--brand-text)] transition hover:bg-primary-50 dark:border-white/20 dark:text-white"
              >
                Cerrar
              </button>
            </div>
            <div
              className="rounded-3xl border border-primary-100/70 bg-white/60 p-4 dark:border-white/20 dark:bg-primary-900/20"
              onWheel={handleModalWheel}
            >
              <p className="text-xs text-[var(--brand-muted)]">
                Usa el scroll o los controles para hacer zoom (x{chartZoom.toFixed(2)}). Desplázate en el recuadro para explorar.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-primary-100/70 px-3 py-1 text-xs font-semibold text-[var(--brand-text)] hover:bg-primary-50 dark:border-white/20 dark:text-white"
                    onClick={() => handleZoomStep(-0.25)}
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.25}
                    value={chartZoom}
                    onChange={(event) => setChartZoom(clampZoom(Number(event.target.value)))}
                    className="h-1 w-32 accent-primary-500"
                  />
                  <button
                    type="button"
                    className="rounded-full border border-primary-100/70 px-3 py-1 text-xs font-semibold text-[var(--brand-text)] hover:bg-primary-50 dark:border-white/20 dark:text-white"
                    onClick={() => handleZoomStep(0.25)}
                  >
                    +
                  </button>
                </div>
                <span className="font-semibold text-primary-600 dark:text-primary-200">{chartZoom.toFixed(2)}x</span>
              </div>
              <div className="mt-3 overflow-auto" style={{ cursor: chartZoom > 1 ? 'grab' : 'default' }}>
                <ClusterChartGraphic
                  chart={activeCluster.chart}
                  width={zoomedWidth}
                  height={zoomedHeight}
                  svgRef={(element) => {
                    modalSvgRef.current = element;
                  }}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[var(--brand-muted)]">
                Centroid: {activeCluster.chart.centroid.orders} órdenes / {formatCurrency(activeCluster.chart.centroid.spent)}.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-primary-100/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-primary-600 transition hover:bg-primary-50 dark:border-white/20 dark:text-white"
                  onClick={handleDownload}
                >
                  Descargar PNG
                </button>
              </div>
            </div>
          </div>
        </DetailModal>
      )}
    </div>
  );
};

const ScannedReservationContent = ({
  reservation,
  onConfirm,
}: {
  reservation: ScannedReservation;
  onConfirm?: (reservation: ScannedReservation) => void;
}) => (
  <div className="space-y-4 text-sm">
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={() => onConfirm?.(reservation)}
        className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-white transition hover:bg-emerald-700"
      >
        Confirmar reservación
      </button>
    </div>
    <header>
      <p className="text-xs uppercase tracking-[0.35em] text-primary-400 font-bold underline">
        {reservation.code ?? reservation.id}
      </p>
      <h3 className="text-2xl font-semibold text-primary-700 dark:text-primary-100">
        Reservación escaneada
      </h3>
      <p className="text-xs text-[var(--brand-muted)]">
        {reservation.date} · {reservation.time}
      </p>
    </header>
    <div className="grid gap-3 rounded-2xl border border-primary-100/70 bg-primary-50/60 p-4 text-sm dark:border-white/10 dark:bg-white/5">
      <DetailRow label="Cliente" value={reservation.user ?? 'Desconocido'} />
      <DetailRow
        label="Personas"
        value={`${reservation.people ?? 1} ${(reservation.people ?? 1) === 1 ? 'persona' : 'personas'}`}
      />
      <DetailRow label="Sucursal" value={reservation.branch ?? reservation.branchNumber ?? '—'} />
      <DetailRow label="Mensaje" value={reservation.message ?? 'Sin mensaje'} />
    </div>
  </div>
);

const ScannedCustomerContent = ({
  customer,
  beverageOptions,
  foodOptions,
  isMenuLoading,
}: {
  customer: ScannedCustomer;
  beverageOptions: MenuItem[];
  foodOptions: MenuItem[];
  isMenuLoading?: boolean;
}) => {
  const [preferences, setPreferences] = useState({
    beverage: customer.beverage ?? '',
    food: customer.food ?? '',
  });
  const [editingField, setEditingField] = useState<'beverage' | 'food' | null>(null);
  const [draftPreference, setDraftPreference] = useState('');

  const startEditing = (field: 'beverage' | 'food') => {
    setEditingField(field);
    setDraftPreference(preferences[field] ?? '');
  };

  const savePreference = () => {
    if (!editingField) return;
    setPreferences((prev) => ({ ...prev, [editingField]: draftPreference }));
    setEditingField(null);
  };

  return (
    <div className="space-y-4 text-sm">
      <header>
        <p className="text-xs uppercase tracking-[0.35em] text-primary-400 font-bold underline">
          {customer.id}
        </p>
        <h3 className="text-2xl font-semibold text-primary-700 dark:text-primary-100">
          {`${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || 'Cliente'}
        </h3>
        <p className="text-xs text-[var(--brand-muted)]">
          {customer.email ?? 'Correo no registrado'}
        </p>
      </header>
      <div className="grid gap-3 rounded-2xl border border-primary-100/70 bg-primary-50/60 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <DetailRow label="Teléfono" value={customer.phone ?? 'No registrado'} />
        <DetailRow label="Email" value={customer.email ?? 'No registrado'} />
      </div>
      <div className="rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/10">
        <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Preferencias</p>
        <PreferenceField
          id="scan-customer-beverage"
          label="Bebida favorita"
          value={preferences.beverage}
          options={beverageOptions}
          isEditing={editingField === 'beverage'}
          draftValue={draftPreference}
          onEdit={() => startEditing('beverage')}
          onCancel={() => setEditingField(null)}
          onChange={setDraftPreference}
          onSave={savePreference}
          isLoading={isMenuLoading}
        />
        <PreferenceField
          id="scan-customer-food"
          label="Alimento favorito"
          value={preferences.food}
          options={foodOptions}
          isEditing={editingField === 'food'}
          draftValue={draftPreference}
          onEdit={() => startEditing('food')}
          onCancel={() => setEditingField(null)}
          onChange={setDraftPreference}
          onSave={savePreference}
          isLoading={isMenuLoading}
        />
      </div>
    </div>
  );
};

const PreferenceField = ({
  id,
  label,
  value,
  options,
  isEditing,
  draftValue,
  onEdit,
  onCancel,
  onChange,
  onSave,
  isLoading,
}: {
  id: string;
  label: string;
  value: string;
  options: MenuItem[];
  isEditing: boolean;
  draftValue: string;
  onEdit: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  isLoading?: boolean;
}) => (
  <div className="mt-2 border-t border-dashed border-primary-100/60 pt-3 first:mt-0 first:border-t-0 first:pt-0">
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--brand-muted)]">
        {label}
      </p>
      {!isEditing ? (
        <button
          type="button"
          onClick={onEdit}
          className="rounded-full border border-primary-100/70 px-2 py-1 text-xs text-primary-600 transition hover:border-primary-300 hover:text-primary-800 dark:border-white/20 dark:text-white"
        >
          ✏️ Modificar
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" onClick={onSave} className="brand-button text-xs">
            Guardar
          </button>
          <button type="button" onClick={onCancel} className="brand-button--ghost text-xs">
            Cancelar
          </button>
        </div>
      )}
    </div>
    {!isEditing ? (
      <p className="text-sm font-semibold text-primary-700 dark:text-primary-100">
        {value || 'Sin registro'}
      </p>
    ) : (
      <div className="mt-2">
        {isLoading ? (
          <p className="text-xs text-[var(--brand-muted)]">Sincronizando catálogo…</p>
        ) : (
          <SearchableDropdown
            id={id}
            label={label}
            options={options}
            value={draftValue || null}
            allowClear
            placeholder="Busca y selecciona"
            helperText="Cambios visibles solo en POS"
            onChange={(next) => onChange(next ?? '')}
          />
        )}
      </div>
    )}
  </div>
);

const SmartScannerPanel = ({
  onPayload,
  onClose,
  feedback,
}: {
  onPayload: (value: string) => void;
  onClose: () => void;
  feedback?: string | null;
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isDetectorSupported, setIsDetectorSupported] = useState(true);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf: number | null = null;
    let fallbackControls: import('@zxing/browser').IScannerControls | null = null;
    let fallbackReader: import('@zxing/browser').BrowserMultiFormatReader | null = null;
    const hasDetector = typeof window !== 'undefined' && Boolean(window.BarcodeDetector);
    setIsDetectorSupported(hasDetector);

    const start = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('El navegador no permite abrir la cámara. Usa la entrada manual.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setIsCameraReady(true);
        }

        if (hasDetector && window.BarcodeDetector) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const scan = async () => {
            if (!videoRef.current) {
              raf = requestAnimationFrame(scan);
              return;
            }
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0) {
                onPayload(barcodes[0].rawValue);
              }
            } catch {
              // Ignoramos errores temporales del detector.
            }
            raf = requestAnimationFrame(scan);
          };
          scan();
        } else {
          try {
            const BrowserModule = await import('@zxing/browser');
            const BrowserMultiFormatReader = BrowserModule.BrowserMultiFormatReader;
            const ZXingNotFoundException =
              (BrowserModule as Record<string, unknown>).NotFoundException ?? null;
            fallbackReader = new BrowserMultiFormatReader(undefined, {
              delayBetweenScanAttempts: 200,
              delayBetweenScanSuccess: 800,
            });
            fallbackControls = await fallbackReader.decodeFromVideoDevice(
              undefined,
              videoRef.current ?? undefined,
              (result, error) => {
                if (result?.getText()) {
                  onPayload(result.getText());
                }
                const isNotFoundError =
                  typeof ZXingNotFoundException === 'function' &&
                  error instanceof ZXingNotFoundException;
                if (error && !isNotFoundError) {
                  console.warn('QR fallback error:', error);
                }
              }
            );
            setIsDetectorSupported(true);
          } catch (fallbackError) {
            console.error('Fallback QR scanner error:', fallbackError);
            setIsDetectorSupported(false);
            setCameraError(
              fallbackError instanceof Error
                ? fallbackError.message
                : 'No pudimos inicializar el lector. Usa la entrada manual.'
            );
          }
        }
      } catch (error) {
        setCameraError(
          error instanceof Error
            ? error.message
            : 'No pudimos acceder a la cámara. Revisa los permisos del dispositivo.'
        );
      }
    };

    void start();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (raf) {
        cancelAnimationFrame(raf);
      }
      if (fallbackControls) {
        fallbackControls.stop();
      }
      if (fallbackReader) {
        if ('reset' in fallbackReader && typeof fallbackReader.reset === 'function') {
          fallbackReader.reset();
        }
        if ('stop' in fallbackReader && typeof fallbackReader.stop === 'function') {
          fallbackReader.stop();
        }
      }
    };
  }, [onPayload]);

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (manualValue.trim()) {
      onPayload(manualValue.trim());
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.35em] text-primary-500">Lector inteligente</p>
        <h3 className="text-2xl font-semibold text-primary-700 dark:text-primary-100">
          Escanear pedidos, reservas o clientes
        </h3>
        <p className="text-xs text-[var(--brand-muted)]">
          Apunta a cualquier QR generado por el POS, o ingresa el código manualmente.
        </p>
      </header>
      <div className="rounded-2xl border border-dashed border-primary-200/60 bg-black/80 p-4 text-center text-white dark:border-white/20">
        <video
          ref={videoRef}
          className="mx-auto h-48 w-full max-w-md rounded-xl border border-white/10 object-cover"
          playsInline
          muted
        />
        {!isCameraReady && !cameraError && (
          <p className="mt-2 text-xs text-white/80">Preparando la cámara…</p>
        )}
        {cameraError && (
          <p className="mt-2 text-xs text-amber-300">
            {cameraError}
          </p>
        )}
        {!isDetectorSupported && (
          <p className="mt-2 text-xs text-amber-200">
            Este navegador no soporta detección automática. Usa la entrada manual.
          </p>
        )}
      </div>
      <form onSubmit={handleManualSubmit} className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--brand-muted)]">
          Código manual
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
            placeholder="Ej. ticket POS, folio o ID cliente"
            className="flex-1 rounded-xl border border-primary-100/70 px-3 py-2 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <button type="submit" className="brand-button text-xs">
            Buscar
          </button>
        </div>
      </form>
      {feedback && (
        <p className="text-xs font-semibold text-amber-600 dark:text-amber-300">{feedback}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--brand-muted)]">
        <span>Compatible con pedidos, reservas y clientes.</span>
        <button type="button" onClick={onClose} className="text-primary-500 hover:underline">
          Detener lector
        </button>
      </div>
    </div>
  );
};

const Snackbar = ({ message, onClose }: { message: string; onClose: () => void }) => (
  <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
    <div className="flex items-center gap-3 rounded-2xl bg-primary-900/90 px-4 py-2 text-sm text-white shadow-lg">
      <span>{message}</span>
      <button type="button" onClick={onClose} className="text-xs uppercase tracking-[0.3em]">
        Cerrar
      </button>
    </div>
  </div>
);

const DetailRow = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-[var(--brand-muted)]">{label}</span>
    <span className="font-semibold text-primary-800 dark:text-primary-100">{value}</span>
  </div>
);

const PaymentBreakdown = ({
  payments,
  totalTips,
}: {
  payments: PaymentsDashboard | null;
  totalTips: number;
}) => {
  const methods = payments?.methodBreakdown ?? [];
  const statuses = payments?.statusBreakdown ?? [];

  return (
    <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 dark:border-white/10 dark:bg-white/10">
      <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-200">
        Distribución de pagos
      </h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Métodos</p>
          <div className="mt-2 space-y-2">
            {methods.length === 0 ? (
              <p className="text-sm text-[var(--brand-muted)]">Sin movimientos recientes.</p>
            ) : (
              methods.map((method) => (
                <div
                  key={method.method}
                  className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10"
                >
                  <span className="capitalize">{method.method}</span>
                  <span className="font-semibold text-primary-600 dark:text-primary-200">
                    {formatCurrency(method.amount)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">Estatus</p>
          <div className="mt-2 space-y-2">
            {statuses.length === 0 ? (
              <p className="text-sm text-[var(--brand-muted)]">Sin datos.</p>
            ) : (
              statuses.map((status) => (
                <div
                  key={status.status}
                  className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10"
                >
                  <span className="capitalize">{status.status}</span>
                  <span className="font-semibold">{status.count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-2xl bg-primary-50/80 px-3 py-2 text-sm dark:bg-white/5">
        Propinas capturadas: <span className="font-semibold">{formatCurrency(totalTips)}</span>
      </div>
    </div>
  );
};

const PaymentActivity = ({ payments }: { payments: PaymentsDashboard | null }) => {
  const paymentList = payments?.payments ?? [];
  const pendingReports = payments?.pendingReports ?? [];

  return (
    <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 dark:border-white/10 dark:bg-white/10">
      <h3 className="text-lg font-semibold text-primary-600 dark:text-primary-200">
        Actividad reciente
      </h3>
      <div className="mt-3 space-y-2">
        {paymentList.length === 0 ? (
          <p className="text-sm text-[var(--brand-muted)]">Sin pagos registrados.</p>
        ) : (
          paymentList.slice(0, 5).map((payment) => (
            <div
              key={payment.id}
              className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10"
            >
              <div>
                <p className="font-semibold">{payment.method ?? 'Método'}</p>
                <p className="text-xs text-[var(--brand-muted)]">
                  {payment.order?.orderNumber ?? payment.orderId ?? 'Sin pedido'} ·{' '}
                  {payment.status ?? 'status'}
                </p>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold">{formatCurrency(payment.amount ?? 0)}</p>
                <p className="text-xs text-[var(--brand-muted)]">
                  {payment.createdAt ? formatDate(payment.createdAt) : '—'}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-4 rounded-2xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10">
        <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">
          Reportes pendientes
        </p>
        {pendingReports.length === 0 ? (
          <p className="text-sm text-[var(--brand-muted)]">Sin reportes en cola.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {pendingReports.map((report) => (
              <li key={report.id} className="flex items-center justify-between">
                <span>
                  {report.scope} · {report.granularity}
                </span>
                <span className="text-xs text-[var(--brand-muted)] capitalize">
                  {report.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
const ReservationsSearchBar = ({
  onSearch,
  isLoading,
  onRefresh,
  onShowPast,
  onShowCompleted,
  showCompletedButton,
}: {
  onSearch: (value: string) => void;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onShowPast: () => void;
  onShowCompleted?: () => void;
  showCompletedButton?: boolean;
}) => {
  const [value, setValue] = useState('');

  return (
    <div className="flex flex-col gap-2 text-xs text-[var(--brand-muted)]">
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(value);
        }}
      >
        <label className="flex flex-col text-[var(--brand-muted)]">
          <span className="font-semibold uppercase tracking-[0.25em]">Buscar ID o nombre</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="ID, nombre o email del cliente"
            className="mt-1 rounded-xl border border-primary-100/70 px-3 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-white"
          />
        </label>
        <button type="submit" className="brand-button text-xs">
          Buscar
        </button>
        <button
          type="button"
          onClick={() => {
            setValue('');
            onSearch('');
          }}
          className="brand-button--ghost text-xs"
        >
          Limpiar
        </button>
        <div className="flex items-center gap-3">
          {isLoading && <span>Actualizando...</span>}
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="rounded-full border border-primary-200 px-3 py-1 font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-white/20 dark:text-primary-200"
          >
            Refrescar
          </button>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onShowPast} className="brand-button text-xs">
          Pasadas
        </button>
        {showCompletedButton && onShowCompleted && (
          <button type="button" onClick={onShowCompleted} className="brand-button text-xs">
            Completadas
          </button>
        )}
      </div>
    </div>
  );
};

const ReservationHistoryContent = ({
  title,
  reservations,
  onClose,
  hasFilter,
  onSelect,
}: {
  title: string;
  reservations: Reservation[];
  onClose: () => void;
  hasFilter: boolean;
  onSelect?: (reservation: Reservation) => void;
}) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return reservations;
    }
    const term = query.trim().toLowerCase();
    const matches = (value?: string | null) => value?.toLowerCase().includes(term) ?? false;
    return reservations.filter((reservation) =>
      buildReservationSearchTerms(reservation).some(matches)
    );
  }, [query, reservations]);

  return (
    <div className="space-y-4 text-[var(--brand-text)] dark:text-white">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-semibold">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold uppercase tracking-[0.3em] text-[var(--brand-text)] underline dark:text-white"
        >
          Cerrar
        </button>
      </div>
      <form
        className="flex flex-wrap items-center gap-2 text-xs text-white/80"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="flex flex-col text-white/70">
          <span className="font-semibold uppercase tracking-[0.25em]">Buscar ID o nombre</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ID, nombre o email del cliente"
            className="mt-1 rounded-xl border border-white/20 bg-transparent px-3 py-1 text-sm text-white focus:border-white focus:outline-none"
          />
        </label>
        <button type="submit" className="brand-button text-xs">
          Buscar
        </button>
        {query && (
          <button type="button" onClick={() => setQuery('')} className="brand-button--ghost text-xs">
            Limpiar
          </button>
        )}
      </form>
      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--brand-muted)] dark:text-white/80">
          {query
            ? `No encontramos ${title.toLowerCase()} con ese ID o nombre.`
            : hasFilter
              ? `No encontramos ${title.toLowerCase()} con ese filtro.`
              : `No hay ${title.toLowerCase()} disponibles.`}
        </p>
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-2">
          {filtered.map((reservation) => (
            <ReservationCard
              key={reservation.id}
              reservation={reservation}
              onSelect={() => {
                onSelect?.(reservation);
                onClose();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const LedgerEntriesModal = ({
  entries,
  onClose,
}: {
  entries: OrderPaymentMetricsSummary['entries'];
  onClose: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return entries;
    }
    const term = query.trim().toLowerCase();
    const matches = (value?: string | null) => value?.toLowerCase().includes(term) ?? false;
    return entries.filter((entry) =>
      [entry.reference, entry.paymentMethod, entry.debitAccount, entry.creditAccount].some(matches)
    );
  }, [entries, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-4 text-sm text-[var(--brand-text)] dark:text-white">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-semibold">Libro mayor completo</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold uppercase tracking-[0.3em] text-[var(--brand-text)] underline dark:text-white"
        >
          Cerrar
        </button>
      </div>
      <form
        className="flex flex-wrap items-center gap-2 text-xs text-[var(--brand-muted)] dark:text-white/80"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="flex flex-col text-[var(--brand-muted)] dark:text-white/70">
          <span className="font-semibold uppercase tracking-[0.25em]">Buscar</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Ticket, cuenta o método"
            className="mt-1 rounded-xl border border-primary-100/70 bg-transparent px-3 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:text-white"
          />
        </label>
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setPage(1);
            }}
            className="brand-button--ghost text-xs"
          >
            Limpiar
          </button>
        )}
      </form>
      {visible.length === 0 ? (
        <p className="text-xs text-[var(--brand-muted)] dark:text-white/80">
          {filtered.length === 0 ? 'Sin resultados con ese criterio.' : 'Esta página no tiene registros.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-auto text-xs">
            <thead>
              <tr className="text-left text-[var(--brand-muted)]">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Monto</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Hora</th>
                <th className="px-3 py-2">Debe</th>
                <th className="px-3 py-2">Propina</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry, index) => {
                const date = new Date(entry.date);
                return (
                  <tr
                    key={entry.id}
                    className="border-t border-primary-50/70 text-[var(--brand-text)] dark:border-white/10 dark:text-white"
                  >
                    <td className="px-3 py-2 text-[var(--brand-muted)]">
                      {(currentPage - 1) * pageSize + index + 1}
                    </td>
                    <td className="px-3 py-2 font-semibold">{entry.reference}</td>
                    <td className="px-3 py-2">{formatCurrency(entry.amount)}</td>
                    <td className="px-3 py-2">{date.toLocaleDateString('es-MX')}</td>
                    <td className="px-3 py-2">
                      {date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2">{entry.debitAccount}</td>
                    <td className="px-3 py-2">
                      {entry.tipAmount > 0 ? formatCurrency(entry.tipAmount) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > pageSize && (
        <PaginationControls
          page={currentPage}
          totalPages={totalPages}
          totalItems={filtered.length}
          onPrev={() => setPage((prev) => Math.max(1, prev - 1))}
          onNext={() => setPage((prev) => Math.min(totalPages, prev + 1))}
        />
      )}
    </div>
  );
};

const HistoryModalShell = ({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
    <div
      className="absolute inset-0 bg-black/60 backdrop-blur"
      role="presentation"
      onClick={onClose}
    />
    <div className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#1f1613] p-6 text-white shadow-2xl">
      {children}
    </div>
  </div>
);

const PaginationControls = ({
  page,
  totalPages,
  totalItems,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPrev: () => void;
  onNext: () => void;
}) => (
  <div className="mt-3 flex items-center justify-between text-xs text-[var(--brand-muted)]">
    <button
      type="button"
      onClick={onPrev}
      className="rounded-full border border-primary-100/70 px-2 py-1 transition hover:border-primary-300 hover:text-primary-600 dark:border-white/10 disabled:opacity-40"
      disabled={page <= 1}
    >
      ‹
    </button>
    <span className="font-semibold">
      Página {page} de {totalPages} · {totalItems} registros
    </span>
    <button
      type="button"
      onClick={onNext}
      className="rounded-full border border-primary-100/70 px-2 py-1 transition hover:border-primary-300 hover:text-primary-600 dark:border-white/10 disabled:opacity-40"
      disabled={page >= totalPages}
    >
      ›
    </button>
  </div>
);

// --- Staff utility drawer & panels ---------------------------------------------------------------

interface StaffUtilityDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (view: StaffPanelView) => void;
  onLogout: () => void;
  user: AuthenticatedStaff;
  sessionDuration: string;
  hasCampaignNotifications: boolean;
}

const StaffUtilityDrawer = ({
  open,
  onClose,
  onSelect,
  onLogout,
  user,
  sessionDuration,
  hasCampaignNotifications,
}: StaffUtilityDrawerProps) => {
  const isManager = user.role === 'gerente';
  const isSocio = user.role === 'socio' || user.role === 'superuser';
  const isSuperUser = user.role === 'superuser' || SUPER_USER_EMAILS.has(user.email.toLowerCase());
  return (
    <aside
      className={`fixed right-4 top-12 z-30 w-64 max-h-[85vh] overflow-y-auto rounded-3xl border border-primary-100/70 bg-white/95 p-4 shadow-2xl transition transform dark:border-white/10 dark:bg-neutral-900/90 ${
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[120%] opacity-0'
      }`}
    >
      <div className="flex items-center justify-between text-xs text-[var(--brand-muted)]">
        <p className="font-semibold uppercase tracking-[0.3em]">Barra rápida</p>
        <div className="flex items-center gap-1">
          {isSocio && (
            <button
              type="button"
              className="relative flex items-center gap-1 rounded-full border border-primary-100/80 px-3 py-1 text-[10px] font-semibold text-primary-600 hover:border-primary-300 dark:border-white/20 dark:text-primary-200"
              onClick={() => onSelect('campaign')}
            >
              <span aria-hidden="true">🔔</span>
              <span>Notificaciones</span>
              {hasCampaignNotifications && (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
              )}
            </button>
          )}
          <button type="button" onClick={onClose} className="font-semibold">
            ×
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm font-medium text-[var(--brand-text)]">{user.email}</p>
      <p className="text-xs text-[var(--brand-muted)]">Sesión: {sessionDuration}</p>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <button
          type="button"
          className="rounded-2xl border border-primary-100/70 px-3 py-2 text-left font-semibold text-[var(--brand-text)] transition hover:border-primary-300 dark:border-white/10"
          onClick={() => onSelect('profile')}
        >
        Mi perfil
      </button>
      <button
        type="button"
        className="rounded-2xl border border-primary-100/70 px-3 py-2 text-left font-semibold text-[var(--brand-text)] transition hover:border-primary-300 dark:border-white/10"
        onClick={() => onSelect('metrics')}
      >
        Mis números
      </button>
      <button
        type="button"
        className="rounded-2xl border border-primary-100/70 px-3 py-2 text-left font-semibold text-[var(--brand-text)] transition hover:border-primary-300 dark:border-white/10"
        onClick={() => onSelect('salary')}
      >
        Mi salario y permisos
      </button>
      <button
        type="button"
        className="rounded-2xl border border-primary-100/70 px-3 py-2 text-left font-semibold text-[var(--brand-text)] transition hover:border-primary-300 dark:border-white/10"
        onClick={() => onSelect('cleaning')}
      >
        Bitácora de limpieza
      </button>
        <div className="mt-4 border-t border-primary-100/50 pt-4 dark:border-white/10">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Tema</p>
          <div className="mt-2">
            <ThemeToggle />
          </div>
        </div>
        {(isManager || isSocio) && (
          <div className="mt-4 space-y-2 border-t border-primary-100/50 pt-4 text-xs dark:border-white/10">
            <p className="uppercase tracking-[0.3em] text-[var(--brand-muted)]">Gerencia</p>
            <button
              type="button"
            className="w-full rounded-2xl border border-amber-300 bg-amber-100 px-3 py-2 text-left font-semibold text-amber-900 shadow-sm transition hover:border-amber-400 hover:bg-amber-100 dark:border-amber-300/40 dark:bg-amber-900/20 dark:text-amber-200"
            onClick={() => onSelect('inventory')}
          >
            Inventarios
          </button>
          <button
            type="button"
            className="w-full rounded-2xl border border-emerald-300 bg-emerald-100 px-3 py-2 text-left font-semibold text-emerald-900 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-300/40 dark:bg-emerald-900/20 dark:text-emerald-100"
            onClick={() => onSelect('managerSalaries')}
          >
            Salarios
          </button>
          <button
            type="button"
            className="w-full rounded-2xl border border-sky-300 bg-sky-100 px-3 py-2 text-left font-semibold text-sky-900 shadow-sm transition hover:border-sky-400 hover:bg-sky-100 dark:border-sky-300/40 dark:bg-sky-900/20 dark:text-sky-100"
            onClick={() => onSelect('managerTips')}
          >
            Propinas
          </button>
          <button
            type="button"
            className="w-full rounded-2xl border border-primary-100/70 bg-white/60 px-3 py-2 text-left font-semibold text-[var(--brand-text)] transition hover:border-primary-300 dark:border-white/20 dark:bg-white/5"
            onClick={() => onSelect('managerEmployees')}
          >
            Empleados
          </button>
          <button
            type="button"
            className="w-full rounded-2xl border border-primary-100/70 bg-white/60 px-3 py-2 text-left font-semibold text-[var(--brand-text)] transition hover:border-primary-300 dark:border-white/20 dark:bg-white/5"
            onClick={() => onSelect('managerPayments')}
            >
              Pagos y cortes
            </button>
          </div>
        )}
        {isSocio && (
          <div className="mt-4 space-y-2 border-t border-primary-100/50 pt-4 text-xs dark:border-white/10">
            <p className="uppercase tracking-[0.3em] text-[var(--brand-muted)]">Consejo</p>
            <button
              type="button"
              className="w-full rounded-2xl border border-primary-100/70 bg-white/60 px-3 py-2 text-left font-semibold text-[var(--brand-text)] transition hover:border-primary-300 dark:border-white/20 dark:bg-white/5"
              onClick={() => onSelect('governance')}
            >
              Gobernanza
            </button>
            <button
              type="button"
              className="w-full rounded-2xl border border-primary-100/70 bg-white/60 px-3 py-2 text-left font-semibold text-[var(--brand-text)] transition hover:border-primary-300 dark:border-white/20 dark:bg-white/5"
              onClick={() => onSelect('approvals')}
            >
              Aprobaciones de empleados
            </button>
            {isSuperUser && (
              <button
                type="button"
                className="w-full rounded-2xl border border-primary-300/80 bg-primary-50/60 px-3 py-2 text-left font-semibold text-primary-700 transition hover:border-primary-400 dark:border-primary-300/40 dark:bg-primary-900/30 dark:text-primary-100"
                onClick={() => onSelect('superuser')}
              >
                Super usuarios
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          className="mt-2 rounded-2xl border border-danger-200 bg-danger-50/70 px-3 py-2 text-sm font-semibold text-danger-600 transition hover:bg-danger-100 dark:border-danger-500/40 dark:bg-danger-900/30 dark:text-danger-200"
          onClick={onLogout}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
};

interface StaffSidePanelProps {
  view: StaffPanelView;
  onClose: () => void;
  onSwitchView: (view: StaffPanelView | null) => void;
  viewerEmail: string;
  profile: {
    name: string;
    branch: string;
    role: string;
    tenure: TenureBreakdown;
    startedAt?: string | null;
    sessionDuration: string;
    hourlyRate: number;
  };
  metrics: {
    hoursWorked: number;
    roundedHours: number;
    daysWorked: number;
    ordersHandled: number;
    tipShare: number;
    salaryEstimate: number;
    punctualityRate: number;
    administrativeFaults: number;
    benefits: BenefitsPackage;
    sessions: StaffSessionRecord[];
    prepTasks: PrepTask[];
  };
  salary: {
    hourlyRate: number;
    roundedHours: number;
    salaryEstimate: number;
    tipShare: number;
    benefits: BenefitsPackage;
    paidLeaveCalendar: PaidLeaveDay[];
  };
  cleaning: {
    schedule: CleaningAssignment[];
    branch: string;
  };
  onChangePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<void>;
  shiftType: ShiftType;
  isManager: boolean;
  isSocio: boolean;
  isSuperUser: boolean;
  managerInventory: InventoryState;
  onInventoryChange: (category: InventoryCategoryId, itemId: string, quantity: number) => void;
  onInventorySync: () => void;
  managerSalaryDraft: ManagerSalaryDraft;
  onManagerSalaryDraftChange: (patch: Partial<ManagerSalaryDraft>) => void;
  managerTipsDraft: ManagerTipsDraft;
  onManagerTipsDraftChange: (patch: Partial<ManagerTipsDraft>) => void;
  staffData: StaffDashboard | null;
  staffLoading: boolean;
  staffError: string | null;
  onRefreshStaff: () => Promise<void>;
  payments: PaymentsDashboard | null;
  paymentsLoading: boolean;
  onRefreshPayments: () => Promise<void>;
  canViewAccounting: boolean;
  branchName: string;
  orderPaymentMetrics: OrderPaymentMetricsSummary | null;
  governanceRequests: GovernanceRequest[];
  onGovernanceDecision: (
    requestId: string,
    reviewer: string,
    decision: 'approved' | 'declined',
    comment: string
  ) => void;
  approvalTickets: ApprovalTicket[];
  onApprovalDecision: (ticketId: string, decision: 'approved' | 'declined', note?: string) => void;
  campaignFeed: CampaignNotification[];
  onCampaignNavigate: (view: StaffPanelView) => void;
  secureSnapshot: Record<string, string>;
  superUserQueue: SuperUserAction[];
  onCreateSuperUserAction: (payload: { email: string; role: StaffRole; note?: string }) => void;
}

const StaffSidePanel = ({
  view,
  onClose,
  onSwitchView,
  viewerEmail,
  profile,
  metrics,
  salary,
  cleaning,
  onChangePassword,
  shiftType,
  isManager,
  isSocio,
  isSuperUser,
  managerInventory,
  onInventoryChange,
  onInventorySync,
  managerSalaryDraft,
  onManagerSalaryDraftChange,
  managerTipsDraft,
  onManagerTipsDraftChange,
  staffData,
  staffLoading,
  staffError,
  onRefreshStaff,
  payments,
  paymentsLoading,
  onRefreshPayments,
  canViewAccounting,
  orderPaymentMetrics,
  branchName,
  governanceRequests,
  onGovernanceDecision,
  approvalTickets,
  onApprovalDecision,
  campaignFeed,
  onCampaignNavigate,
  secureSnapshot,
  superUserQueue,
  onCreateSuperUserAction,
}: StaffSidePanelProps) => {
  if (!view) {
    return null;
  }

  const titles: Record<Exclude<StaffPanelView, null>, string> = {
    profile: 'Mi perfil',
    metrics: 'Mis números',
    salary: 'Mi salario',
    cleaning: 'Bitácora de limpieza',
    inventory: 'Registro de mercancía',
    managerSalaries: 'Salarios del equipo',
    managerTips: 'Propinas y reparto',
    managerEmployees: 'Empleados',
    managerPayments: 'Pagos y cortes',
    governance: 'Gobernanza',
    approvals: 'Aprobaciones',
    campaign: 'Campaña',
    superuser: 'Super usuario',
  };
  const panelTitle = titles[view];

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-md flex-col bg-[var(--brand-bg)] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">
            {panelTitle}
          </p>
          <button
            type="button"
            className="rounded-full border border-primary-100/60 px-3 py-1 text-xs font-semibold text-[var(--brand-muted)] hover:border-primary-200"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
        <div className="mt-4 flex-1 overflow-y-auto pr-2">
          {view === 'profile' && (
            <StaffProfilePanel
              profile={profile}
              shiftType={shiftType}
              onChangePassword={onChangePassword}
              isManager={isManager}
              onOpenInventory={() => onSwitchView('inventory')}
            />
          )}
          {view === 'metrics' && <StaffMetricsPanel metrics={metrics} shiftType={shiftType} />}
          {view === 'salary' && <StaffSalaryPanel salary={salary} shiftType={shiftType} />}
          {view === 'cleaning' && <CleaningLogPanel cleaning={cleaning} />}
          {view === 'inventory' && (
            <ManagerInventoryPanel
              inventory={managerInventory}
              onQuantityChange={onInventoryChange}
              onSyncMenu={onInventorySync}
              branchName={branchName}
              canEdit={isSocio}
            />
          )}
          {view === 'managerSalaries' && (
            <ManagerPayrollPanel
              draft={managerSalaryDraft}
              onChange={onManagerSalaryDraftChange}
              canManagePaidLeave={isSocio}
            />
          )}
          {view === 'managerTips' && (
            <ManagerTipsPanel
              draft={managerTipsDraft}
              onChange={onManagerTipsDraftChange}
              payments={payments}
              encryptedSnapshot={secureSnapshot}
              viewerEmail={viewerEmail}
              orderMetrics={orderPaymentMetrics}
              showTipShare={isSocio}
            />
          )}
          {view === 'managerEmployees' && (
            <ManagerEmployeesPanel
              staffData={staffData}
              staffLoading={staffLoading}
              staffError={staffError}
              onRefreshStaff={onRefreshStaff}
              showHierarchy={isSocio}
              salaryReference={managerSalaryDraft}
            />
          )}
          {view === 'managerPayments' && (
            <ManagerPaymentsPanel
              payments={payments}
              paymentsLoading={paymentsLoading}
              onRefreshPayments={onRefreshPayments}
              orderMetrics={orderPaymentMetrics}
              canViewAccounting={isSocio}
            />
          )}
          {view === 'governance' && (
            <GovernancePanel
              requests={governanceRequests}
              viewerEmail={viewerEmail}
              onDecision={onGovernanceDecision}
              isSocio={isSocio}
            />
          )}
          {view === 'approvals' && (
            <EmployeeApprovalsPanel tickets={approvalTickets} onDecision={onApprovalDecision} />
          )}
          {view === 'campaign' && (
            <CampaignPanel items={campaignFeed} onNavigate={onCampaignNavigate} />
          )}
          {view === 'superuser' && isSuperUser && (
            <SuperUserAdminPanel queue={superUserQueue} onCreateAction={onCreateSuperUserAction} />
          )}
        </div>
      </div>
    </div>
  );
};

const StaffProfilePanel = ({
  profile,
  shiftType,
  onChangePassword,
  isManager,
  onOpenInventory,
}: {
  profile: StaffSidePanelProps['profile'];
  shiftType: ShiftType;
  onChangePassword: StaffSidePanelProps['onChangePassword'];
  isManager: boolean;
  onOpenInventory: () => void;
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    if (newPassword !== confirmPassword) {
      setStatus({ type: 'error', message: 'La confirmación no coincide.' });
      return;
    }
    setIsSubmitting(true);
    try {
      await onChangePassword({ currentPassword, newPassword });
      setStatus({ type: 'success', message: 'Contraseña actualizada.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'No pudimos actualizar la contraseña.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
        <p className="text-sm font-semibold text-[var(--brand-text)]">{profile.name}</p>
        <p className="text-xs text-[var(--brand-muted)]">
          {profile.branch} · {profile.role}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[var(--brand-muted)]">Antigüedad</p>
            <p className="font-semibold">
              {profile.tenure.years}a · {profile.tenure.months}m · {profile.tenure.days}d
            </p>
          </div>
          <div>
            <p className="text-[var(--brand-muted)]">Sesión activa</p>
            <p className="font-semibold">{profile.sessionDuration}</p>
          </div>
          <div>
            <p className="text-[var(--brand-muted)]">Ingreso</p>
            <p className="font-semibold">
              {profile.startedAt ? new Date(profile.startedAt).toLocaleDateString('es-MX') : '—'}
            </p>
          </div>
          <div>
            <p className="text-[var(--brand-muted)]">Turno</p>
            <p className="font-semibold">{shiftType === 'full_time' ? 'Tiempo completo' : 'Medio tiempo'}</p>
          </div>
        </div>
      </div>
      {isManager && (
        <button
          type="button"
          className="w-full rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-left text-sm font-semibold text-amber-900 transition hover:border-amber-300 dark:border-amber-300/40 dark:bg-amber-900/30 dark:text-amber-50"
          onClick={onOpenInventory}
        >
          Registro de mercancía · actualiza insumos de alimentos, bebidas, limpieza y desechables.
        </button>
      )}
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5"
      >
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Cambio de contraseña</p>
        <label className="space-y-1">
          <span className="text-[var(--brand-muted)]">Contraseña actual</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[var(--brand-muted)]">Nueva contraseña</span>
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[var(--brand-muted)]">Confirmar contraseña</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        {status && (
          <p
            className={`rounded-2xl px-3 py-2 text-xs ${
              status.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-danger-50 text-danger-700'
            } dark:bg-white/10`}
          >
            {status.message}
          </p>
        )}
        <button type="submit" className="brand-button w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Actualizar contraseña'}
        </button>
        <p className="text-xs text-[var(--brand-muted)]">
          Debe incluir al menos 10 caracteres, mayúsculas, minúsculas, número y símbolo.
        </p>
      </form>
    </div>
  );
};

const StaffMetricsPanel = ({
  metrics,
  shiftType,
}: {
  metrics: StaffSidePanelProps['metrics'];
  shiftType: ShiftType;
}) => {
  const sessionList = metrics.sessions.slice(0, 5);
  const prepSummary = metrics.prepTasks.slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <MetricPill label="Horas trabajadas" value={`${metrics.hoursWorked.toFixed(1)} h`} />
        <MetricPill label="Días registrados" value={`${metrics.daysWorked}`} />
        <MetricPill label="Pedidos atendidos" value={`${metrics.ordersHandled}`} />
        <MetricPill label="Propinas estimadas" value={formatCurrency(metrics.tipShare)} />
        <MetricPill label="Salario estimado" value={formatCurrency(metrics.salaryEstimate)} />
        <MetricPill label="Puntualidad" value={`${Math.round(metrics.punctualityRate * 100)}%`} />
        <MetricPill
          label="Faltas administrativas"
          value={metrics.administrativeFaults ? `${metrics.administrativeFaults}` : '0'}
        />
        <MetricPill label="Turno" value={shiftType === 'full_time' ? 'Tiempo completo' : 'Medio tiempo'} />
      </div>
      <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Últimas sesiones</p>
                    <div className="mt-3 space-y-2">
                      {sessionList.length === 0 ? (
                        <p className="text-xs text-[var(--brand-muted)]">Aún no hay registros.</p>
                      ) : (
                        sessionList.map((session) => {
                          const durationSeconds = resolveSessionDurationSeconds(session);
                          return (
                            <div
                              key={session.id}
                              className="flex justify-between rounded-2xl bg-white/70 px-3 py-2 dark:bg-white/10"
                            >
                              <div>
                                <p className="font-semibold">
                                  {session.sessionStart
                                    ? new Date(session.sessionStart).toLocaleDateString('es-MX', {
                                        weekday: 'short',
                                        day: '2-digit',
                                        month: 'short',
                                      })
                                    : 'Sin fecha'}
                                </p>
                                <p className="text-xs text-[var(--brand-muted)]">
                                  {durationSeconds > 0 ? formatSessionDuration(durationSeconds) : 'En progreso'}
                                </p>
                              </div>
                              <span className="text-xs text-[var(--brand-muted)]">
                                {session.sessionStart
                                  ? new Date(session.sessionStart).toLocaleTimeString('es-MX', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—'}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
      </div>
      <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">
          Actividad en cola de producción
        </p>
        <div className="mt-3 space-y-2">
          {prepSummary.length === 0 ? (
            <p className="text-xs text-[var(--brand-muted)]">Aún no tienes asignaciones.</p>
          ) : (
            prepSummary.map((task) => (
              <div key={task.id} className="rounded-2xl bg-white/70 px-3 py-2 dark:bg-white/10">
                <p className="font-semibold">{task.product?.name ?? 'Producto'}</p>
                <p className="text-xs text-[var(--brand-muted)]">{task.status.toUpperCase()}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const StaffSalaryPanel = ({
  salary,
  shiftType,
}: {
  salary: StaffSidePanelProps['salary'];
  shiftType: ShiftType;
}) => (
  <div className="space-y-4">
    <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <MetricPill label="Tarifa hora" value={formatCurrency(salary.hourlyRate)} />
        <MetricPill label="Horas pagadas" value={`${salary.roundedHours}`} />
        <MetricPill label="Salario base" value={formatCurrency(salary.salaryEstimate)} />
        <MetricPill label="Propinas" value={formatCurrency(salary.tipShare)} />
      </div>
      <div className="mt-4 rounded-2xl bg-primary-50/70 p-3 text-xs text-primary-900 dark:bg-primary-900/30 dark:text-primary-100">
        {shiftType === 'full_time'
          ? 'Bono sujeto a puntualidad, comentarios positivos y métricas del equipo.'
          : 'Baristas de medio tiempo participan con 40% de la bolsa de propinas.'}
      </div>
    </div>
    <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
      <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Prestaciones estimadas</p>
      <div className="mt-3 space-y-2">
        <div className="flex justify-between">
          <span>Prima vacacional</span>
          <span className="font-semibold">{formatCurrency(salary.benefits.vacationBonus)}</span>
        </div>
        <div className="flex justify-between">
          <span>Aguinaldo proporcional</span>
          <span className="font-semibold">{formatCurrency(salary.benefits.aguinaldo)}</span>
        </div>
        <div className="flex justify-between">
          <span>Días con goce</span>
          <span className="font-semibold">{salary.benefits.paidLeaveDays}</span>
        </div>
      </div>
    </div>
    <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
      <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Calendario</p>
      <PaidLeaveCalendar days={salary.paidLeaveCalendar} />
    </div>
  </div>
);

const CleaningLogPanel = ({ cleaning }: { cleaning: StaffSidePanelProps['cleaning'] }) => {
  const [statuses, setStatuses] = useState<Record<string, CleaningAssignment['status']>>(() => {
    const map: Record<string, CleaningAssignment['status']> = {};
    cleaning.schedule.forEach((assignment) => {
      map[assignment.date] = assignment.status;
    });
    return map;
  });

  const advanceStatus = (date: string) => {
    setStatuses((prev) => {
      const next = prev[date] === 'pending' ? 'in_review' : 'approved';
      return { ...prev, [date]: next };
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Sucursal</p>
        <p className="font-semibold">{cleaning.branch}</p>
        <p className="text-xs text-[var(--brand-muted)]">Asignaciones próximas 14 días</p>
      </div>
      <div className="space-y-3">
        {cleaning.schedule.map((assignment) => {
          const status = statuses[assignment.date] ?? assignment.status;
          const dateLabel = new Date(assignment.date).toLocaleDateString('es-MX', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
          });
          return (
            <div key={assignment.date} className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{dateLabel}</p>
                  <p className="text-xs text-[var(--brand-muted)]">
                    {assignment.isWeekend || assignment.isHoliday ? 'Fin de semana / festivo' : assignment.shift}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    status === 'pending'
                      ? 'bg-amber-100 text-amber-700'
                      : status === 'in_review'
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {status === 'pending' ? 'Pendiente' : status === 'in_review' ? 'Esperando socio' : 'Aprobado'}
                </span>
              </div>
              <p className="mt-3 text-sm">
                Responsable: <span className="font-semibold">{assignment.owner}</span>
              </p>
              <p className="text-xs text-[var(--brand-muted)]">Aprobará: {assignment.approver}</p>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-[var(--brand-muted)]">
                  {assignment.note ?? 'Limpieza completa de baños y área común.'}
                </p>
                {status !== 'approved' && (
                  <button type="button" className="brand-button text-xs" onClick={() => advanceStatus(assignment.date)}>
                    {status === 'pending' ? 'Notificar socio' : 'Marcar aprobado'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface ManagerInventoryPanelProps {
  inventory: InventoryState;
  onQuantityChange: (category: InventoryCategoryId, itemId: string, quantity: number) => void;
  onSyncMenu: () => void;
  branchName: string;
  canEdit: boolean;
}

const INVENTORY_CATEGORY_META: Record<
  InventoryCategoryId,
  { label: string; description: string; accent: string }
> = {
  foods: { label: 'Alimentos', description: 'Verduras, frutas, panes y toppings.', accent: 'border-rose-100/70' },
  beverages: { label: 'Insumos de bebidas', description: 'Jarabes, lácteos, bases y shots.', accent: 'border-sky-100/70' },
  cleaning: { label: 'Insumos de limpieza', description: 'Limpieza de barra, piso y cocina.', accent: 'border-emerald-100/70' },
  disposables: { label: 'Desechables', description: 'Vasos, tapas, removedores, servilletas.', accent: 'border-amber-100/70' },
};

const ManagerInventoryPanel = ({
  inventory,
  onQuantityChange,
  onSyncMenu,
  branchName,
  canEdit,
}: ManagerInventoryPanelProps) => {
  const [editing, setEditing] = useState<{ category: InventoryCategoryId; id: string } | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [categoryEditing, setCategoryEditing] = useState<Record<InventoryCategoryId, boolean>>({
    foods: false,
    beverages: false,
    cleaning: false,
    disposables: false,
  });

  useEffect(() => {
    if (!canEdit) {
      setCategoryEditing({ foods: false, beverages: false, cleaning: false, disposables: false });
      setEditing(null);
    }
  }, [canEdit]);

  const startEditing = (category: InventoryCategoryId, item: InventoryItem) => {
    setEditing({ category, id: item.id });
    setDraftValue(String(item.quantity));
  };

  const handleSave = () => {
    if (!editing) return;
    const numericValue = Number.parseInt(draftValue, 10);
    onQuantityChange(editing.category, editing.id, Number.isFinite(numericValue) ? numericValue : 0);
    setEditing(null);
  };

  const orderedCategories: InventoryCategoryId[] = ['foods', 'beverages', 'cleaning', 'disposables'];

  const toggleCategoryEditing = (category: InventoryCategoryId) => {
    if (!canEdit) {
      return;
    }
    setCategoryEditing((prev) => ({ ...prev, [category]: !prev[category] }));
    setEditing(null);
  };

  return (
    <div className="space-y-5 text-sm">
      <p className="text-[var(--brand-muted)]">
        Registra manualmente los insumos críticos. Las cantidades iniciales toman como referencia el dropdown del pedido y los catálogos base.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-2xl border border-primary-100/70 bg-white/70 px-4 py-2 text-xs font-semibold text-primary-600 transition hover:border-primary-200 dark:border-white/10 dark:bg-white/10 dark:text-primary-100"
          onClick={onSyncMenu}
        >
          Sincronizar con menú de pedidos
        </button>
        <p className="text-xs text-[var(--brand-muted)]">Sucursal asignada: {branchName}</p>
      </div>
      {orderedCategories.map((category) => {
        const items = inventory[category] ?? [];
        const meta = INVENTORY_CATEGORY_META[category];
        const isCategoryEditing = categoryEditing[category];
        return (
          <div
            key={category}
            className={`rounded-3xl border ${meta.accent} bg-white/80 p-4 dark:border-white/10 dark:bg-white/5`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">{meta.label}</p>
                <p className="text-xs text-[var(--brand-muted)]">{meta.description}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--brand-muted)]">
                <span>{items.length} insumos</span>
                {canEdit && (
                  <button
                    type="button"
                    className="rounded-full border border-primary-100/70 px-2 py-1 text-[10px] font-semibold text-primary-600 hover:border-primary-300 dark:border-white/10 dark:text-primary-200"
                    onClick={() => toggleCategoryEditing(category)}
                  >
                    ✎
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3 divide-y divide-primary-50/60 dark:divide-white/10">
              {items.length === 0 ? (
                <p className="py-2 text-xs text-[var(--brand-muted)]">Sin insumos sincronizados.</p>
              ) : (
                items.map((item) => {
                  const isEditing = isCategoryEditing && editing?.category === category && editing.id === item.id;
                  return (
                    <div key={item.id} className="flex items-center gap-3 py-2">
                      <div className="w-16 text-center font-mono text-lg font-semibold text-primary-600 dark:text-primary-200">
                        {item.quantity}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">{item.name}</p>
                        <p className="text-xs text-[var(--brand-muted)]">Sucursal: {branchName}</p>
                        {item.unit && <p className="text-xs text-[var(--brand-muted)]">Unidad: {item.unit}</p>}
                      </div>
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={draftValue}
                            onChange={(event) => setDraftValue(event.target.value)}
                            className="w-20 rounded-xl border border-primary-100/70 px-2 py-1 text-sm focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
                          />
                          <button
                            type="button"
                            className="rounded-xl bg-primary-600 px-3 py-1 text-xs font-semibold text-white"
                            onClick={handleSave}
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            className="text-xs text-[var(--brand-muted)] underline-offset-2 hover:underline"
                            onClick={() => setEditing(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            isCategoryEditing && canEdit
                              ? 'border-primary-300 text-primary-600'
                              : 'border-primary-100/60 text-[var(--brand-muted)]'
                          }`}
                          onClick={() => {
                            if (!canEdit || !isCategoryEditing) return;
                            startEditing(category, item);
                          }}
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface ManagerPayrollPanelProps {
  draft: ManagerSalaryDraft;
  onChange: (patch: Partial<ManagerSalaryDraft>) => void;
  canManagePaidLeave: boolean;
}

const ManagerPayrollPanel = ({ draft, onChange, canManagePaidLeave }: ManagerPayrollPanelProps) => {
  const monthlyWithBonus = draft.baseMonthly * (1 + draft.bonusPercent / 100);
  return (
    <div className="space-y-4 text-sm">
      <p className="text-[var(--brand-muted)]">
        Captura ajustes manuales de salario. La lógica automática para gerentes se implementará después, así que documenta tus cambios aquí.
      </p>
      <label className="space-y-1">
        <span className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Base mensual (MXN)</span>
        <input
          type="number"
          value={draft.baseMonthly}
          min={0}
          onChange={(event) => onChange({ baseMonthly: Number(event.target.value) || 0 })}
          className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
        />
      </label>
      <label className="space-y-1">
        <span className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">% Bono por desempeño</span>
        <input
          type="number"
          value={draft.bonusPercent}
          min={0}
          max={60}
          onChange={(event) => onChange({ bonusPercent: Number(event.target.value) || 0 })}
          className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
        />
      </label>
      <label className="space-y-1">
        <span className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Notas</span>
        <textarea
          rows={3}
          value={draft.remarks}
          onChange={(event) => onChange({ remarks: event.target.value })}
          className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
        />
      </label>
      {canManagePaidLeave && (
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Días con goce de sueldo</span>
          <input
            type="number"
            value={draft.paidLeaveDays}
            min={0}
            max={30}
            onChange={(event) => onChange({ paidLeaveDays: Number(event.target.value) || 0 })}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
      )}
      <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Resumen manual</p>
        <p className="mt-2 text-2xl font-semibold text-primary-700">{formatCurrency(monthlyWithBonus)}</p>
        <p className="text-xs text-[var(--brand-muted)]">Pendiente de integrar con las asistencias.</p>
      </div>
    </div>
  );
};

interface ManagerTipsPanelProps {
  draft: ManagerTipsDraft;
  onChange: (patch: Partial<ManagerTipsDraft>) => void;
  payments: PaymentsDashboard | null;
  encryptedSnapshot: Record<string, string>;
  viewerEmail: string;
  orderMetrics?: OrderPaymentMetricsSummary | null;
  showTipShare?: boolean;
}

const ManagerTipsPanel = ({
  draft,
  onChange,
  payments,
  encryptedSnapshot,
  viewerEmail,
  orderMetrics,
  showTipShare = false,
}: ManagerTipsPanelProps) => {
  const [decryptedSnapshot, setDecryptedSnapshot] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!viewerEmail || Object.keys(encryptedSnapshot).length === 0) {
        setDecryptedSnapshot({});
        return;
      }
      try {
        const entries = await Promise.all(
          Object.entries(encryptedSnapshot).map(async ([key, value]) => [
            key,
            await decryptField(value, viewerEmail),
          ])
        );
        if (!cancelled) {
          setDecryptedSnapshot(Object.fromEntries(entries));
        }
      } catch {
        if (!cancelled) {
          setDecryptedSnapshot({});
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [encryptedSnapshot, viewerEmail]);

  const hasSnapshot = Object.keys(encryptedSnapshot).length > 0;
  const detectedTips = orderMetrics?.tips24h ?? payments?.totalTips ?? 0;
  const monthlyTips =
    orderMetrics?.monthlyTips ?? payments?.monthlyTipsTotal ?? payments?.totalTips ?? 0;
  const monthlyTipShare = orderMetrics?.tipShare ?? {
    total: monthlyTips,
    barista: monthlyTips * 0.4,
    manager: monthlyTips * 0.6,
  };

  return (
    <div className="space-y-4 text-sm">
    <p className="text-[var(--brand-muted)]">
      Ajusta el fondo de propinas manualmente y deja constancia para tu corte. Usa el reporte automático como referencia.
    </p>
    <div className="grid gap-4 rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5 sm:grid-cols-2">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Propinas detectadas</p>
        <p className="text-2xl font-semibold">{formatCurrency(detectedTips)}</p>
        <p className="text-xs text-[var(--brand-muted)]">Últimas 24h</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Fondo manual</p>
        <p className="text-2xl font-semibold text-primary-700">
          {formatCurrency((draft.pool ?? 0) + (draft.manualAdjustment ?? 0))}
        </p>
        <p className="text-xs text-[var(--brand-muted)]">
          {draft.lastModified ? `Actualizado ${new Date(draft.lastModified).toLocaleString('es-MX')}` : 'Sin cambios recientes'}
        </p>
      </div>
    </div>
    {showTipShare && (
      <div className="grid gap-4 rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Baristas (40%)</p>
          <p className="text-2xl font-semibold text-primary-700">{formatCurrency(monthlyTipShare.barista)}</p>
          <p className="text-xs text-[var(--brand-muted)]">Mes actual</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Gerentes (60%)</p>
          <p className="text-2xl font-semibold text-primary-700">{formatCurrency(monthlyTipShare.manager)}</p>
          <p className="text-xs text-[var(--brand-muted)]">Mes actual</p>
        </div>
      </div>
    )}
    {showTipShare && (
      <div className="grid gap-4 rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Baristas (40%)</p>
          <p className="text-2xl font-semibold text-primary-700">{formatCurrency(monthlyTipShare.barista)}</p>
          <p className="text-xs text-[var(--brand-muted)]">Mes actual</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Gerentes (60%)</p>
          <p className="text-2xl font-semibold text-primary-700">{formatCurrency(monthlyTipShare.manager)}</p>
          <p className="text-xs text-[var(--brand-muted)]">Mes actual</p>
        </div>
      </div>
    )}
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Fondo base</span>
      <input
        type="number"
        value={draft.pool}
        min={0}
        onChange={(event) => onChange({ pool: Number(event.target.value) || 0 })}
        className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
      />
    </label>
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Ajuste manual</span>
      <input
        type="number"
        value={draft.manualAdjustment}
        onChange={(event) => onChange({ manualAdjustment: Number(event.target.value) || 0 })}
        className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
      />
    </label>
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Notas de reparto</span>
      <textarea
        rows={3}
        value={draft.distributionNote}
        onChange={(event) => onChange({ distributionNote: event.target.value })}
        className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
      />
    </label>
      <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-xs dark:border-white/10 dark:bg-white/5">
        <p className="uppercase tracking-[0.3em] text-[var(--brand-muted)]">Campos cifrados AES-GCM</p>
        {!hasSnapshot ? (
          <p className="mt-2 text-[var(--brand-muted)]">
            Inicia sesión como socio o super usuario para generar/leer el snapshot con la llave {viewerEmail}.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[var(--brand-muted)]">Valores descifrados</p>
            <ul className="mt-1 space-y-1 font-mono text-[11px] text-primary-700 dark:text-primary-200">
              {Object.entries(decryptedSnapshot).map(([key, value]) => (
                <li key={key}>
                  {key}: {value}
                </li>
              ))}
            </ul>
            <details className="mt-3">
              <summary className="cursor-pointer text-[var(--brand-muted)]">Ver cadenas cifradas</summary>
              <ul className="mt-1 space-y-1 font-mono text-[10px] text-primary-600 dark:text-primary-200">
                {Object.entries(encryptedSnapshot).map(([key, value]) => (
                  <li key={`enc-${key}`}>
                    {key}: {value}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </div>
  );
};

interface ManagerEmployeesPanelProps {
  staffData: StaffDashboard | null;
  staffLoading: boolean;
  staffError: string | null;
  onRefreshStaff: () => Promise<void>;
  showHierarchy?: boolean;
  salaryReference?: ManagerSalaryDraft;
}

const StaffHierarchyTree = ({
  staff,
  salaryReference,
}: {
  staff: StaffMember[];
  salaryReference?: ManagerSalaryDraft;
}) => {
  const formatLabel = (member: StaffMember) => {
    const name =
      member.firstNameEncrypted?.trim() ||
      member.lastNameEncrypted?.trim() ||
      member.email?.split('@')[0] ||
      member.email ||
      member.id;
    const branch = member.branchId ?? 'Sin sucursal';
    const salary = (() => {
      if (member.role === 'gerente') {
        return salaryReference?.baseMonthly ?? 15000;
      }
      if (member.role === 'socio' || member.role === 'superuser') {
        return (salaryReference?.baseMonthly ?? 15000) * 1.5;
      }
      return HOURLY_RATE * 160;
    })();
    return `${name} · ${branch} · ${formatCurrency(salary)}`;
  };

  const buildSection = (title: string, members: StaffMember[]) => {
    if (!members.length) {
      return `${title}\n└─ Sin registros`;
    }
    return [
      title,
      ...members.map((member, index) => {
        const connector = index === members.length - 1 ? '└─' : '├─';
        return `${connector} ${formatLabel(member)}`;
      }),
    ].join('\n');
  };

  const socios = staff.filter((member) => member.role === 'socio' || member.role === 'superuser');
  const gerentes = staff.filter((member) => member.role === 'gerente');
  const baristas = staff.filter((member) => member.role === 'barista');

  return (
    <pre className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 font-mono text-xs text-[var(--brand-text)] dark:border-white/10 dark:bg-white/5 dark:text-white">
{buildSection('Socios', socios)}
\n{buildSection('Gerentes', gerentes)}
\n{buildSection('Baristas', baristas)}
    </pre>
  );
};

const ManagerEmployeesPanel = ({
  staffData,
  staffLoading,
  staffError,
  onRefreshStaff,
  showHierarchy,
  salaryReference,
}: ManagerEmployeesPanelProps) => (
  <div className="space-y-4 text-sm">
    {showHierarchy && (staffData?.staff?.length ?? 0) > 0 && (
      <StaffHierarchyTree staff={staffData!.staff} salaryReference={salaryReference} />
    )}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[var(--brand-muted)]">Consulta roles, personas activas y sesiones en curso.</p>
      <button
        type="button"
        onClick={() => void onRefreshStaff()}
        className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
      >
        Actualizar staff
      </button>
    </div>
    {staffLoading && <p className="text-xs text-[var(--brand-muted)]">Consultando registros…</p>}
    {staffError ? (
      <p className="rounded-2xl border border-danger-200/60 bg-danger-50/70 px-3 py-2 text-sm text-danger-700 dark:border-danger-500/40 dark:bg-danger-900/30 dark:text-danger-200">
        {staffError}
      </p>
    ) : (
      <>
        <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Roles activos</p>
          <div className="mt-3 space-y-2">
            {(staffData?.metrics?.roles ?? []).map((role) => (
              <div
                key={role.role}
                className="flex items-center justify-between rounded-2xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10"
              >
                <span className="capitalize">{role.role}</span>
                <span className="font-semibold">{role.count}</span>
              </div>
            ))}
            {(staffData?.metrics?.roles?.length ?? 0) === 0 && (
              <p className="text-xs text-[var(--brand-muted)]">Aún no hay roles registrados.</p>
            )}
          </div>
        </div>
        <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Sesiones abiertas</p>
          <div className="mt-3 space-y-2">
            {(staffData?.sessions ?? []).slice(0, 6).map((session) => {
              const durationSeconds = resolveSessionDurationSeconds(session);
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-2xl border border-primary-50/80 px-3 py-2 text-xs dark:border-white/10"
                >
                  <div>
                    <p className="font-semibold">
                      {session.staff?.email ?? session.staffId ?? session.id.slice(0, 6)}
                    </p>
                    <p className="text-[var(--brand-muted)]">
                      Inicio: {session.sessionStart ? new Date(session.sessionStart).toLocaleString('es-MX') : '—'}
                    </p>
                  </div>
                  <span className="text-[var(--brand-muted)]">
                    {durationSeconds > 0 ? formatSessionDuration(durationSeconds) : 'En curso'}
                  </span>
                </div>
              );
            })}
            {(staffData?.sessions?.length ?? 0) === 0 && (
              <p className="text-xs text-[var(--brand-muted)]">Sin sesiones activas.</p>
            )}
          </div>
        </div>
      </>
    )}
  </div>
);

interface ManagerPaymentsPanelProps {
  payments: PaymentsDashboard | null;
  paymentsLoading: boolean;
  onRefreshPayments: () => Promise<void>;
  orderMetrics?: OrderPaymentMetricsSummary | null;
  canViewAccounting?: boolean;
}

const ManagerPaymentsPanel = ({
  payments,
  paymentsLoading,
  onRefreshPayments,
  orderMetrics,
  canViewAccounting,
}: ManagerPaymentsPanelProps) => {
  const preferOrders = Boolean(canViewAccounting && orderMetrics?.hasData);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const sales24h = preferOrders ? orderMetrics!.sales24h : payments?.totalAmount ?? 0;
  const tips24h = preferOrders ? orderMetrics!.tips24h : payments?.totalTips ?? 0;
  const monthlyTips = preferOrders
    ? orderMetrics!.monthlyTips
    : payments?.monthlyTipsTotal ?? payments?.totalTips ?? 0;
  const monthStartLabel = preferOrders
    ? orderMetrics!.monthStart.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
    : payments?.monthlyTipPeriodStart
      ? new Date(payments.monthlyTipPeriodStart).toLocaleDateString('es-MX', {
          day: '2-digit',
          month: 'short',
        })
      : 'inicio de mes';
  const salesDescription = preferOrders ? 'Pedidos completados hoy.' : 'Pagos capturados';
  const tipsDescription = preferOrders
    ? 'Propinas registradas en pedidos completados hoy.'
    : 'Incluye todas las propinas capturadas hoy.';
  const methodBreakdown = preferOrders
    ? orderMetrics?.methodTotals ?? []
    : payments?.methodBreakdown ?? [];
  const ledgerEntries = preferOrders ? orderMetrics?.entries ?? [] : [];

  return (
    <div className="space-y-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[var(--brand-muted)]">Resumen rápido de pagos y propinas para cortes diarios.</p>
      <button
        type="button"
        onClick={() => void onRefreshPayments()}
        className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
      >
        Actualizar pagos
      </button>
    </div>
    {paymentsLoading && <p className="text-xs text-[var(--brand-muted)]">Sincronizando datos…</p>}
    <div className="grid gap-4 rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Ventas (24h)</p>
        <p className="text-2xl font-semibold">{formatCurrency(sales24h)}</p>
        <p className="text-xs text-[var(--brand-muted)]">{salesDescription}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Propinas (24h)</p>
        <p className="text-2xl font-semibold">{formatCurrency(tips24h)}</p>
        <p className="text-xs text-[var(--brand-muted)]">{tipsDescription}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Propinas del mes</p>
        <p className="text-2xl font-semibold">{formatCurrency(monthlyTips)}</p>
        <p className="text-xs text-[var(--brand-muted)]">Desde {monthStartLabel} · reinicia cada mes</p>
      </div>
    </div>
    <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Métodos</p>
      <div className="mt-3 space-y-2">
        {methodBreakdown.length > 0 ? (
          methodBreakdown.map((entry) => (
            <div
              key={entry.method}
              className="flex items-center justify-between rounded-2xl border border-primary-50/80 px-3 py-2 text-xs dark:border-white/10"
            >
              <span className="capitalize">{entry.method}</span>
              <span className="font-semibold">{formatCurrency(entry.amount)}</span>
            </div>
          ))
        ) : (
          <p className="text-xs text-[var(--brand-muted)]">Sin pagos registrados.</p>
        )}
      </div>
    </div>
    {canViewAccounting && ledgerEntries.length > 0 && (
      <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 text-xs dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <p className="uppercase tracking-[0.3em] text-[var(--brand-muted)]">Libro mayor</p>
          <button
            type="button"
            className="text-[var(--brand-muted)] underline-offset-4 hover:underline"
            onClick={() => setShowLedgerModal(true)}
          >
            Ver todo
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {ledgerEntries.slice(0, 3).map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-primary-50/80 px-3 py-2 dark:border-white/10">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{formatCurrency(entry.amount)}</span>
                <span className="text-[var(--brand-muted)]">
                  {new Date(entry.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                </span>
              </div>
              <p className="text-[var(--brand-muted)]">Ticket {entry.reference}</p>
              <p className="text-[var(--brand-muted)]">
                Debe: {entry.debitAccount} · Haber: {entry.creditAccount}
              </p>
              {entry.tipAmount > 0 && (
                <p className="text-[var(--brand-muted)]">Propina ligada: {formatCurrency(entry.tipAmount)}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    )}
    {canViewAccounting && showLedgerModal && (
      <HistoryModalShell onClose={() => setShowLedgerModal(false)}>
        <LedgerEntriesModal entries={ledgerEntries} onClose={() => setShowLedgerModal(false)} />
      </HistoryModalShell>
    )}
    {canViewAccounting && showLedgerModal && (
      <HistoryModalShell onClose={() => setShowLedgerModal(false)}>
        <LedgerEntriesModal entries={ledgerEntries} onClose={() => setShowLedgerModal(false)} />
      </HistoryModalShell>
    )}
    <div className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Últimos pagos</p>
      <div className="mt-3 space-y-2">
        {(payments?.payments ?? []).slice(0, 5).map((payment) => (
          <div key={payment.id} className="rounded-2xl border border-primary-50/80 px-3 py-2 text-xs dark:border-white/10">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{formatCurrency(payment.amount ?? 0)}</p>
              <span className="uppercase tracking-[0.2em] text-[var(--brand-muted)]">{payment.method ?? 'otro'}</span>
            </div>
            <p className="text-[var(--brand-muted)]">
              {payment.createdAt ? new Date(payment.createdAt).toLocaleString('es-MX') : '—'} · Ticket{' '}
              {payment.ticketId ?? payment.orderId ?? '—'}
            </p>
          </div>
        ))}
        {(payments?.payments?.length ?? 0) === 0 && (
          <p className="text-xs text-[var(--brand-muted)]">Sin pagos disponibles.</p>
        )}
      </div>
    </div>
    </div>
  );
};

const GovernancePanel = ({
  requests,
  viewerEmail,
  onDecision,
  isSocio,
}: {
  requests: GovernanceRequest[];
  viewerEmail: string;
  onDecision: (requestId: string, reviewer: string, decision: 'approved' | 'declined', comment: string) => void;
  isSocio: boolean;
}) => {
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  const handleAction = (requestId: string, decision: 'approved' | 'declined') => {
    onDecision(requestId, viewerEmail, decision, commentDraft[requestId] ?? '');
    setCommentDraft((prev) => ({ ...prev, [requestId]: '' }));
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-[var(--brand-muted)]">
        Los cambios críticos requieren dos aprobaciones de socios en un plazo máximo de {SOCIO_REVIEW_DEADLINE_DAYS} días hábiles.
      </p>
      {requests.map((request) => {
        const reviewerSlot = request.approvals.find((approval) => approval.reviewer === viewerEmail);
        const canAct =
          isSocio &&
          GOVERNANCE_REVIEWERS.has(viewerEmail.toLowerCase()) &&
          !!reviewerSlot &&
          reviewerSlot.decision === 'pending';
        const dueDate = new Date(
          new Date(request.createdAt).getTime() + SOCIO_REVIEW_DEADLINE_DAYS * 86400000
        ).toLocaleDateString('es-MX');
        return (
          <div key={request.id} className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">
                  {request.type.toUpperCase()} · {request.branch}
                </p>
                <p className="text-lg font-semibold">{request.employee}</p>
                <p className="text-xs text-[var(--brand-muted)]">Creado por {request.createdBy}</p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  request.status === 'pending'
                    ? 'bg-amber-100 text-amber-700'
                    : request.status === 'approved'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-primary-100 text-primary-700'
                }`}
              >
                {request.status}
              </span>
            </div>
            <p className="mt-2 text-xs text-[var(--brand-muted)]">Revisores: {request.watchers.join(', ')}</p>
            <p className="text-xs text-[var(--brand-muted)]">Fecha límite: {dueDate}</p>
            <div className="mt-3 space-y-3">
              {request.approvals.map((approval) => (
                <div key={approval.reviewer} className="flex items-center justify-between rounded-2xl border border-primary-50/80 px-3 py-2 text-xs dark:border-white/10">
                  <span>{approval.reviewer}</span>
                  <span className="font-semibold capitalize">{approval.decision}</span>
                </div>
              ))}
            </div>
            {canAct && (
              <div className="mt-3 space-y-2">
                <textarea
                  rows={2}
                  placeholder="Comentario para la decisión (obligatorio si rechazas)."
                  value={commentDraft[request.id] ?? ''}
                  onChange={(event) => setCommentDraft((prev) => ({ ...prev, [request.id]: event.target.value }))}
                  className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 text-xs focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
                />
                <div className="flex gap-2">
                  <button type="button" className="brand-button flex-1 text-xs" onClick={() => handleAction(request.id, 'approved')}>
                    Aprobar
                  </button>
                  <button
                    type="button"
                    className="brand-button--ghost flex-1 text-xs text-danger-600"
                    onClick={() => handleAction(request.id, 'declined')}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            )}
            {request.comments.length > 0 && (
              <div className="mt-3 space-y-2 rounded-2xl border border-primary-50/70 p-2 text-xs dark:border-white/10">
                {request.comments.map((comment) => (
                  <div key={comment.createdAt}>
                    <p className="font-semibold">{comment.author}</p>
                    <p>{comment.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const EmployeeApprovalsPanel = ({
  tickets,
  onDecision,
}: {
  tickets: ApprovalTicket[];
  onDecision: (ticketId: string, decision: 'approved' | 'declined', note?: string) => void;
}) => (
  <div className="space-y-4 text-sm">
    <p className="text-[var(--brand-muted)]">Define aprobaciones para goce de honorarios, limpieza y evaluaciones.</p>
    {tickets.map((ticket) => (
      <div key={ticket.id} className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">{ticket.category}</p>
            <p className="text-lg font-semibold">{ticket.employee}</p>
            <p className="text-xs text-[var(--brand-muted)]">Fecha límite: {new Date(ticket.dueDate).toLocaleDateString('es-MX')}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              ticket.status === 'approved'
                ? 'bg-emerald-100 text-emerald-700'
                : ticket.status === 'declined'
                  ? 'bg-danger-100 text-danger-700'
                  : 'bg-amber-100 text-amber-700'
            }`}
          >
            {ticket.status}
          </span>
        </div>
        <p className="mt-2 text-xs text-[var(--brand-muted)]">{ticket.notes}</p>
        {ticket.status === 'pending' && (
          <div className="mt-3 flex gap-2">
            <button type="button" className="brand-button flex-1 text-xs" onClick={() => onDecision(ticket.id, 'approved')}>
              Aprobar
            </button>
            <button
              type="button"
              className="brand-button--ghost flex-1 text-xs text-danger-600"
              onClick={() => onDecision(ticket.id, 'declined', 'Se requieren ajustes')}
            >
              Rechazar
            </button>
          </div>
        )}
      </div>
    ))}
  </div>
);

const CampaignPanel = ({
  items,
  onNavigate,
}: {
  items: CampaignNotification[];
  onNavigate: (view: StaffPanelView) => void;
}) => (
  <div className="space-y-4 text-sm">
    <p className="text-[var(--brand-muted)]">Notificaciones recientes del consejo y acciones pendientes.</p>
    {items.map((item) => (
      <div key={item.id} className="rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">{item.id}</p>
        <h4 className="text-lg font-semibold text-primary-700">{item.title}</h4>
        <p className="text-xs text-[var(--brand-muted)]">{item.body}</p>
        <button
          type="button"
          className="mt-3 brand-button text-xs"
          onClick={() => onNavigate(item.relatedView ?? 'governance')}
        >
          Revisar
        </button>
      </div>
    ))}
  </div>
);

const SuperUserAdminPanel = ({
  queue,
  onCreateAction,
}: {
  queue: SuperUserAction[];
  onCreateAction: (payload: { email: string; role: StaffRole; note?: string }) => void;
}) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('socio');
  const [note, setNote] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;
    onCreateAction({ email, role, note });
    setEmail('');
    setNote('');
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-[var(--brand-muted)]">Crea o elimina socios directamente desde este panel.</p>
      <form onSubmit={handleSubmit} className="space-y-3 rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
        <label className="space-y-1 text-xs">
          <span className="font-semibold uppercase tracking-[0.3em]">Correo</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold uppercase tracking-[0.3em]">Rol</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as StaffRole)}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          >
            <option value="socio">Socio</option>
            <option value="gerente">Gerente</option>
            <option value="barista">Barista</option>
            <option value="superuser">Super usuario</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold uppercase tracking-[0.3em]">Notas</span>
          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-2xl border border-primary-100/70 bg-white px-3 py-2 focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <button type="submit" className="brand-button w-full text-xs">
          Registrar acción
        </button>
      </form>
      <div className="space-y-2">
        {queue.map((action) => (
          <div key={action.id} className="rounded-2xl border border-primary-50/80 px-3 py-2 text-xs dark:border-white/10">
            <p className="font-semibold">{action.email}</p>
            <p className="text-[var(--brand-muted)]">
              {action.role} · {action.status}
            </p>
            {action.note && <p className="text-[var(--brand-muted)]">Nota: {action.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
};

const MetricPill = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-primary-100/60 bg-white/70 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5">
    <p className="text-[var(--brand-muted)]">{label}</p>
    <p className="text-base font-semibold text-[var(--brand-text)]">{value}</p>
  </div>
);

const PaidLeaveCalendar = ({ days }: { days: PaidLeaveDay[] }) => (
  <div className="grid grid-cols-2 gap-2 text-xs">
    {days.map((day) => (
      <div
        key={day.date}
        className={`rounded-2xl border px-3 py-2 ${
          day.isEligible ? 'border-primary-200 bg-primary-50 text-primary-900' : 'border-primary-50 text-[var(--brand-muted)]'
        }`}
      >
        <p className="font-semibold">
          {new Date(day.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
        </p>
        <p>{day.reason}</p>
      </div>
    ))}
  </div>
);

const buildStaffDisplayName = (user: AuthenticatedStaff) => {
  const first = user.firstName?.trim() ?? '';
  const last = user.lastName?.trim() ?? '';
  const combined = `${first} ${last}`.trim();
  if (combined) {
    return combined;
  }
  const [local] = user.email.split('@');
  return local || user.email;
};

const formatSessionDuration = (seconds: number) => {
  const hrs = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0');
  const mins = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
};

const resolveSessionDurationSeconds = (session: StaffSessionRecord, referenceTimestamp = Date.now()) => {
  if (typeof session.durationSeconds === 'number' && Number.isFinite(session.durationSeconds)) {
    return Math.max(0, Math.floor(session.durationSeconds));
  }
  const startTs = session.sessionStart ? Date.parse(session.sessionStart) : NaN;
  if (!Number.isFinite(startTs)) {
    return 0;
  }
  const endTs = session.sessionEnd ? Date.parse(session.sessionEnd) : NaN;
  const upperTs = Number.isFinite(endTs) ? endTs : referenceTimestamp;
  const durationMs = Math.max(0, upperTs - startTs);
  return Math.floor(durationMs / 1000);
};

const computeTenure = (startedAt?: string | null): TenureBreakdown => {
  if (!startedAt) {
    return { years: 0, months: 0, days: 0, totalDays: 0 };
  }
  const start = new Date(startedAt);
  const diffMs = Date.now() - start.getTime();
  const totalDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const years = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const days = totalDays % 30;
  return { years, months, days, totalDays };
};

const computePunctualityScore = (sessions: StaffSessionRecord[]) => {
  if (!sessions.length) {
    return 1;
  }
  const punctual = sessions.filter((session) => {
    if (!session.sessionStart) {
      return true;
    }
    const date = new Date(session.sessionStart);
    return date.getHours() <= 8;
  });
  return punctual.length / sessions.length;
};

const computeAdministrativeFaults = (sessions: StaffSessionRecord[]) => {
  if (!sessions.length) {
    return 0;
  }
  const attendance = new Set(
    sessions
      .map((session) => session.sessionStart?.substring(0, 10) ?? null)
      .filter(Boolean) as string[]
  );
  let faults = 0;
  let streak = 0;
  for (let i = 0; i < 14; i += 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = date.toISOString().substring(0, 10);
    const isRestDay = date.getDay() === 1;
    if (isRestDay || attendance.has(key)) {
      streak = 0;
      continue;
    }
    streak += 1;
    if (streak >= 3) {
      faults += 1;
    }
  }
  return faults;
};

const buildBenefitsPackage = ({
  salaryBase,
  daysWorked,
  shiftType,
}: {
  salaryBase: number;
  daysWorked: number;
  shiftType: ShiftType;
}): BenefitsPackage => {
  const vacationBonus = salaryBase * 0.25;
  const aguinaldo = 278.8 * 15 * Math.min(1, daysWorked / 365);
  const paidLeaveDays = daysWorked >= 365 ? Math.max(0, Math.floor((daysWorked - 365) / 30)) : 0;
  return {
    vacationBonus,
    aguinaldo,
    paidLeaveDays,
    bonusEligible: shiftType === 'full_time',
    tipSharePercent: shiftType === 'full_time' ? 0.6 : 0.4,
  };
};

const buildPaidLeaveCalendar = (startedAt: string | null | undefined, daysWorked: number): PaidLeaveDay[] => {
  const calendar: PaidLeaveDay[] = [];
  const base = startedAt ? new Date(startedAt) : new Date();
  for (let i = 0; i < 8; i += 1) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const formatted = date.toISOString();
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const eligible = daysWorked >= 365 + 12 && date >= addDays(base, 372);
    calendar.push({
      date: formatted,
      isEligible: eligible && !isWeekend,
      reason: eligible ? 'Disponible' : 'Bloqueado',
      isWeekend,
    });
  }
  return calendar;
};

const buildCleaningSchedule = ({
  user,
  staff,
}: {
  user: AuthenticatedStaff;
  staff: StaffMember[];
}): CleaningAssignment[] => {
  const entries: CleaningAssignment[] = [];
  const socios = staff.filter((member) => member.role === 'socio');
  const baristas = staff.filter((member) => member.role === 'barista');
  for (let i = 0; i < 14; i += 1) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const formatted = date.toISOString();
    const key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const isHoliday = MX_HOLIDAYS.has(key);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const approver = socios[i % Math.max(1, socios.length)];
    const owner =
      isWeekend || isHoliday
        ? socios[(i + 1) % Math.max(1, socios.length)] ?? user
        : baristas[i % Math.max(1, baristas.length)] ?? user;
    entries.push({
      date: formatted,
      owner: owner?.email ?? user.email,
      shift: i % 2 === 0 ? 'Inicio del día' : 'Final del día',
      approver: approver?.email ?? 'Socio pendiente',
      status: 'pending',
      note:
        isWeekend || isHoliday
          ? 'Coordinar limpieza con doble aprobación de socios (fin de semana/festivo).'
          : 'Alternar turno: completo abre, medio tiempo cierra.',
      isWeekend,
      isHoliday,
    });
  }
  return entries;
};

const addDays = (date: Date, amount: number) => {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + amount);
  return clone;
};
