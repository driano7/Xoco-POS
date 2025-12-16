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

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Order } from '@/lib/api';
import { fetchOrders } from '@/lib/api';
import { applyOrderStatusRules, purgeExpiredPastOrders } from '@/lib/status-rules';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

interface UseOrdersResult {
  orders: Order[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

type OrdersState = {
  orders: Order[];
  isLoading: boolean;
  error: string | null;
  hasLoaded: boolean;
};

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

let state: OrdersState = {
  orders: [],
  isLoading: false,
  error: null,
  hasLoaded: false,
};

const emit = () => {
  listeners.forEach((listener) => listener());
};

const updateState = (partial: Partial<OrdersState>) => {
  state = { ...state, ...partial };
  emit();
};

let pendingLoad: Promise<void> | null = null;
let unsubscribeRealtime: (() => void) | null = null;

const loadOrders = async () => {
  if (pendingLoad) {
    return pendingLoad;
  }
  pendingLoad = (async () => {
    updateState({ isLoading: true, error: null });
    try {
      const data = await fetchOrders();
      const normalizedOrders = purgeExpiredPastOrders(applyOrderStatusRules(data)) as Order[];
      updateState({
        orders: normalizedOrders,
        isLoading: false,
        hasLoaded: true,
      });
    } catch (err) {
      updateState({
        error: err instanceof Error ? err.message : 'Error desconocido al cargar tickets',
        isLoading: false,
        hasLoaded: true,
      });
    } finally {
      pendingLoad = null;
    }
  })();
  return pendingLoad;
};

const ensureRealtimeSubscription = () => {
  if (unsubscribeRealtime || typeof window === 'undefined') {
    return;
  }
  const client = getSupabaseBrowserClient();
  if (!client) {
    return;
  }
  const triggerRefresh = () => {
    void loadOrders();
  };
  const channel = client
    .channel('pos-orders-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, triggerRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prep_queue' }, triggerRefresh);

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      unsubscribeRealtime = () => {
        client.removeChannel(channel);
        unsubscribeRealtime = null;
      };
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      client.removeChannel(channel);
      unsubscribeRealtime = null;
    }
  });
};

const getSnapshot = () => state;

export function useOrders(): UseOrdersResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!snapshot.hasLoaded && !snapshot.isLoading) {
      void loadOrders();
    }
    ensureRealtimeSubscription();
  }, [snapshot.hasLoaded, snapshot.isLoading]);

  const refresh = useCallback(() => loadOrders(), []);

  return {
    orders: snapshot.orders,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refresh,
  };
}
