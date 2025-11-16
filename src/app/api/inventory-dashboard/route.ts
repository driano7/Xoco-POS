import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const CATEGORIES_TABLE = process.env.SUPABASE_INVENTORY_CATEGORIES ?? 'inventory_categories';
const ITEMS_TABLE = process.env.SUPABASE_INVENTORY_ITEMS ?? 'inventory_items';
const STOCK_TABLE = process.env.SUPABASE_INVENTORY_STOCK ?? 'inventory_stock';
const MOVEMENTS_TABLE = process.env.SUPABASE_INVENTORY_MOVEMENTS ?? 'inventory_movements';

const MAX_MOVEMENTS = Number(process.env.SUPABASE_INVENTORY_MOVEMENTS_LIMIT ?? 50);

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET() {
  try {
    const [{ data: categories, error: categoriesError }, { data: items, error: itemsError }] =
      await Promise.all([
        supabaseAdmin.from(CATEGORIES_TABLE).select('id,code,name'),
        supabaseAdmin
          .from(ITEMS_TABLE)
          .select('id,"categoryId",name,unit,"minStock","isActive","createdAt","updatedAt"')
          .order('name', { ascending: true }),
      ]);

    if (categoriesError || itemsError) {
      const message =
        categoriesError?.message || itemsError?.message || 'Failed to fetch inventory';
      throw new Error(message);
    }

    const [{ data: stockRows, error: stockError }, { data: movements, error: movementsError }] =
      await Promise.all([
        supabaseAdmin.from(STOCK_TABLE).select('itemId,branchId,quantity'),
        supabaseAdmin
          .from(MOVEMENTS_TABLE)
          .select('id,itemId,branchId,type,quantity,reason,"createdAt"')
          .order('createdAt', { ascending: false })
          .limit(MAX_MOVEMENTS),
      ]);

    if (stockError || movementsError) {
      const message = stockError?.message || movementsError?.message || 'Failed to fetch stock';
      throw new Error(message);
    }

    const categoryMap = new Map((categories ?? []).map((category) => [category.id, category]));

    const stockByItem = new Map<
      string,
      { total: number; branches: Array<{ branchId: string | null; quantity: number }> }
    >();
    (stockRows ?? []).forEach((row) => {
      if (!row.itemId) return;
      const entry =
        stockByItem.get(row.itemId) || {
          total: 0,
          branches: [] as Array<{ branchId: string | null; quantity: number }>,
        };
      const qty = toNumber(row.quantity);
      entry.total += qty;
      entry.branches.push({
        branchId: row.branchId,
        quantity: qty,
      });
      stockByItem.set(row.itemId, entry);
    });

    const enrichedItems = (items ?? []).map((item) => {
      const stock = stockByItem.get(item.id) || { total: 0, branches: [] };
      const minStock = toNumber(item.minStock);
      return {
        ...item,
        minStock,
        stockTotal: stock.total,
        branches: stock.branches,
        category: categoryMap.get(item.categoryId) || null,
        isLowStock: stock.total <= minStock,
      };
    });

    const lowStockItems = enrichedItems
      .filter((item) => item.isLowStock)
      .sort((a, b) => a.stockTotal - b.stockTotal)
      .slice(0, 10);

    return NextResponse.json({
      success: true,
      data: {
        categories: categories ?? [],
        items: enrichedItems,
        lowStock: lowStockItems,
        recentMovements: movements ?? [],
      },
    });
  } catch (error) {
    console.error('Error fetching inventory dashboard:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch inventory dashboard' },
      { status: 500 }
    );
  }
}
