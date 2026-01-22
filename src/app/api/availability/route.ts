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
import { sqlite } from '@/lib/sqlite';
import { db } from '@/lib/database-manager';

const AVAILABILITY_TABLE = 'product_availability';
const AVAILABILITY_HISTORY_TABLE = 'availability_history';

type ProductType = 'beverage' | 'food' | 'package';

interface AvailabilityRequest {
  productId: string;
  productType: ProductType;
  isAvailable: boolean;
  reason?: string;
}

interface AvailabilityItem {
  id: string;
  productId: string;
  productType: ProductType;
  label?: string;
  category?: string | null;
  subcategory?: string | null;
  isAvailable: boolean;
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

// Función para obtener disponibilidad desde la base de datos
async function getAvailabilityFromDB(): Promise<Record<ProductType, AvailabilitySection>> {
  try {
    // Intentar obtener de Supabase primero
    const { data: supabaseData, error: supabaseError } = await supabaseAdmin
      .from(AVAILABILITY_TABLE)
      .select('*')
      .order('updatedAt', { ascending: false });

    if (supabaseError) {
      console.error('Error fetching from Supabase:', supabaseError);
      // Hacer fallback a SQLite
      return getAvailabilityFromSQLite();
    }

    // Si hay datos en Supabase, usarlos
    if (supabaseData && supabaseData.length > 0) {
      return processAvailabilityData(supabaseData);
    }

    // Si no hay datos en Supabase, intentar con SQLite
    return getAvailabilityFromSQLite();
  } catch (error) {
    console.error('Error in getAvailabilityFromDB:', error);
    // Fallback a SQLite
    return getAvailabilityFromSQLite();
  }
}

// Función para obtener disponibilidad desde SQLite
async function getAvailabilityFromSQLite(): Promise<Record<ProductType, AvailabilitySection>> {
  const query = `
    SELECT 
      pa.id,
      pa.productId,
      pa.productType,
      pa.isAvailable,
      pa.reason,
      pa.createdAt,
      pa.updatedAt,
      su.firstName || 'Sistema' as modifiedBy,
      pa.updatedAt as lastModified,
      p.name as label,
      p.category,
      p.subcategory
    FROM ${AVAILABILITY_TABLE} pa
    LEFT JOIN products p ON pa.productId = p.id
    ORDER BY pa.productType, p.name
  `;

  const rows = await sqlite.all(query);

  return processAvailabilityData(rows);
}

// Función para procesar los datos de disponibilidad
function processAvailabilityData(rows: any[]): Record<ProductType, AvailabilitySection> {
  const result: Record<ProductType, AvailabilitySection> = {
    beverage: {
      type: 'beverage',
      title: 'Bebidas',
      icon: '☕',
      items: [],
      stats: { total: 0, available: 0, unavailable: 0 },
    },
    food: {
      type: 'food',
      title: 'Alimentos',
      icon: '🍽',
      items: [],
      stats: { total: 0, available: 0, unavailable: 0 },
    },
    package: {
      type: 'package',
      title: 'Paquetes',
      icon: '📦',
      items: [],
      stats: { total: 0, available: 0, unavailable: 0 },
    },
  };

  rows.forEach((row: any) => {
    const productType = row.productType as ProductType;
    const item: AvailabilityItem = {
      id: row.id,
      productId: row.productId,
      productType,
      label: row.label || `${row.productId} - Sin nombre`,
      category: row.category,
      subcategory: row.subcategory,
      isAvailable: Boolean(row.isAvailable),
      reason: row.reason,
      lastModified: row.lastModified,
      modifiedBy: row.modifiedBy,
    };

    result[productType].items.push(item);
    result[productType].stats.total++;
    if (item.isAvailable) {
      result[productType].stats.available++;
    } else {
      result[productType].stats.unavailable++;
    }
  });

  return result;
}

// GET - Obtener disponibilidad de productos
export async function GET() {
  try {
    const availability = await getAvailabilityFromDB();
    
    return NextResponse.json({
      success: true,
      data: availability,
    });
  } catch (error) {
    console.error('Error in availability GET:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    );
  }
}

// POST - Actualizar disponibilidad de un producto
export async function POST(request: Request) {
  try {
    const body: AvailabilityRequest = await request.json();
    const { productId, productType, isAvailable, reason } = body;

    // Validar datos
    if (!productId || !productType || typeof isAvailable !== 'boolean') {
      return NextResponse.json(
        {
          success: false,
          error: 'Datos inválidos: se requiere productId, productType e isAvailable',
        },
        { status: 400 }
      );
    }

    // Usar el database manager para manejar fallback automático
    const result = await db.select(AVAILABILITY_TABLE, {
      filters: { productId },
      single: true,
    });

    if (result.error) {
      throw result.error;
    }

    const existingRecord = result.data as any;
    const currentStatus = existingRecord?.isAvailable ? 1 : 0;

    if (existingRecord) {
      // Actualizar registro existente
      const updateData = {
        isAvailable: isAvailable ? 1 : 0,
        reason: reason || null,
        updatedAt: new Date().toISOString(),
      };

      const updateResult = await db.update(AVAILABILITY_TABLE, updateData, { id: existingRecord.id });
      
      if (updateResult.error) {
        throw updateResult.error;
      }

      // Registrar en historial
      await db.insert(AVAILABILITY_HISTORY_TABLE, {
        productId,
        productType,
        previousStatus: currentStatus,
        newStatus: isAvailable ? 1 : 0,
        reason: reason || null,
        createdAt: new Date().toISOString(),
      });
    } else {
      // Crear nuevo registro
      const newRecord = {
        id: `avail_${productId}_${Date.now()}`,
        productId,
        productType,
        isAvailable: isAvailable ? 1 : 0,
        reason: reason || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const insertResult = await db.insert(AVAILABILITY_TABLE, newRecord);
      
      if (insertResult.error) {
        throw insertResult.error;
      }

      // Registrar en historial
      await db.insert(AVAILABILITY_HISTORY_TABLE, {
        productId,
        productType,
        previousStatus: 0, // Antes no existía
        newStatus: isAvailable ? 1 : 0,
        reason: reason || null,
        createdAt: new Date().toISOString(),
      });
    }

    // Obtener datos actualizados para respuesta
    const updatedAvailability = await getAvailabilityFromDB();

    return NextResponse.json({
      success: true,
      data: updatedAvailability,
      message: `Disponibilidad actualizada para ${productId}`,
    });
  } catch (error) {
    console.error('Error in availability POST:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Error al actualizar disponibilidad',
      },
      { status: 500 }
    );
  }
}
