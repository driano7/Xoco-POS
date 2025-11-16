'use client';

import { ThemeToggle } from '@/components/theme-toggle';
import { useOrders } from '@/hooks/use-orders';
import { useReservations } from '@/hooks/use-reservations';
import { useLoyalty } from '@/hooks/use-loyalty';
import { usePrepQueue } from '@/hooks/use-prep-queue';
import { usePayments } from '@/hooks/use-payments';
import { useStaff } from '@/hooks/use-staff';
import { usePartnerMetrics } from '@/hooks/use-partner-metrics';
import { usePagination } from '@/hooks/use-pagination';
import { OrdersPanel } from '@/components/orders-panel';
import { NewOrderModal } from '@/components/order/new-order-modal';
import { CustomerLoyaltyCoffees } from '@/components/customer-loyalty-coffees';
import { SearchableDropdown } from '@/components/searchable-dropdown';
import { useMenuOptions, type MenuItem } from '@/hooks/use-menu-options';
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
  TicketDetail,
} from '@/lib/api';
import {
  enqueueOrder,
  completeOrder,
  completePrepTask,
  completeReservation,
  fetchTicketDetail,
} from '@/lib/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

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

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const groupOrders = (orders: Order[]) => {
  const pending: Order[] = [];
  const past: Order[] = [];
  const completed: Order[] = [];

  orders.forEach((order) => {
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

const groupPrepTasks = (tasks: PrepTask[]) => {
  const activeStatuses = new Set(['pending', 'in_progress']);
  const active = tasks.filter((task) => activeStatuses.has(task.status));
  const completed = tasks.filter((task) => !activeStatuses.has(task.status));
  return { active, completed };
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

type NavSection = 'home' | 'metrics' | 'employees' | 'payments' | 'permissions' | 'notifications';

const NAV_ITEMS: { id: NavSection; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'metrics', label: 'Métricas' },
  { id: 'employees', label: 'Empleados' },
  { id: 'payments', label: 'Pagos y cortes' },
  { id: 'permissions', label: 'Permisos' },
  { id: 'notifications', label: 'Notificaciones' },
];

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
    staffData,
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
  const [activeSection, setActiveSection] = useState<NavSection>('home');
  const [reservationOverrides, setReservationOverrides] = useState<Record<string, 'completed'>>({});
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [showNewOrderForm, setShowNewOrderForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const {
    beverageOptions,
    foodOptions,
    isLoading: menuLoading,
    error: menuError,
    refresh: refreshMenu,
  } = useMenuOptions();
  const reservationsWithOverrides = useMemo(
    () =>
      reservations.map((reservation) =>
        reservationOverrides[reservation.id]
          ? { ...reservation, status: reservationOverrides[reservation.id] }
          : reservation
      ),
    [reservationOverrides, reservations]
  );
  const { pending, past: pastOrders, completed } = useMemo(() => groupOrders(orders), [orders]);
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
      list.filter((reservation) =>
        [reservation.id, reservation.reservationCode].some(matches)
      );
    return {
      pending: filterList(basePendingReservations),
      past: filterList(basePastReservations),
      completed: filterList(baseCompletedReservations),
    };
  }, [baseCompletedReservations, basePastReservations, basePendingReservations, reservationFilter]);
  const pendingReservations = filteredReservations.pending;
  const pastReservations = filteredReservations.past;
  const completedReservations = filteredReservations.completed;
  const reservationCounts = {
    pending: basePendingReservations.length,
    past: basePastReservations.length,
    completed: baseCompletedReservations.length,
  };
  const { active: activePrep, completed: completedPrep } = useMemo(
    () => groupPrepTasks(prepTasks),
    [prepTasks]
  );
  const topCustomer = loyaltyStats?.topCustomer ?? null;
  const totalSales = payments?.totalAmount ?? 0;
  const totalTips = payments?.totalTips ?? 0;
  const staffActive = staffData?.metrics.activeStaff ?? 0;
  const staffTotal = staffData?.metrics.totalStaff ?? 0;
  const reservationsSectionId = 'reservations-panel';
  const [detail, setDetail] = useState<DetailState>(null);
  const [showReservationHistory, setShowReservationHistory] = useState(false);
  const [actionState, setActionState] = useState<DetailActionState>({
    isLoading: false,
    message: null,
    error: null,
  });
  const [scannerFeedback, setScannerFeedback] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [prefilledClientId, setPrefilledClientId] = useState<string | null>(null);
  const loyaltyCustomers = loyaltyStats?.customers ?? [];
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

  const scrollToReservations = () => {
    const el = document.getElementById(reservationsSectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCustomerSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCustomerFilter(customerQuery.trim());
  };

  const rememberClientId = useCallback((value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed) {
      setPrefilledClientId(trimmed);
    }
  }, []);

  const handleOpenNewOrder = useCallback((clientId?: string | null) => {
    if (clientId?.trim()) {
      setPrefilledClientId(clientId.trim());
    }
    setActiveSection('home');
    setShowNewOrderForm(true);
  }, [setActiveSection]);

  const handleCloseNewOrder = useCallback(() => {
    setShowNewOrderForm(false);
    setPrefilledClientId(null);
  }, []);

  const handleOpenScanner = useCallback(() => {
    setActiveSection('home');
    setShowScanner(true);
  }, []);

  const handleCloseScanner = useCallback(() => {
    setShowScanner(false);
    setScannerFeedback(null);
  }, []);

  const handleMoveOrderToQueue = async (order: Order) => {
    setActionState({ isLoading: true, message: null, error: null });
    try {
      await enqueueOrder(order.id);
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
  };

  const handleReturnOrderToQueue = async (order: Order) => {
    setActionState({ isLoading: true, message: null, error: null });
    try {
      await enqueueOrder(order.id);
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
  };

  const handleMarkPrepCompleted = async (task: PrepTask) => {
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
    }
  };

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

  const normalizeCode = (value?: string | null) => value?.trim().toLowerCase() ?? '';

  const tryMatchOrder = (code: string) =>
    orders.find((order) =>
      [order.id, order.orderNumber, order.ticketCode, order.shortCode].some(
        (candidate) => normalizeCode(candidate) === code
      )
    );

  const tryMatchReservation = (code: string) =>
    reservations.find((reservation) =>
      [reservation.id, reservation.reservationCode].some(
        (candidate) => normalizeCode(candidate) === code
      )
    );

  const tryMatchCustomer = (code: string) =>
    loyaltyCustomers.find((customer) =>
      [customer.clientId, customer.userId, customer.email].some(
        (candidate) => normalizeCode(candidate) === code
      )
    );

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
              setDetail({ type: 'order', data: orderFromDetail });
              rememberClientId(
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
        rememberClientId(orderFromDetail.user?.clientId ?? detail.customer?.clientId ?? null);
        tryCloseScanner();
        return;
      } catch (error) {
        console.warn('Ticket lookup fallback:', error);
      }

      const orderMatch = tryMatchOrder(normalized);
      if (orderMatch) {
        setDetail({ type: 'order', data: orderMatch });
        setScannerFeedback(null);
        handleCloseScanner();
        rememberClientId(orderMatch.user?.clientId ?? null);
        return;
      }

      const reservationMatch = tryMatchReservation(normalized);
      if (reservationMatch) {
        setDetail({ type: 'reservation', data: reservationMatch });
        setScannerFeedback(null);
        handleCloseScanner();
        rememberClientId(reservationMatch.user?.clientId ?? null);
        return;
      }

      const customerMatch = tryMatchCustomer(normalized);
      if (customerMatch) {
        setDetail({ type: 'customer', data: customerMatch });
        setScannerFeedback(null);
        handleCloseScanner();
        rememberClientId(customerMatch.clientId ?? customerMatch.userId);
        return;
      }

      setSnackbar('No encontramos un registro con ese código.');
    },
    [loyaltyCustomers, orders, rememberClientId, reservations]
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

  return (
    <div className="min-h-screen bg-[var(--brand-bg)] text-[var(--brand-text)]">
      <header className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-primary-500 dark:text-primary-200">
              Xoco Café · POS
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-[var(--brand-text)] dark:text-primary-50">
              Panel de baristas
            </h1>
            <p className="text-sm text-[var(--brand-muted)]">
              Controla pedidos web, tickets del POS y reservas en tiempo real.
            </p>
          </div>
          <div className="flex items-center gap-3 self-end sm:self-auto">
            <button type="button" className="brand-button--ghost" onClick={() => setActiveSection('metrics')}>
              Panel de socios
            </button>
            <ThemeToggle />
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          {NAV_ITEMS.map((item) => {
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

            <OrdersPanel onSelect={(order) => setDetail({ type: 'order', data: order })} />

            <section className="card space-y-6 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="badge">Cola de producción</p>
                  <p className="text-sm text-[var(--brand-muted)]">Ordena y asigna preparaciones de bebidas y alimentos.</p>
                </div>
                <div className="flex items-center gap-4 text-sm text-[var(--brand-muted)]">
                  {prepLoading && <p>Actualizando...</p>}
                  <button
                    type="button"
                    onClick={() => void refreshPrep()}
                    className="text-xs font-semibold text-primary-500 underline-offset-4 hover:underline dark:text-primary-200"
                  >
                    Actualizar cola
                  </button>
                </div>
              </div>

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
                  <p className="text-sm text-[var(--brand-muted)]">Seguimos la lógica de corte 23:59 y limpiamos reservas pasadas después de 3 días.</p>
                </div>
                <ReservationsSearchBar
                  onSearch={(value) => setReservationFilter(value)}
                  isLoading={reservationsLoading}
                  onRefresh={refreshReservations}
                  onShowPast={() => setShowReservationHistory(true)}
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
                  reservations={pastReservations}
                  onClose={() => setShowReservationHistory(false)}
                  hasFilter={Boolean(reservationFilter.trim())}
                  onSelect={(reservation) => setDetail({ type: 'reservation', data: reservation })}
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
                <SummaryCard label="Pedidos totales" value={orders.length} subtitle="Últimos 100" />
                <SummaryCard label="Pasados" value={pastOrders.length} subtitle="Se limpian a 3 días" />
                <SummaryCard label="Completados" value={completed.length} subtitle="Histórico cercano" />
                <SummaryCard label="Reservas activas" value={reservationCounts.pending} subtitle="Próximas 24h" />
                <SummaryCard label="En barra" value={activePrep.length} subtitle="Cola de producción" />
                <SummaryCard label="Staff en turno" value={`${staffActive}/${staffTotal}`} subtitle="Activos / total" />
                <SummaryCard label="Cliente top" value={topCustomer?.totalInteractions ?? 0} subtitle={getCustomerDisplayName(topCustomer)} />
                <SummaryCard label="Propinas" value={formatCurrency(totalTips)} subtitle="Monto acumulado" isCurrency />
              </div>
            </section>
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
          </>
        )}

        {activeSection === 'payments' && (
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

        {activeSection === 'employees' && (
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
                      {(staffData?.sessions ?? []).slice(0, 6).map((session) => (
                        <div key={session.id} className="flex items-center justify-between rounded-xl border border-primary-50/80 px-3 py-2 text-sm dark:border-white/10">
                          <div>
                            <p className="font-semibold">{session.staff?.email ?? session.staffId ?? session.id.slice(0, 6)}</p>
                            <p className="text-xs text-[var(--brand-muted)]">Inicio: {session.sessionStart ? formatDate(session.sessionStart) : '—'}</p>
                          </div>
                          <span className="text-xs uppercase tracking-[0.3em] text-primary-500">
                            {session.isActive ? 'En turno' : 'Cerrada'}
                          </span>
                        </div>
                      ))}
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
        </div>
        <span className="text-xs font-semibold text-[var(--brand-muted)]">
          {task.createdAt ? formatDate(task.createdAt) : '—'}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-[var(--brand-muted)]">
        <p>
          {task.handler?.email
            ? `Asignado a ${task.handler.email}`
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
  'bebida',
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

const classifyOrderItem = (item: OrderItemEntry) => {
  const haystack = `${item.category ?? ''} ${item.subcategory ?? ''} ${item.name ?? ''}`
    .toLowerCase()
    .normalize('NFD');

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
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  actionState?: DetailActionState;
}) => (
  <div className="space-y-2">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-2xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-40"
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

const OrderDetailContent = ({
  order,
  onMoveToQueue,
  onReturnToQueue,
  actionState,
}: {
  order: Order;
  onMoveToQueue?: (order: Order) => void;
  onReturnToQueue?: (order: Order) => void;
  actionState?: DetailActionState;
}) => {
  const [items, setItems] = useState<OrderItemEntry[]>(
    Array.isArray(order.items) ? (order.items as OrderItemEntry[]) : []
  );
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  useEffect(() => {
    setItems(Array.isArray(order.items) ? (order.items as OrderItemEntry[]) : []);
    setItemsError(null);
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
          {order.orderNumber ?? order.id}
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
        <DetailActionFooter
          label="Mover a la cola"
          onClick={() => onMoveToQueue(order)}
          disabled={actionState?.isLoading}
          actionState={actionState}
        />
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
  actionState,
}: {
  reservation: Reservation;
  onConfirmReservation?: (reservation: Reservation) => void;
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
      {onConfirmReservation && (
        <DetailActionFooter
          label="Confirmar reservación"
          onClick={() => onConfirmReservation(reservation)}
          disabled={actionState?.isLoading}
          actionState={actionState}
        />
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
}) => (
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
        label="Producto"
        value={
          <span className="font-bold text-primary-900 dark:text-white">
            {task.product?.name ?? 'Sin producto'}
          </span>
        }
      />
      <DetailRow
        label="Cantidad"
        value={
          <span className="font-bold text-primary-900 dark:text-white">
            {String(task.orderItem?.quantity ?? 1)}
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
            {task.handler?.email ?? 'Sin asignar'}
          </span>
        }
      />
    </div>
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
}) => (
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
            {[7, 30, 90].map((daysOption) => (
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
  </div>
);

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
}: {
  onSearch: (value: string) => void;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onShowPast: () => void;
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
          <span className="font-semibold uppercase tracking-[0.25em]">Buscar ID</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="ID de la reserva"
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
      <button type="button" onClick={onShowPast} className="brand-button text-xs">
        Pasadas
      </button>
    </div>
  );
};

const ReservationHistoryContent = ({
  reservations,
  onClose,
  hasFilter,
  onSelect,
}: {
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
      [reservation.id, reservation.reservationCode].some(matches)
    );
  }, [query, reservations]);

  return (
    <div className="space-y-4 text-[var(--brand-text)] dark:text-white">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-semibold">Reservas pasadas</h3>
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
          <span className="font-semibold uppercase tracking-[0.25em]">Buscar ID</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ID de la reserva"
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
            ? 'No encontramos reservas pasadas con ese ID.'
            : hasFilter
              ? 'No encontramos reservas pasadas con ese filtro.'
              : 'No hay reservas pasadas disponibles.'}
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
