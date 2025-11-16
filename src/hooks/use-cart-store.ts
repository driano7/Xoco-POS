'use client';

import { useSyncExternalStore } from 'react';

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  category?: string | null;
  subcategory?: string | null;
};

type CartState = {
  items: CartItem[];
};

type CartSnapshot = CartState & {
  itemCount: number;
  subtotal: number;
  total: number;
  addItem: (item: CartItem) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
};

const subscribers = new Set<() => void>();
let state: CartState = { items: [] };

const clampQuantity = (value: number) => {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(99, Math.max(1, Math.round(value)));
};

const getTotals = (items: CartItem[]) =>
  items.reduce(
    (acc, item) => {
      acc.count += item.quantity;
      acc.subtotal += item.quantity * item.price;
      return acc;
    },
    { count: 0, subtotal: 0 }
  );

export const addItem = (item: CartItem) => {
  setState((prev) => {
    const existingIndex = prev.items.findIndex((entry) => entry.productId === item.productId);
    if (existingIndex >= 0) {
      const next = [...prev.items];
      const existing = next[existingIndex];
      next[existingIndex] = {
        ...existing,
        quantity: clampQuantity(existing.quantity + item.quantity),
      };
      return { items: next };
    }
    return { items: [...prev.items, { ...item, quantity: clampQuantity(item.quantity) }] };
  });
};

export const increment = (productId: string) => {
  setState((prev) => ({
    items: prev.items.map((item) =>
      item.productId === productId
        ? { ...item, quantity: clampQuantity(item.quantity + 1) }
        : item
    ),
  }));
};

export const decrement = (productId: string) => {
  setState((prev) => ({
    items: prev.items
      .map((item) =>
        item.productId === productId
          ? { ...item, quantity: clampQuantity(item.quantity - 1) }
          : item
      )
      .filter((item) => item.quantity > 0),
  }));
};

export const removeItem = (productId: string) => {
  setState((prev) => ({ items: prev.items.filter((item) => item.productId !== productId) }));
};

export const clearCart = () => {
  setState(() => ({ items: [] }));
};

const buildSnapshot = (): CartSnapshot => {
  const { count, subtotal } = getTotals(state.items);
  return {
    items: state.items,
    itemCount: count,
    subtotal,
    total: subtotal,
    addItem,
    increment,
    decrement,
    removeItem,
    clearCart,
  };
};

let snapshot: CartSnapshot = buildSnapshot();

const emit = () => {
  snapshot = buildSnapshot();
  subscribers.forEach((listener) => listener());
};

const setState = (updater: (prev: CartState) => CartState) => {
  state = updater(state);
  emit();
};

const subscribe = (listener: () => void) => {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
};

const getSnapshot = () => snapshot;

export const useCartStore = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
