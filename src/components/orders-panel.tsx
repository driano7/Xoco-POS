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

'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useOrders } from '@/hooks/use-orders';
import { usePagination } from '@/hooks/use-pagination';
import type { Order, PrepTask } from '@/lib/api';

const ITEMS_PER_PAGE = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const formatCurrency = (value?: number | null) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value ?? 0);

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const statusLabel: Record<Order['status'], string> = {
  pending: 'Pendiente',
  completed: 'Completado',
  past: 'Pasado',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  cripto: 'Cripto',
};

const getPaymentMethodDisplay = (method?: string | null) => {
  if (!method) {
    return 'Pendiente';
  }
  const normalized = method.toLowerCase();
  return PAYMENT_METHOD_LABELS[normalized] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const getOrderDisplayCode = (order: Order) =>
  order.ticketCode ?? order.orderNumber ?? order.id;

const formatOrderCustomer = (order: Order) => {
  const first = (order.user?.firstName ?? order.user?.firstNameEncrypted ?? '').trim();
  const last = (order.user?.lastName ?? order.user?.lastNameEncrypted ?? '').trim();
  const name = `${first} ${last}`.trim() || order.user?.email?.trim() || '';
  const identifier = order.clientId ?? order.user?.clientId ?? order.userId ?? '';

  if (name && identifier) {
    return `${name} · ${identifier}`;
  }

  return name || identifier || 'Cliente';
};

const buildOrderSearchTerms = (order: Order) => {
  const names = [
    order.user?.firstName,
    order.user?.lastName,
    order.user?.firstNameEncrypted,
    order.user?.lastNameEncrypted,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim());
  const fullName = names.length ? names.join(' ') : null;
  return [
    order.id,
    order.orderNumber,
    order.ticketCode,
    order.shortCode,
    order.clientId,
    order.user?.clientId,
    order.user?.email,
    order.userId,
    ...names,
    fullName,
  ].filter((value): value is string => Boolean(value && value.trim()));
};

interface OrdersPanelProps {
  onSelect?: (order: Order) => void;
  onSelectPrepTask?: (task: PrepTask) => void;
  hiddenOrderIds?: ReadonlySet<string>;
  prepTasks?: PrepTask[];
}

export function OrdersPanel({
  onSelect,
  onSelectPrepTask,
  hiddenOrderIds,
  prepTasks,
}: OrdersPanelProps = {}) {
  const { orders, isLoading, error, refresh } = useOrders();
  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          !order.isHidden &&
          !(order.status !== 'completed' && hiddenOrderIds?.has(order.id ?? ''))
      ),
    [orders, hiddenOrderIds]
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [showPastModal, setShowPastModal] = useState(false);
  const [showCompletedModal, setShowCompletedModal] = useState(false);
  const completedAll = useMemo(
    () => visibleOrders.filter((order) => order.status === 'completed'),
    [visibleOrders]
  );

  const filtered = useMemo(() => {
    if (!filter.trim()) {
      return visibleOrders;
    }
    const term = filter.trim().toLowerCase();
    const matches = (value?: string | null) => value?.toLowerCase().includes(term) ?? false;
    return visibleOrders.filter((order) => buildOrderSearchTerms(order).some(matches));
  }, [filter, visibleOrders]);

  const pending = filtered.filter((order) => order.status === 'pending');
  const past = filtered.filter((order) => order.status === 'past');
  const completed = filtered.filter((order) => order.status === 'completed');
  const completedLastWeek = useMemo(() => {
    const threshold = Date.now() - WEEK_MS;
    return completedAll.filter((order) => {
      const dateStr = order.updatedAt ?? order.createdAt ?? null;
      if (!dateStr) {
        return false;
      }
      const timestamp = Date.parse(dateStr);
      return Number.isFinite(timestamp) && timestamp >= threshold;
    });
  }, [completedAll]);

  return (
    <section className="card space-y-6 p-6 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="badge">Pedidos</p>
          <h3 className="mt-2 text-2xl font-bold text-primary-700 dark:text-primary-50">
            Estado de órdenes ({visibleOrders.length})
          </h3>
          <p className="text-sm text-[var(--brand-muted)]">
            Cada pedido incluye su ticket POS. Seguimos la regla de corte 23:59, ocultamos los
            pendientes al tercer día y los depuramos pasado un año.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--brand-muted)]">
          <div className="flex flex-col gap-2 text-[var(--brand-muted)]">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setFilter(query);
              }}
              className="flex flex-col gap-1"
            >
              <label className="font-semibold uppercase tracking-[0.25em]">
                Buscar ID o nombre
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ID, nombre o email del cliente"
                  className="rounded-xl border border-primary-100/70 px-3 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-white"
                />
                <button type="submit" className="brand-button text-xs">
                  Buscar
                </button>
                {filter && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setFilter('');
                    }}
                    className="brand-button--ghost text-xs"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPastModal(true)}
                className="brand-button text-xs"
              >
                Pasados
              </button>
              {completedAll.length > ITEMS_PER_PAGE && (
                <button
                  type="button"
                  onClick={() => setShowCompletedModal(true)}
                  className="brand-button text-xs"
                >
                  Completadas
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isLoading && <span>Actualizando…</span>}
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-full border border-primary-200 px-3 py-1 font-semibold text-primary-600 transition hover:bg-primary-50 dark:border-white/20 dark:text-primary-200"
            >
              Refrescar
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <p className="rounded-2xl border border-dashed border-danger-300/70 bg-danger-50/60 px-4 py-3 text-danger-700 dark:border-danger-600/40 dark:bg-danger-900/30 dark:text-danger-100">
          {error}
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <OrdersColumn
            title="Pendientes"
            orders={pending}
            highlight="text-primary-400"
            onSelect={onSelect}
          />
          <PrepTasksColumn
            title="En preparación"
            tasks={prepTasks ?? []}
            highlight="text-amber-500"
            onSelect={onSelectPrepTask}
          />
          <OrdersColumn
            title="Completadas"
            orders={completed}
            highlight="text-emerald-600"
            onSelect={onSelect}
          />
        </div>
      )}
      {showPastModal && (
        <OrdersHistoryModal
          title="Pedidos pasados"
          orders={past}
          onClose={() => setShowPastModal(false)}
          onSelect={(order) => {
            onSelect?.(order);
            setShowPastModal(false);
          }}
          isFiltered={Boolean(filter.trim())}
        />
      )}
      {showCompletedModal && (
        <OrdersHistoryModal
          title="Pedidos completados"
          orders={completedLastWeek}
          onClose={() => setShowCompletedModal(false)}
          onSelect={(order) => {
            onSelect?.(order);
            setShowCompletedModal(false);
          }}
          isFiltered={Boolean(filter.trim())}
        />
      )}
    </section>
  );
}

function OrdersColumn({
  title,
  orders,
  highlight,
  onSelect,
}: {
  title: string;
  orders: Order[];
  highlight: string;
  onSelect?: (order: Order) => void;
}) {
  const pagination = usePagination(orders, ITEMS_PER_PAGE);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className={`text-lg font-semibold ${highlight}`}>{title}</h4>
        <span className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">
          {orders.length}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {orders.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-primary-200/60 bg-white/70 px-4 py-3 text-sm text-[var(--brand-muted)] dark:border-white/10 dark:bg-white/5">
            Sin registros.
          </p>
        ) : (
          pagination.items.map((order) => {
            const totalItems =
              order.itemsCount ?? (Array.isArray(order.items) ? order.items.length : 0);
            return (
              <button
                type="button"
                key={order.id}
                onClick={() => onSelect?.(order)}
                className="w-full text-left rounded-2xl border border-primary-100/80 bg-white/80 px-4 py-3 text-sm shadow-sm transition hover:border-primary-300 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-white/10 dark:bg-white/10"
              >
                <header className="flex items-center justify-between">
                  <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-primary-400 font-bold underline">
                        {getOrderDisplayCode(order)}
                    </p>
                    <p className="text-base font-semibold">
                      {order.type ?? 'Pedido web'} · {statusLabel[order.status]}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-primary-600">
                    {formatCurrency(order.total)}
                  </p>
                </header>
                <p className="text-xs text-[var(--brand-muted)]">
                  Cliente: {formatOrderCustomer(order)}
                </p>
                <p className="text-xs text-[var(--brand-muted)]">
                  Ticket POS: {order.ticketCode ?? 'Sin ticket'}
                </p>
                <p className="text-xs text-[var(--brand-muted)]">
                  Método: {getPaymentMethodDisplay(order.queuedPaymentMethod)}
                </p>
                <p className="text-xs text-[var(--brand-muted)]">
                  Referencia: {order.queuedPaymentReference ?? 'Pendiente'}
                </p>
                <p className="text-xs text-[var(--brand-muted)]">
                  Atendió: {order.queuedByStaffName ?? order.queuedByStaffId ?? 'Sin asignar'}
                </p>
                <p className="text-xs text-[var(--brand-muted)]">
                  Pedido: {getOrderDisplayCode(order)}
                </p>
                <p className="mt-1 text-xs text-[var(--brand-muted)]">
                  Artículos: {totalItems}
                </p>
                <p className="text-xs text-[var(--brand-muted)]">{formatDate(order.createdAt)}</p>
              </button>
            );
          })
        )}
      </div>
      {pagination.hasPagination && (
        <PaginationControls
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

function PrepTasksColumn({
  title,
  tasks,
  highlight,
  onSelect,
}: {
  title: string;
  tasks: PrepTask[];
  highlight: string;
  onSelect?: (task: PrepTask) => void;
}) {
  const pagination = usePagination(tasks, ITEMS_PER_PAGE);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className={`text-lg font-semibold ${highlight}`}>{title}</h4>
        <span className="text-xs uppercase tracking-[0.35em] text-[var(--brand-muted)]">
          {tasks.length}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {tasks.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-primary-200/60 bg-white/70 px-4 py-3 text-sm text-[var(--brand-muted)] dark:border-white/10 dark:bg-white/5">
            Sin artículos en barra.
          </p>
        ) : (
          pagination.items.map((task) => {
            const productName =
              task.product?.name ??
              task.orderItem?.productId ??
              task.order?.items?.[0]?.name ??
              'Producto';
            const quantity = task.orderItem?.quantity ?? 1;
            const orderCode =
              task.order?.ticketCode ??
              task.order?.orderNumber ??
              task.order?.id ??
              task.id;
            const customerLabel = task.order
              ? formatOrderCustomer(task.order as Order)
              : task.customer?.name ??
                task.customer?.clientId ??
                task.customer?.email ??
                'Cliente';
            const totals = task.order?.totals;
            const totalAmount =
              typeof task.order?.total === 'number'
                ? task.order.total
                : typeof totals?.total === 'number'
                  ? totals.total
                  : typeof totals?.totalAmount === 'number'
                    ? totals.totalAmount
                    : task.amount ?? null;
            const taxAmount =
              typeof task.order?.vatAmount === 'number'
                ? task.order.vatAmount
                : typeof totals?.tax === 'number'
                  ? totals.tax
                  : null;
            const subtotalAmount =
              typeof task.order?.subtotal === 'number'
                ? task.order.subtotal
                : typeof totals?.subtotal === 'number'
                  ? totals.subtotal
                  : totalAmount !== null && taxAmount !== null
                    ? Math.max(totalAmount - taxAmount, 0)
                    : null;
            return (
              <button
                type="button"
                key={task.id}
                onClick={() => onSelect?.(task)}
                className="w-full text-left rounded-2xl border border-amber-200/70 bg-white/80 px-4 py-3 text-sm shadow-sm transition hover:border-amber-400 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-white/10 dark:bg-white/10"
              >
                <header className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-amber-500 font-bold underline">
                      {orderCode}
                    </p>
                    <p className="text-base font-semibold">
                      {quantity} × {productName}
                    </p>
                  </div>
                  <p className="text-xs font-semibold text-[var(--brand-muted)]">
                    {task.createdAt ? formatDate(task.createdAt) : '—'}
                  </p>
                </header>
                <p className="text-xs text-[var(--brand-muted)]">Cliente: {customerLabel}</p>
                <p className="text-xs text-[var(--brand-muted)]">
                  Barista: {task.handlerName ?? task.handler?.firstName ?? task.handledByStaffId ?? 'Sin asignar'}
                </p>
                <p className="text-xs text-[var(--brand-muted)]">
                  Total:{' '}
                  <span className="font-semibold text-primary-900 dark:text-white">
                    {formatCurrency(totalAmount ?? task.amount ?? 0)}
                  </span>
                  {taxAmount !== null && (
                    <span className="ml-2">
                      IVA <span className="font-semibold">{formatCurrency(taxAmount)}</span>
                    </span>
                  )}
                </p>
                {subtotalAmount !== null && (
                  <p className="text-xs text-[var(--brand-muted)]">
                    Subtotal:{' '}
                    <span className="font-semibold text-[var(--brand-text)] dark:text-white">
                      {formatCurrency(subtotalAmount)}
                    </span>
                  </p>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

const OrdersHistoryModal = ({
  title,
  orders,
  onClose,
  onSelect,
  isFiltered,
}: {
  title: string;
  orders: Order[];
  onClose: () => void;
  onSelect?: (order: Order) => void;
  isFiltered: boolean;
}) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return orders;
    }
    const term = query.trim().toLowerCase();
    const matches = (value?: string | null) => value?.toLowerCase().includes(term) ?? false;
    return orders.filter((order) => buildOrderSearchTerms(order).some(matches));
  }, [orders, query]);

  const list = filtered;

  return (
    <HistoryModalShell onClose={onClose}>
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
          className="flex flex-wrap items-center gap-2 text-xs text-[var(--brand-muted)] dark:text-white/80"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label className="flex flex-col text-[var(--brand-muted)] dark:text-white/70">
            <span className="font-semibold uppercase tracking-[0.25em]">Buscar ID o nombre</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ID, nombre o email del cliente"
              className="mt-1 rounded-xl border border-primary-100/70 bg-transparent px-3 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:text-white"
            />
          </label>
          <button type="submit" className="brand-button text-xs">
            Buscar
          </button>
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="brand-button--ghost text-xs"
            >
              Limpiar
            </button>
          )}
        </form>
        {list.length === 0 ? (
          <p className="text-sm text-[var(--brand-muted)] dark:text-white/80">
            {query
              ? `No encontramos ${title.toLowerCase()} con ese ID o nombre.`
              : isFiltered
                ? `No encontramos ${title.toLowerCase()} con ese filtro.`
                : `No hay ${title.toLowerCase()} en este momento.`}
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-2 text-sm">
            {list.map((order) => {
              const totalItems =
                order.itemsCount ?? (Array.isArray(order.items) ? order.items.length : 0);
              return (
                <button
                  type="button"
                  key={order.id}
                  onClick={() => {
                    onSelect?.(order);
                    onClose();
                  }}
                  className="w-full text-left rounded-2xl border border-primary-100/70 bg-white/90 px-4 py-3 text-sm transition hover:border-primary-300 dark:border-white/10 dark:bg-white/5"
                >
                  <header className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-primary-400 font-bold underline">
                        {order.orderNumber ?? order.id.slice(0, 6)}
                      </p>
                      <p className="text-base font-semibold text-[var(--brand-text)] dark:text-white">
                        {order.type ?? 'Pedido web'} · {statusLabel[order.status]}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-primary-400 dark:text-white">
                      {formatCurrency(order.total)}
                    </p>
                  </header>
                  <p className="text-xs text-[var(--brand-muted)] dark:text-white/70">
                    Cliente: {formatOrderCustomer(order)}
                  </p>
                  <p className="text-xs text-[var(--brand-muted)] dark:text-white/70">
                    Ticket POS: {order.ticketCode ?? 'Sin ticket'}
                  </p>
                  <p className="text-xs text-[var(--brand-muted)] dark:text-white/70">
                    Método: {getPaymentMethodDisplay(order.queuedPaymentMethod)}
                  </p>
                  <p className="text-xs text-[var(--brand-muted)] dark:text-white/70">
                    Referencia: {order.queuedPaymentReference ?? 'Pendiente'}
                  </p>
                  <p className="text-xs text-[var(--brand-muted)] dark:text-white/70">
                    Atendió: {order.queuedByStaffName ?? order.queuedByStaffId ?? 'Sin asignar'}
                  </p>
                  <p className="text-xs text-[var(--brand-muted)] dark:text-white/70">
                    Artículos: {totalItems}
                  </p>
                  <p className="mt-1 text-xs text-[var(--brand-muted)] dark:text-white/70">
                    {formatDate(order.createdAt)}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </HistoryModalShell>
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

function PaginationControls({
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
}) {
  return (
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
}
