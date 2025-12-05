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

import { useSyncExternalStore } from 'react';

export type CartItem = {
  productId: string;
  variantId: string;
  name: string;
  price: number;
  quantity: number;
  category?: string | null;
  subcategory?: string | null;
  sizeId?: string | null;
  sizeLabel?: string | null;
  kind?: 'beverage' | 'food' | 'package' | 'other';
  originalPrice?: number | null;
  loyaltyReward?: boolean;
};

type CartState = {
  items: CartItem[];
};

type CartSnapshot = CartState & {
  itemCount: number;
  subtotal: number;
  total: number;
  addItem: (item: CartItem) => void;
  increment: (variantId: string) => void;
  decrement: (variantId: string) => void;
  removeItem: (variantId: string) => void;
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

const getItemKey = (variantId?: string | null, fallback?: string) =>
  (variantId && variantId.trim()) || fallback || '';

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
    const key = getItemKey(item.variantId, item.productId);
    const existingIndex = prev.items.findIndex(
      (entry) => getItemKey(entry.variantId, entry.productId) === key
    );
    if (existingIndex >= 0) {
      const next = [...prev.items];
      const existing = next[existingIndex];
      next[existingIndex] = {
        ...existing,
        quantity: clampQuantity(existing.quantity + item.quantity),
      };
      return { items: next };
    }
    return {
      items: [
        ...prev.items,
        { ...item, variantId: key, quantity: clampQuantity(item.quantity) },
      ],
    };
  });
};

export const increment = (variantId: string) => {
  setState((prev) => ({
    items: prev.items.map((item) =>
      getItemKey(item.variantId, item.productId) === variantId
        ? { ...item, quantity: clampQuantity(item.quantity + 1) }
        : item
    ),
  }));
};

export const decrement = (variantId: string) => {
  setState((prev) => ({
    items: prev.items
      .map((item) =>
        getItemKey(item.variantId, item.productId) === variantId
          ? { ...item, quantity: clampQuantity(item.quantity - 1) }
          : item
      )
      .filter((item) => item.quantity > 0),
  }));
};

export const removeItem = (variantId: string) => {
  setState((prev) => ({
    items: prev.items.filter((item) => getItemKey(item.variantId, item.productId) !== variantId),
  }));
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
