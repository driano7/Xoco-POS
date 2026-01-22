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
import { db } from '@/lib/database-manager';

type ProductType = 'beverage' | 'food' | 'package';
type AvailabilityStatus = 'available' | 'low_stock' | 'unavailable';

interface AvailabilityItem {
  id: string;
  productId: string;
  productType: ProductType;
  label: string;
  category?: string | null;
  subcategory?: string | null;
  availabilityStatus: AvailabilityStatus;
  reason?: string | null;
  lastModified?: string;
  modifiedBy?: string;
}

interface AvailabilitySection {
  type: ProductType;
  title: string;
  icon: string;
  items: AvailabilityItem[];
  stats: {
    total: number;
    available: number;
    unavailable: number;
  };
}

// GET - Obtener disponibilidad desde tabla products
export async function GET() {
  try {
    // Obtener productos con sus banderas de stock
    const productsResult = await db.select('products', {
      filters: {},
      orderBy: { column: 'name', ascending: true },
    });

    if (productsResult.error) {
      throw productsResult.error;
    }

    const products = productsResult.data as any[];
    
    // Agrupar por tipo
    const beverages = products.filter(p => 
      p.category === 'bebidas' || p.category === 'beverages' || 
      p.category === 'Bebidas' || p.category === 'Beverages'
    );
    const foods = products.filter(p => 
      p.category === 'alimentos' || p.category === 'food' || 
      p.category === 'Alimentos' || p.category === 'Food'
    );
    const packages = products.filter(p => 
      p.category === 'paquetes' || p.category === 'packages' || 
      p.category === 'Paquetes' || p.category === 'Packages'
    );

    // Mapear a formato esperado por el frontend
    const mapProductsToAvailability = (productList: any[], type: ProductType): AvailabilityItem[] => {
      return productList.map(product => {
        // Determinar estado basado en banderas de stock
        let availabilityStatus: AvailabilityStatus = 'available';
        let reason: string | null = null;
        
        if (product.out_of_stock_reason || product.manualStockStatus === 'out') {
          availabilityStatus = 'unavailable';
          reason = product.out_of_stock_reason || product.manualStockReason || 'Sin stock';
        } else if (product.is_low_stock || product.manualStockStatus === 'low') {
          availabilityStatus = 'low_stock';
          reason = product.manualStockReason || 'Poco stock';
        }

        return {
          id: `avail_${product.id}`,
          productId: product.id,
          productType: type,
          label: product.name || product.label || 'Sin nombre',
          category: product.category,
          subcategory: product.subcategory,
          availabilityStatus,
          reason,
          lastModified: product.manualStatusUpdatedAt,
          modifiedBy: 'staff', // Podría obtenerse del auth context
        };
      });
    };

    const response = {
      beverage: {
        type: 'beverage' as const,
        title: 'Bebidas',
        icon: '☕',
        items: mapProductsToAvailability(beverages, 'beverage'),
        stats: {
          total: beverages.length,
          available: beverages.filter(p => !p.out_of_stock_reason && p.manualStockStatus !== 'out').length,
          unavailable: beverages.filter(p => p.out_of_stock_reason || p.manualStockStatus === 'out').length,
        },
      },
      food: {
        type: 'food' as const,
        title: 'Alimentos',
        icon: '🍽',
        items: mapProductsToAvailability(foods, 'food'),
        stats: {
          total: foods.length,
          available: foods.filter(p => !p.out_of_stock_reason && p.manualStockStatus !== 'out').length,
          unavailable: foods.filter(p => p.out_of_stock_reason || p.manualStockStatus === 'out').length,
        },
      },
      package: {
        type: 'package' as const,
        title: 'Paquetes',
        icon: '📦',
        items: mapProductsToAvailability(packages, 'package'),
        stats: {
          total: packages.length,
          available: packages.filter(p => !p.out_of_stock_reason && p.manualStockStatus !== 'out').length,
          unavailable: packages.filter(p => p.out_of_stock_reason || p.manualStockStatus === 'out').length,
        },
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching availability:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    );
  }
}

// POST - Actualizar banderas de stock en tabla products
export async function POST(request: Request) {
  try {
    const { productId, productType, availabilityStatus, reason } = await request.json();

    if (!productId || !productType || !availabilityStatus) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Mapear availabilityStatus a las banderas de products
    let updateData: any = {
      manualStatusUpdatedAt: new Date().toISOString(),
    };

    switch (availabilityStatus) {
      case 'available':
        updateData = {
          ...updateData,
          is_low_stock: false,
          out_of_stock_reason: null,
          manualStockStatus: 'normal',
          manualStockReason: reason || null,
        };
        break;
      case 'low_stock':
        updateData = {
          ...updateData,
          is_low_stock: true,
          out_of_stock_reason: null,
          manualStockStatus: 'low',
          manualStockReason: reason || 'Poca disponibilidad',
        };
        break;
      case 'unavailable':
        updateData = {
          ...updateData,
          is_low_stock: false,
          out_of_stock_reason: reason || 'Sin disponibilidad',
          manualStockStatus: 'out',
          manualStockReason: reason || 'Sin disponibilidad',
        };
        break;
    }

    // Actualizar producto
    const result = await db.update('products', updateData, { id: productId });
    
    if (result.error) {
      throw result.error;
    }

    // Opcional: Registrar en historial si existe la tabla
    try {
      await db.insert('availability_history', {
        id: `hist_${productId}_${Date.now()}`,
        productId,
        productType,
        previousStatus: 'available', // Podría obtenerse del estado anterior
        newStatus: availabilityStatus,
        reason: reason || null,
        staffId: 'current_user', // Obtener del auth context
        createdAt: new Date().toISOString(),
      });
    } catch (historyError) {
      // Ignorar error si la tabla no existe
      console.warn('Could not log to availability_history:', historyError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating availability:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Error al actualizar disponibilidad' 
      },
      { status: 500 }
    );
  }
}
