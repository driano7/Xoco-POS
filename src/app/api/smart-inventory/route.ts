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

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const ITEMS_TABLE = process.env.SUPABASE_INVENTORY_ITEMS ?? 'inventory_items';
const STOCK_TABLE = process.env.SUPABASE_INVENTORY_STOCK ?? 'inventory_stock';
const MOVEMENTS_TABLE = process.env.SUPABASE_INVENTORY_MOVEMENTS ?? 'inventory_movements';
const BATCHES_TABLE = process.env.SUPABASE_INVENTORY_BATCHES ?? 'inventory_batches';
const RECIPES_TABLE = process.env.SUPABASE_PRODUCT_RECIPES ?? 'product_recipes';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH_ID ?? 'matriz';

type SmartInventoryAction = 'ingress' | 'sale' | 'status';

type SmartInventoryRequest =
  | {
    action: 'ingress';
    itemId: string;
    quantity: number;
    unitSize: number;
    branchId?: string;
    expiresAt?: string;
    reference?: string;
    staffId?: string;
  }
  | {
    action: 'sale';
    branchId?: string;
    staffId?: string;
    saleItems: Array<{ productId: string; quantity: number }>;
  }
  | {
    action: 'status';
  };

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
};

const normalizeBranch = (branchId?: string | null) => branchId?.trim() || DEFAULT_BRANCH;

const fetchInventoryStatus = async () => {
  const [{ data: items, error: itemsError }, { data: stock, error: stockError }] = await Promise.all([
    supabaseAdmin
      .from(ITEMS_TABLE)
      .select('id,name,unit,"minStock"')
      .order('name', { ascending: true }),
    supabaseAdmin.from(STOCK_TABLE).select('id,itemId,branchId,quantity'),
  ]);
  if (itemsError || stockError) {
    const message = itemsError?.message || stockError?.message || 'No pudimos cargar inventario.';
    throw new Error(message);
  }
  const itemMap = new Map(
    (items ?? []).map((item) => [
      item.id,
      {
        id: item.id,
        name: item.name,
        minStock: toNumber(item.minStock ?? 0),
        unit: item.unit ?? 'unidad',
        isCritical: toNumber(item.minStock ?? 0) > 0,
      },
    ])
  );
  const entries = (stock ?? []).map((row) => {
    const item = itemMap.get(row.itemId) ?? {
      id: row.itemId,
      name: row.itemId,
      minStock: 0,
      unit: 'unidad',
      isCritical: false,
    };
    const quantity = toNumber(row.quantity ?? 0);
    const capacity = item.minStock > 0 ? quantity / item.minStock : 1;
    return {
      stockId: row.id,
      itemId: row.itemId,
      name: item.name,
      quantity,
      minStock: item.minStock,
      unit: item.unit,
      branchId: row.branchId,
      isCritical: item.isCritical,
      percentAvailable: Math.min(1, capacity),
    };
  });
  const lowStock = entries.filter((entry) => entry.isCritical && entry.percentAvailable <= 0.2);
  const zeroStock = entries.filter((entry) => entry.quantity <= 0);
  return { entries, lowStock, zeroStock };
};

const getItem = async (itemId: string) => {
  const { data, error } = await supabaseAdmin
    .from(ITEMS_TABLE)
    .select('id,name,unit,"minStock"')
    .eq('id', itemId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error('Insumo no encontrado.');
  }
  return {
    id: data.id,
    name: data.name,
    minStock: toNumber(data.minStock ?? 0),
    unit: data.unit ?? 'unidad',
    isCritical: toNumber(data.minStock ?? 0) > 0,
  };
};

const upsertStock = async (itemId: string, branchId: string, nextQuantity: number) => {
  const existing = await supabaseAdmin
    .from(STOCK_TABLE)
    .select('id,quantity')
    .eq('itemId', itemId)
    .eq('branchId', branchId)
    .maybeSingle();
  if (existing.error && existing.error.code !== 'PGRST116') {
    throw new Error(existing.error.message);
  }
  if (existing.data?.id) {
    await supabaseAdmin
      .from(STOCK_TABLE)
      .update({
        quantity: nextQuantity,
        lastUpdatedAt: new Date().toISOString(),
      })
      .eq('id', existing.data.id);
    return existing.data.id as string;
  }
  const { data, error } = await supabaseAdmin
    .from(STOCK_TABLE)
    .insert({
      itemId,
      branchId,
      quantity: nextQuantity,
      lastUpdatedAt: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return data.id as string;
};

const logMovement = async (
  itemId: string,
  branchId: string,
  quantity: number,
  type: 'in' | 'out' | 'adjustment',
  reason: string,
  staffId?: string | null
) => {
  await supabaseAdmin.from(MOVEMENTS_TABLE).insert({
    itemId,
    branchId,
    type,
    quantity,
    reason,
    createdByStaffId: staffId ?? null,
  });
};

const receiveBatches = async (itemId: string, branchId: string, quantity: number, expiresAt?: string, reference?: string) => {
  await supabaseAdmin.from(BATCHES_TABLE).insert({
    itemId,
    branchId,
    quantity,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    reference: reference?.trim() || null,
    receivedAt: new Date().toISOString(),
  });
};

const consumeBatches = async (
  itemId: string,
  branchId: string,
  amount: number,
  metadata?: { orderReference?: string; staffId?: string }
) => {
  const { data: batches, error } = await supabaseAdmin
    .from(BATCHES_TABLE)
    .select('id,quantity,"expiresAt","receivedAt"')
    .eq('itemId', itemId)
    .eq('branchId', branchId)
    .order('expiresAt', { ascending: true, nullsFirst: false })
    .order('receivedAt', { ascending: true })
    .order('createdAt', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  let remaining = amount;
  const updates: Array<{ id: string; quantity: number }> = [];
  (batches ?? []).forEach((batch) => {
    if (remaining <= 0) {
      return;
    }
    const available = toNumber(batch.quantity ?? 0);
    if (available <= 0) {
      return;
    }
    const deduction = Math.min(available, remaining);
    remaining -= deduction;
    updates.push({ id: String(batch.id), quantity: available - deduction });
  });
  if (remaining > 0) {
    throw new Error('Stock insuficiente para cubrir la receta.');
  }
  await Promise.all(
    updates.map((entry) =>
      supabaseAdmin
        .from(BATCHES_TABLE)
        .update({ quantity: entry.quantity, updatedAt: new Date().toISOString() })
        .eq('id', entry.id)
    )
  );
  await logMovement(itemId, branchId, amount * -1, 'out', metadata?.orderReference ?? 'Venta POS', metadata?.staffId);
};

type ProductRecipeRow = {
  productId: string;
  inventoryItemId: string;
  quantityUsed: number;
  isCritical?: boolean | null;
};

const fetchRecipes = async (productIds: string[]) => {
  if (!productIds.length) {
    return [];
  }
  const { data, error } = await supabaseAdmin
    .from(RECIPES_TABLE)
    .select('"productId","inventoryItemId","quantityUsed","isCritical"')
    .in('productId', productIds);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    productId: row.productId,
    inventoryItemId: row.inventoryItemId,
    quantityUsed: toNumber(
      (row.quantityUsed as number | string | null) ?? (row as { quantity?: number }).quantity ?? 0
    ),
    isCritical: (row as { isCritical?: boolean }).isCritical ?? true,
  })) as ProductRecipeRow[];
};

const updateProductFlags = async (
  productIds: string[],
  isLowStock: boolean,
  isActive: boolean
) => {
  if (!productIds.length) {
    return;
  }
  const { data: dbProducts, error } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('id,"productId"')
    .in('productId', productIds);
  if (error) {
    throw new Error(error.message);
  }
  const ids = (dbProducts ?? []).map((product) => product.id).filter(Boolean) as string[];
  if (!ids.length) {
    return;
  }
  await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .update({
      is_low_stock: isLowStock,
      isLowStock,
      isActive,
      updatedAt: new Date().toISOString(),
    })
    .in('id', ids);
};

const handleIngress = async (payload: Extract<SmartInventoryRequest, { action: 'ingress' }>) => {
  if (!payload.itemId || !Number.isFinite(payload.quantity) || !Number.isFinite(payload.unitSize)) {
    throw new Error('Necesitamos insumo, cantidad y unidad base.');
  }
  const branchId = normalizeBranch(payload.branchId);
  const baseQuantity = payload.quantity * payload.unitSize;
  if (baseQuantity <= 0) {
    throw new Error('La cantidad convertida debe ser mayor a 0.');
  }
  const item = await getItem(payload.itemId);
  const existingStock = await supabaseAdmin
    .from(STOCK_TABLE)
    .select('quantity')
    .eq('itemId', payload.itemId)
    .eq('branchId', branchId)
    .maybeSingle();
  if (existingStock.error && existingStock.error.code !== 'PGRST116') {
    throw new Error(existingStock.error.message);
  }
  const currentQuantity = toNumber(existingStock.data?.quantity ?? 0);
  const nextQuantity = currentQuantity + baseQuantity;
  await upsertStock(payload.itemId, branchId, nextQuantity);
  await logMovement(
    payload.itemId,
    branchId,
    baseQuantity,
    'in',
    payload.reference ? `Ingreso ${payload.reference}` : 'Ingreso manual',
    payload.staffId
  );
  await receiveBatches(payload.itemId, branchId, baseQuantity, payload.expiresAt, payload.reference);
  return {
    item,
    branchId,
    received: baseQuantity,
  };
};

const handleSale = async (payload: Extract<SmartInventoryRequest, { action: 'sale' }>) => {
  if (!payload.saleItems?.length) {
    throw new Error('Necesitamos al menos un producto vendido.');
  }
  const branchId = normalizeBranch(payload.branchId);
  const productIds = payload.saleItems.map((item) => item.productId);
  const recipes = await fetchRecipes(productIds);
  const recipesByProduct = new Map<string, ProductRecipeRow[]>();
  recipes.forEach((recipe) => {
    const list = recipesByProduct.get(recipe.productId) ?? [];
    list.push(recipe);
    recipesByProduct.set(recipe.productId, list);
  });
  const requiredByItem = new Map<
    string,
    { amount: number; products: Set<string>; isCritical: boolean }
  >();
  for (const saleItem of payload.saleItems) {
    const recipe = recipesByProduct.get(saleItem.productId) ?? [];
    recipe.forEach((entry) => {
      const totalUnits = saleItem.quantity * toNumber(entry.quantityUsed ?? 0);
      if (totalUnits <= 0) {
        return;
      }
      const bucket = requiredByItem.get(entry.inventoryItemId) ?? {
        amount: 0,
        products: new Set<string>(),
        isCritical: Boolean(entry.isCritical ?? true),
      };
      bucket.amount += totalUnits;
      bucket.products.add(saleItem.productId);
      bucket.isCritical = bucket.isCritical || Boolean(entry.isCritical ?? true);
      requiredByItem.set(entry.inventoryItemId, bucket);
    });
  }
  if (!requiredByItem.size) {
    throw new Error('Las recetas de los productos no están definidas.');
  }
  const adjustments: Array<Promise<void>> = [];
  for (const [itemId, bucket] of requiredByItem.entries()) {
    adjustments.push(
      (async () => {
        const itemInfo = await getItem(itemId);
        const stockRow = await supabaseAdmin
          .from(STOCK_TABLE)
          .select('quantity')
          .eq('itemId', itemId)
          .eq('branchId', branchId)
          .maybeSingle();
        if (stockRow.error && stockRow.error.code !== 'PGRST116') {
          throw new Error(stockRow.error.message);
        }
        const currentQuantity = toNumber(stockRow.data?.quantity ?? 0);
        if (currentQuantity < bucket.amount) {
          throw new Error(`Stock insuficiente para ${itemId}.`);
        }
        const nextQuantity = Math.max(0, currentQuantity - bucket.amount);
        await consumeBatches(itemId, branchId, bucket.amount, {
          orderReference: `Venta · ${Array.from(bucket.products).join(',')}`,
          staffId: payload.staffId,
        });
        await upsertStock(itemId, branchId, nextQuantity);
        const criticalFlag = bucket.isCritical || itemInfo.isCritical;
        const isLowStock =
          criticalFlag && itemInfo.minStock > 0
            ? nextQuantity / itemInfo.minStock <= 0.2
            : criticalFlag && nextQuantity <= 0;
        const shouldDeactivate = nextQuantity <= 0;
        await updateProductFlags(
          Array.from(bucket.products),
          Boolean(isLowStock),
          !shouldDeactivate
        );
      })()
    );
  }
  await Promise.all(adjustments);
  return { branchId };
};

const resolveRequest = async (payload: SmartInventoryRequest) => {
  if (payload.action === 'ingress') {
    const result = await handleIngress(payload);
    const status = await fetchInventoryStatus();
    return { status, result };
  }
  if (payload.action === 'sale') {
    const result = await handleSale(payload);
    const status = await fetchInventoryStatus();
    return { status, result };
  }
  const status = await fetchInventoryStatus();
  return { status, result: null };
};

export async function GET() {
  try {
    const status = await fetchInventoryStatus();
    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    console.error('Error fetching smart inventory:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos cargar el inventario inteligente.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as SmartInventoryRequest;
    if (!payload?.action) {
      return NextResponse.json({ success: false, error: 'Acción requerida.' }, { status: 400 });
    }
    const result = await resolveRequest(payload);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Error in smart inventory:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error inesperado en inventario.' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
