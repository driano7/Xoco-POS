/*
 * --------------------------------------------------------------------
 *  Xoco POS — Inventory manual status update endpoint
 * --------------------------------------------------------------------
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const ITEMS_TABLE = process.env.SUPABASE_INVENTORY_ITEMS ?? 'inventory_items';
const PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE ?? 'products';

type ManualStockStatus = 'normal' | 'low' | 'out';
type TargetEntity = 'inventory' | 'product';

const normalizeStatus = (value: unknown): ManualStockStatus | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const lowered = value.toLowerCase();
  if (lowered === 'normal' || lowered === 'low' || lowered === 'out') {
    return lowered;
  }
  return null;
};

const normalizeTarget = (value: unknown): TargetEntity | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const lowered = value.toLowerCase();
  if (lowered === 'inventory' || lowered === 'item' || lowered === 'raw' || lowered === 'ingredient') {
    return 'inventory';
  }
  if (lowered === 'product' || lowered === 'menu' || lowered === 'catalog') {
    return 'product';
  }
  return null;
};

const sanitizeReason = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      target?: string;
      id?: string;
      status?: string;
      reason?: string | null;
    };

    const target = normalizeTarget(payload?.target);
    const status = normalizeStatus(payload?.status);
    const recordId = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!target || !status || !recordId) {
      return NextResponse.json(
        { success: false, error: 'Necesitamos la entidad, el identificador y el estado.' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const reason = status === 'normal' ? null : sanitizeReason(payload?.reason);
    const baseUpdates = {
      manualStockStatus: status,
      manualStockReason: reason,
      manualStatusUpdatedAt: now,
    };

    if (target === 'inventory') {
      const { data, error } = await supabaseAdmin
        .from(ITEMS_TABLE)
        .update(baseUpdates)
        .eq('id', recordId)
        .select('id')
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (!data) {
        return NextResponse.json(
          { success: false, error: 'No encontramos el insumo solicitado.' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: { id: data.id, target, status, reason },
      });
    }

    const isLowStock = status === 'low' || status === 'out';
    const productUpdates = {
      ...baseUpdates,
      is_low_stock: isLowStock,
      updatedAt: now,
    };
    const { data, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .update(productUpdates)
      .eq('id', recordId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    if (!data) {
      return NextResponse.json(
        { success: false, error: 'No encontramos el producto solicitado.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { id: data.id, target, status, reason, isLowStock },
    });
  } catch (error) {
    console.error('Error updating manual inventory status:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'No pudimos actualizar el estado manual del inventario.',
      },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
