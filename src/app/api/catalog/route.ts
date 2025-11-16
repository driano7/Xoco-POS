import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const MAX_PRODUCTS = Number(process.env.CATALOG_LIMIT ?? 500);

export async function GET() {
  try {
    const { data: products, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .select(
        'id,"productId",name,category,subcategory,price,cost,"totalSales","totalRevenue","avgRating","reviewCount","stockQuantity","lowStockThreshold","isActive","createdAt","updatedAt"'
      )
      .order('updatedAt', { ascending: false })
      .limit(MAX_PRODUCTS);

    if (error) {
      throw new Error(error.message);
    }

    const items = products ?? [];
    const categoryTotals = new Map<
      string,
      { name: string; products: number; active: number; totalRevenue: number }
    >();

    items.forEach((product) => {
      const key = product.category || 'Sin categoría';
      const entry =
        categoryTotals.get(key) ??
        ({
          name: key,
          products: 0,
          active: 0,
          totalRevenue: 0,
        } as { name: string; products: number; active: number; totalRevenue: number });
      entry.products += 1;
      if (product.isActive !== false) {
        entry.active += 1;
      }
      entry.totalRevenue += Number(product.totalRevenue || 0);
      categoryTotals.set(key, entry);
    });

    return NextResponse.json({
      success: true,
      data: {
        products: items,
        categories: Array.from(categoryTotals.values()),
      },
    });
  } catch (error) {
    console.error('Error fetching catalog:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch catalog' }, { status: 500 });
  }
}
