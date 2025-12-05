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

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';
const MAX_PRODUCTS = Number(process.env.CATALOG_LIMIT ?? 500);

export async function GET() {
  try {
    const { data: products, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .select('*')
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
export const dynamic = 'force-dynamic';
