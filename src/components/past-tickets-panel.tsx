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

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { TransactionHistoryEntry, TransactionsHistoryFilters } from '@/lib/api';
import { fetchTransactionsHistory } from '@/lib/api';

const formatCurrency = (value?: number | null) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value ?? 0);

const formatDateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const toIsoDate = (value: string, endOfDay = false) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  return date.toISOString();
};

type PastTicketsPanelProps = {
  onReplay: (entry: TransactionHistoryEntry) => Promise<void> | void;
  replayingId?: string | null;
  replayError?: string | null;
};

type FormState = {
  from: string;
  to: string;
  clientId: string;
  minTotal: string;
  maxTotal: string;
  rangeDays: string;
};

const defaultFormState: FormState = {
  from: '',
  to: '',
  clientId: '',
  minTotal: '',
  maxTotal: '',
  rangeDays: '30',
};

const getTicketIdentifier = (entry: TransactionHistoryEntry) =>
  entry.ticket?.ticketCode ??
  entry.order.ticketCode ??
  entry.order.orderNumber ??
  entry.order.id;

const getCustomerLabel = (entry: TransactionHistoryEntry) => {
  const first = entry.order.user?.firstName ?? entry.order.user?.firstNameEncrypted ?? '';
  const last = entry.order.user?.lastName ?? entry.order.user?.lastNameEncrypted ?? '';
  const name = `${first} ${last}`.trim();
  const clientId = entry.order.clientId ?? entry.order.user?.clientId ?? '';
  if (name && clientId) {
    return `${name} · ${clientId}`;
  }
  return name || clientId || 'Cliente';
};

const normalizeAmountInput = (value: string) => {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number.parseFloat(value.replace(/,/g, '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

export function PastTicketsPanel({ onReplay, replayingId, replayError }: PastTicketsPanelProps) {
  const [transactions, setTransactions] = useState<TransactionHistoryEntry[]>([]);
  const [formState, setFormState] = useState<FormState>(defaultFormState);
  const [appliedFilters, setAppliedFilters] = useState<FormState>(defaultFormState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const filtersForRequest = useMemo<TransactionsHistoryFilters>(() => {
    const payload: TransactionsHistoryFilters = {
      days: Number(appliedFilters.rangeDays) || 30,
    };
    if (appliedFilters.from) {
      const iso = toIsoDate(appliedFilters.from);
      if (iso) {
        payload.from = iso;
      }
    }
    if (appliedFilters.to) {
      const iso = toIsoDate(appliedFilters.to, true);
      if (iso) {
        payload.to = iso;
      }
    }
    if (appliedFilters.clientId.trim()) {
      payload.clientId = appliedFilters.clientId.trim();
    }
    const min = normalizeAmountInput(appliedFilters.minTotal);
    if (min !== null) {
      payload.minTotal = min;
    }
    const max = normalizeAmountInput(appliedFilters.maxTotal);
    if (max !== null) {
      payload.maxTotal = max;
    }
    return payload;
  }, [appliedFilters]);

  const loadTransactions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchTransactionsHistory(filtersForRequest);
      setTransactions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos recuperar transacciones.');
    } finally {
      setIsLoading(false);
    }
  }, [filtersForRequest]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (formState.from && formState.to) {
      const fromDate = new Date(formState.from);
      const toDate = new Date(formState.to);
      if (fromDate.getTime() > toDate.getTime()) {
        setFormError('El rango de fechas es inválido.');
        return;
      }
    }
    setAppliedFilters(formState);
  };

  const handleClear = () => {
    setFormState(defaultFormState);
    setAppliedFilters(defaultFormState);
  };

  return (
    <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-xs text-[var(--brand-muted)] dark:border-white/10 dark:bg-white/5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-primary-500">
        Tickets históricos
      </p>
      <p className="mt-1 text-[11px] text-[var(--brand-muted)]">
        Busca pedidos anteriores por fechas, cliente o total y recrea el ticket.
      </p>
      <form className="mt-3 space-y-2" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span>Desde</span>
            <input
              type="date"
              value={formState.from}
              onChange={(event) => setFormState((prev) => ({ ...prev, from: event.target.value }))}
              className="rounded-xl border border-primary-100/70 bg-white px-2 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Hasta</span>
            <input
              type="date"
              value={formState.to}
              onChange={(event) => setFormState((prev) => ({ ...prev, to: event.target.value }))}
              className="rounded-xl border border-primary-100/70 bg-white px-2 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span>ID de cliente</span>
          <input
            value={formState.clientId}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, clientId: event.target.value }))
            }
            placeholder="Ej. AAA-1111"
            className="rounded-xl border border-primary-100/70 bg-white px-2 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span>Mínimo</span>
            <input
              value={formState.minTotal}
              inputMode="decimal"
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, minTotal: event.target.value }))
              }
              placeholder="Ej. 150"
              className="rounded-xl border border-primary-100/70 bg-white px-2 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Máximo</span>
            <input
              value={formState.maxTotal}
              inputMode="decimal"
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, maxTotal: event.target.value }))
              }
              placeholder="Ej. 450"
              className="rounded-xl border border-primary-100/70 bg-white px-2 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span>Rango rápido</span>
          <select
            value={formState.rangeDays}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, rangeDays: event.target.value }))
            }
            className="rounded-xl border border-primary-100/70 bg-white px-2 py-1 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white"
          >
            <option value="7">Últimos 7 días</option>
            <option value="14">Últimos 14 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="60">Últimos 60 días</option>
          </select>
        </label>
        {formError && (
          <p className="rounded-xl border border-danger-300/60 bg-danger-50/60 px-3 py-2 text-[11px] text-danger-700 dark:border-danger-500/40 dark:bg-danger-900/30 dark:text-danger-100">
            {formError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="brand-button text-xs">
            Aplicar
          </button>
          <button type="button" onClick={handleClear} className="brand-button--ghost text-xs">
            Limpiar
          </button>
          <span className="text-[11px]">
            Resultados: <strong>{transactions.length}</strong>
          </span>
        </div>
      </form>
      {error && (
        <p className="mt-3 rounded-xl border border-danger-300/60 bg-danger-50/60 px-3 py-2 text-[11px] text-danger-700 dark:border-danger-500/40 dark:bg-danger-900/30 dark:text-danger-100">
          {error}
        </p>
      )}
      {replayError && !error && (
        <p className="mt-3 rounded-xl border border-danger-200/60 bg-danger-50/40 px-3 py-2 text-[11px] text-danger-600 dark:border-danger-500/40 dark:bg-danger-900/20 dark:text-danger-100">
          {replayError}
        </p>
      )}
      <div className="mt-4 space-y-2">
        {isLoading && (
          <p className="text-[11px] text-[var(--brand-muted)]">Buscando tickets…</p>
        )}
        {!isLoading && transactions.length === 0 && !error && (
          <p className="text-[11px] text-[var(--brand-muted)]">
            Sin coincidencias para los filtros seleccionados.
          </p>
        )}
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {transactions.map((entry) => {
            const ticketId = getTicketIdentifier(entry);
            const isReplaying = replayingId === ticketId;
            return (
              <div
                key={`${entry.order.id}-${ticketId}`}
                className="rounded-2xl border border-primary-100/60 bg-white/80 p-3 text-xs dark:border-white/10 dark:bg-white/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-primary-500">
                    {ticketId}
                  </p>
                  <button
                    type="button"
                    onClick={() => void onReplay(entry)}
                    disabled={!ticketId || isReplaying}
                    className="rounded-full border border-primary-200 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-primary-700 transition hover:bg-primary-50 disabled:opacity-40 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                  >
                    {isReplaying ? 'Recreando…' : 'Recrear'}
                  </button>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-primary-800 dark:text-primary-100">
                  {formatCurrency(entry.total)} · {formatDateTime(entry.createdAt)}
                </p>
                <p className="text-[11px] text-[var(--brand-muted)]">
                  {entry.order.status ?? '—'} · {entry.payment?.method ?? entry.ticket?.paymentMethod ?? 'Sin método'}
                </p>
                <p className="text-[11px] text-[var(--brand-muted)]">Cliente: {getCustomerLabel(entry)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
