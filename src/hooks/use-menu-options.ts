'use client';

import { useMemo, useCallback } from 'react';
import { useCatalog } from '@/hooks/use-catalog';
import type { CatalogProduct } from '@/lib/api';

export interface MenuItem {
  id: string;
  productId: string;
  label: string;
  category?: string | null;
  subcategory?: string | null;
  price?: number | null;
  calories?: number | null;
  sizeId?: string | null;
  sizeLabel?: string | null;
}

const randomPackagePrice = () => {
  const min = 90;
  const max = 180;
  const raw = Math.random() * (max - min) + min;
  const rounded = Math.round(raw / 5) * 5;
  return rounded;
};

const FALLBACK_PACKAGES: MenuItem[] = [
  {
    id: 'pkg-1-cafe-mexicano-panqué',
    productId: 'pkg-1',
    label: 'Paquete 1 - Café mexicano + panqué',
    category: 'Paquetes',
    subcategory: 'Editorial',
    price: randomPackagePrice(),
    calories: 405,
    sizeId: null,
    sizeLabel: null,
  },
  {
    id: 'pkg-2-cafe-mexicano-sandwich',
    productId: 'pkg-2',
    label: 'Paquete 2 - Café mexicano + sándwich',
    category: 'Paquetes',
    subcategory: 'Editorial',
    price: randomPackagePrice(),
    calories: 355,
    sizeId: null,
    sizeLabel: null,
  },
  {
    id: 'pkg-3-cafe-mexicano-cheesecake',
    productId: 'pkg-3',
    label: 'Paquete 3 - Café mexicano + cheesecake o pastel',
    category: 'Paquetes',
    subcategory: 'Editorial',
    price: randomPackagePrice(),
    calories: 480,
    sizeId: null,
    sizeLabel: null,
  },
  {
    id: 'pkg-4-chocolate-agua-pan-de-yema',
    productId: 'pkg-4',
    label: 'Paquete 4 - Chocolate de agua + pan de yema',
    category: 'Paquetes',
    subcategory: 'Editorial',
    price: randomPackagePrice(),
    calories: 520,
    sizeId: null,
    sizeLabel: null,
  },
];

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
const PACKAGE_KEYWORDS = ['paquete', 'paquetes', 'combo', 'kit', 'box', 'use', 'bundle', 'pack'];

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

const buildDedupKey = (item: MenuItem) =>
  [normalize(item.label), normalize(item.sizeLabel), normalize(item.category), normalize(item.subcategory)]
    .filter(Boolean)
    .join('|') || item.id;

const dedupeMenuItems = (items: MenuItem[]): MenuItem[] => {
  const map = new Map<string, MenuItem>();
  items.forEach((item) => {
    const key = buildDedupKey(item);
    const existing = map.get(key);
    const candidatePrice = item.price ?? 0;
    const existingPrice = existing?.price ?? 0;
    const shouldReplace =
      !existing ||
      (candidatePrice > 0 && existingPrice <= 0) ||
      (candidatePrice > existingPrice);
    if (shouldReplace) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
};

type SizeOption = {
  id: string;
  label: string;
  price: number | null;
};

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

const coerceSizeOptions = (value: unknown): SizeOption[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (typeof entry === 'string') {
          const sanitized = slugify(entry) || `size-${index}`;
          return { id: sanitized, label: entry, price: null };
        }
        if (typeof entry === 'number') {
          return { id: `size-${index}`, label: `Opción ${index + 1}`, price: entry };
        }
        if (entry && typeof entry === 'object') {
          const raw = entry as Record<string, unknown>;
          const sourceId =
            (typeof raw.id === 'string' && raw.id) ||
            (typeof raw.value === 'string' && raw.value) ||
            (typeof raw.sizeId === 'string' && raw.sizeId) ||
            (typeof raw.size === 'string' && raw.size) ||
            null;
          const rawLabel =
            (typeof raw.label === 'string' && raw.label) ||
            (typeof raw.name === 'string' && raw.name) ||
            (typeof raw.size === 'string' && raw.size) ||
            sourceId;
          const price = parsePrice(raw.price ?? raw.amount ?? raw.value ?? raw.cost ?? null);
          return {
            id: (sourceId && slugify(sourceId)) || `size-${index}`,
            label: rawLabel ?? `Opción ${index + 1}`,
            price: price ?? null,
          };
        }
        return null;
      })
      .filter((option): option is SizeOption => Boolean(option && option.id && option.label));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, raw], index) => {
        if (typeof raw === 'number' || typeof raw === 'string') {
          const price = parsePrice(raw);
          return {
            id: slugify(key) || `size-${index}`,
            label: key,
            price: price ?? null,
          };
        }
        if (raw && typeof raw === 'object') {
          const nested = raw as Record<string, unknown>;
          const label =
            (typeof nested.label === 'string' && nested.label) ||
            (typeof nested.name === 'string' && nested.name) ||
            key;
          const id =
            (typeof nested.id === 'string' && nested.id) ||
            (typeof nested.sizeId === 'string' && nested.sizeId) ||
            (typeof nested.value === 'string' && nested.value) ||
            key;
          const price = parsePrice(nested.price ?? nested.amount ?? nested.value ?? nested.cost ?? null);
          return {
            id: slugify(id) || `size-${index}`,
            label,
            price: price ?? null,
          };
        }
        return null;
      })
      .filter((option): option is SizeOption => Boolean(option && option.id && option.label));
  }

  return [];
};

const extractSizeOptions = (product: CatalogProduct): SizeOption[] => {
  const metadata =
    product.metadata && typeof product.metadata === 'object'
      ? (product.metadata as Record<string, unknown>)
      : null;
  const productRecord = product as unknown as Record<string, unknown>;
  const sources: unknown[] = [product.availableSizes, productRecord['available_sizes']];
  if (metadata) {
    sources.push(
      metadata['availableSizes'],
      metadata['available_sizes'],
      metadata['sizes'],
      metadata['sizeOptions'],
      metadata['variants']
    );
  }

  const all = sources
    .filter((source) => source !== undefined && source !== null)
    .flatMap((source) => coerceSizeOptions(source));

  const unique = new Map<string, SizeOption>();
  all.forEach((option, index) => {
    const key = option.id || `size-${index}`;
    if (!unique.has(key)) {
      unique.set(key, option);
    }
  });
  return Array.from(unique.values());
};

const buildVariantLabel = (baseLabel: string, sizeLabel?: string | null) =>
  sizeLabel ? `${baseLabel} · ${sizeLabel}` : baseLabel;

const mapProductToMenuItems = (product: CatalogProduct): MenuItem[] => {
  const baseId = product.productId?.trim() || product.id;
  const label = product.name?.trim() || baseId;
  const price =
    parsePrice(product.price) ??
    parsePrice(product.cost) ??
    (product.totalRevenue && product.totalSales
      ? Number(product.totalRevenue) / Number(product.totalSales || 1)
      : null);

  const baseItem = {
    productId: baseId,
    label,
    category: product.category ?? null,
    subcategory: product.subcategory ?? null,
    calories: null,
  };

  const sizeOptions = extractSizeOptions(product);

  if (sizeOptions.length) {
    return sizeOptions.map((size, index) => {
      const variantSuffix = size.id || `size-${index}`;
      const variantId = `${baseId}::${variantSuffix}`;
      const resolvedPrice =
        typeof size.price === 'number' && size.price > 0 ? size.price : price ?? 0;
      return {
        ...baseItem,
        id: variantId,
        label: buildVariantLabel(label, size.label),
        price: resolvedPrice,
        sizeId: size.id,
        sizeLabel: size.label,
      };
    });
  }

  return [
    {
      ...baseItem,
      id: baseId,
      label,
      price: price ?? 0,
      sizeId: null,
      sizeLabel: null,
    },
  ];
};

export function useMenuOptions() {
  const { catalog, isLoading, error, refresh } = useCatalog();

  const menuItems = useMemo(() => {
    const products = catalog?.products ?? [];
    const entries = products.flatMap(mapProductToMenuItems);
    const deduped = dedupeMenuItems(entries);
    const seenLabels = new Set(deduped.map((item) => normalize(item.label)));
    const fallbackPackages = FALLBACK_PACKAGES.filter(
      (pkg) => !seenLabels.has(normalize(pkg.label))
    );
    return [...deduped, ...fallbackPackages];
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
    const matchesById = (item: MenuItem) => {
      const normalizedId = normalize(item.productId);
      return (
        normalizedId.startsWith('pkg') ||
        normalizedId.includes('paquete') ||
        normalizedId.includes('bundle') ||
        normalizedId.includes('combo')
      );
    };
    return menuItems.filter(
      (item) =>
        matchesKeyword(item.label) ||
        matchesKeyword(item.category) ||
        matchesKeyword(item.subcategory) ||
        matchesById(item)
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
