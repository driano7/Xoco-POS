'use client';

import { useMemo, useCallback } from 'react';
import { useCatalog } from '@/hooks/use-catalog';
import type { CatalogProduct } from '@/lib/api';

export interface MenuItem {
  id: string;
  label: string;
  category?: string | null;
  subcategory?: string | null;
  price?: number | null;
  calories?: number | null;
}

const BEVERAGE_KEYWORDS = [
  'bebida',
  'drink',
  'coffee',
  'cafe',
  'café',
  'latte',
  'tea',
  'matcha',
  'brew',
  'espresso',
  'frapp',
  'infusion',
  'americano',
];
const FOOD_KEYWORDS = [
  'food',
  'alimento',
  'sandwich',
  'panini',
  'toast',
  'bagel',
  'postre',
  'dessert',
  'snack',
  'cake',
  'cheesecake',
  'pastel',
  'pie',
  'tart',
  'tarta',
  'brownie',
  'galleta',
];
const PACKAGE_KEYWORDS = ['paquete', 'combo', 'kit', 'box', 'use'];

const normalize = (value?: string | null) => value?.trim().toLowerCase() ?? '';

const parsePrice = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const classifyProduct = (item: MenuItem) => {
  const haystack = `${normalize(item.category)} ${normalize(item.subcategory)} ${normalize(item.label)}`
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  if (
    haystack.includes('postre') ||
    haystack.includes('alimento') ||
    haystack.includes('food') ||
    FOOD_KEYWORDS.some((keyword) => haystack.includes(keyword))
  ) {
    return 'food';
  }
  if (BEVERAGE_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return 'beverage';
  }
  return 'other';
};

const dedupeMenuItems = (items: MenuItem[]): MenuItem[] => {
  const map = new Map<string, MenuItem>();
  items.forEach((item) => {
    const key = `${normalize(item.label)}|${normalize(item.category)}|${normalize(item.subcategory)}`;
    const existing = map.get(key);
    const currentPrice = existing?.price ?? 0;
    const candidatePrice = item.price ?? 0;
    if (!existing || currentPrice === 0 || candidatePrice > currentPrice) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
};

const mapProductToMenuItem = (product: CatalogProduct): MenuItem => {
  const id = product.productId?.trim() || product.id;
  const label = product.name?.trim() || id;
  const price =
    parsePrice(product.price) ??
    parsePrice(product.cost) ??
    (product.totalRevenue && product.totalSales
      ? Number(product.totalRevenue) / Number(product.totalSales || 1)
      : null);

  return {
    id,
    label,
    category: product.category ?? null,
    subcategory: product.subcategory ?? null,
    price: price ?? 0,
    calories: null,
  };
};

export function useMenuOptions() {
  const { catalog, isLoading, error, refresh } = useCatalog();

  const menuItems = useMemo(() => {
    const products = catalog?.products ?? [];
    return dedupeMenuItems(products.map(mapProductToMenuItem));
  }, [catalog]);

  const menuMap = useMemo(() => {
    const map = new Map<string, MenuItem>();
    menuItems.forEach((item) => {
      if (item.id) {
        map.set(item.id, item);
      }
    });
    return map;
  }, [menuItems]);

  const beverageOptions = useMemo(
    () => menuItems.filter((item) => classifyProduct(item) === 'beverage'),
    [menuItems]
  );
  const foodOptions = useMemo(
    () => menuItems.filter((item) => classifyProduct(item) === 'food'),
    [menuItems]
  );
  const packageOptions = useMemo(() => {
    const matchesKeyword = (value?: string | null) => {
      const normalized = normalize(value);
      return PACKAGE_KEYWORDS.some((keyword) => normalized.includes(keyword));
    };
    return menuItems.filter(
      (item) =>
        matchesKeyword(item.label) ||
        matchesKeyword(item.category) ||
        matchesKeyword(item.subcategory)
    );
  }, [menuItems]);

  const getMenuItemById = useCallback(
    (id: string | null | undefined) => (id ? menuMap.get(id) ?? null : null),
    [menuMap]
  );

  return {
    beverageOptions,
    foodOptions,
    packageOptions,
    allMenuItems: menuItems,
    getMenuItemById,
    isLoading,
    error,
    refresh,
  };
}
