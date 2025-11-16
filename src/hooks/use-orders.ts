'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Order } from '@/lib/api';
import { fetchOrders } from '@/lib/api';
import { applyOrderStatusRules, purgeExpiredPastOrders } from '@/lib/status-rules';

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

const getSnapshot = () => state;

export function useOrders(): UseOrdersResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!snapshot.hasLoaded && !snapshot.isLoading) {
      void loadOrders();
    }
  }, [snapshot.hasLoaded, snapshot.isLoading]);

  const refresh = useCallback(() => loadOrders(), []);

  return {
    orders: snapshot.orders,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refresh,
  };
}
