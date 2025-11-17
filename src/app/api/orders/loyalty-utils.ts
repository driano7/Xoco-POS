import { supabaseAdmin } from '@/lib/supabase-server';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const ORDER_ITEMS_TABLE = process.env.SUPABASE_ORDER_ITEMS_TABLE ?? 'order_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const LOYALTY_PUNCHES_TABLE = process.env.SUPABASE_LOYALTY_PUNCHES_TABLE ?? 'loyalty_points';
const LOYALTY_TIMEZONE = process.env.LOYALTY_TIMEZONE ?? 'America/Mexico_City';
const AMERICANO_KEYWORDS = ['americano'];
const PUBLIC_SALE_IDENTIFIERS = [
  process.env.SUPABASE_PUBLIC_SALE_USER_ID,
  process.env.NEXT_PUBLIC_PUBLIC_SALE_USER_ID,
  process.env.SUPABASE_PUBLIC_SALE_CLIENT_ID,
  process.env.NEXT_PUBLIC_PUBLIC_SALE_CLIENT_ID,
]
  .map((value) => value?.trim().toLowerCase())
  .filter(Boolean);

const normalizeText = (value?: string | null) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

type ItemSnapshot = {
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  product?: { name?: string | null; category?: string | null; subcategory?: string | null } | null;
};

const itemContainsAmericano = (item: ItemSnapshot) => {
  const haystack = [
    normalizeText(item.name),
    normalizeText(item.category),
    normalizeText(item.subcategory),
    normalizeText(item.product?.name),
    normalizeText(item.product?.category),
    normalizeText(item.product?.subcategory),
  ].join(' ');
  return AMERICANO_KEYWORDS.some((keyword) => haystack.includes(keyword));
};

const formatMexicoDate = (reference = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: LOYALTY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference);

const mapSnapshotItems = (items: unknown): ItemSnapshot[] =>
  Array.isArray(items)
    ? (items as ItemSnapshot[]).map((raw) => ({
        name: typeof raw?.name === 'string' ? raw.name : null,
        category: typeof raw?.category === 'string' ? raw.category : null,
        subcategory: typeof raw?.subcategory === 'string' ? raw.subcategory : null,
        product: raw?.product ?? null,
      }))
    : [];

const fetchItemsFromDatabase = async (orderId: string): Promise<ItemSnapshot[]> => {
  const { data: orderItems, error: orderItemsError } = await supabaseAdmin
    .from(ORDER_ITEMS_TABLE)
    .select('productId')
    .eq('orderId', orderId);

  if (orderItemsError) {
    console.warn('No se pudieron obtener los artículos del pedido para lealtad:', orderItemsError);
    return [];
  }

  const productIds = (orderItems ?? [])
    .map((item) => item.productId)
    .filter((value): value is string => typeof value === 'string' && Boolean(value));

  if (!productIds.length) {
    return [];
  }

  const { data: products, error: productsError } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('id,name,category,subcategory')
    .in('id', productIds);

  if (productsError) {
    console.warn('No se pudieron obtener los productos para lealtad:', productsError);
    return [];
  }

  const productMap = new Map((products ?? []).map((product) => [product.id, product]));

  return productIds.map((productId) => {
    const product = productMap.get(productId) ?? null;
    return {
      name: product?.name ?? null,
      category: product?.category ?? null,
      subcategory: product?.subcategory ?? null,
      product,
    };
  });
};

const loadOrderItems = async (orderId: string, snapshot: unknown): Promise<ItemSnapshot[]> => {
  const inline = mapSnapshotItems(snapshot);
  if (inline.length) {
    return inline;
  }
  return fetchItemsFromDatabase(orderId);
};

const isPublicSaleUser = (userId?: string | null) => {
  if (!userId) {
    return false;
  }
  const normalized = userId.trim().toLowerCase();
  return PUBLIC_SALE_IDENTIFIERS.includes(normalized);
};

export const maybeAwardDailyCoffee = async (
  orderId: string,
  userId?: string | null,
  snapshotItems?: unknown
) => {
  if (!userId) {
    return;
  }

  try {
    const items = await loadOrderItems(orderId, snapshotItems);
    if (!items.length || !items.some(itemContainsAmericano)) {
      return;
    }

    const punchDate = formatMexicoDate();

    let query = supabaseAdmin.from(LOYALTY_PUNCHES_TABLE).select('id').limit(1);
    if (isPublicSaleUser(userId)) {
      query = query.eq('orderId', orderId);
    } else {
      query = query.eq('userId', userId).eq('punchDate', punchDate);
    }

    const { data: existing, error: existingError } = await query.maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      console.warn('No se pudo verificar sellos previos de lealtad:', existingError);
      return;
    }

    if (existing) {
      return;
    }

    const { error: insertError } = await supabaseAdmin.from(LOYALTY_PUNCHES_TABLE).insert({
      orderId,
      userId,
      punchDate,
    });

    if (insertError) {
      console.warn('No se pudo registrar el sello de lealtad:', insertError);
    }
  } catch (error) {
    console.warn('Error inesperado al otorgar sello de lealtad:', error);
  }
};

export const revertLoyaltyCoffee = async (orderId: string) => {
  try {
    const { error } = await supabaseAdmin
      .from(LOYALTY_PUNCHES_TABLE)
      .delete()
      .eq('orderId', orderId);
    if (error) {
      console.warn('No se pudo revertir el sello de lealtad:', error);
    }
  } catch (error) {
    console.warn('Error inesperado al revertir sello de lealtad:', error);
  }
};
