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
import { maybeAwardDailyCoffee } from '../../loyalty-utils';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';

export async function POST(_: Request, context: { params: { orderId?: string } }) {
  const orderId = context.params?.orderId?.trim();

  if (!orderId) {
    return NextResponse.json({ success: false, error: 'Falta el ID del pedido' }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const {
      data,
      error,
    } = await supabaseAdmin
      .from(ORDERS_TABLE)
      .update({ status: 'completed', updatedAt: now })
      .eq('id', orderId)
      .select('id,"userId",items')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'No encontramos el pedido' },
        { status: 404 }
      );
    }

    await maybeAwardDailyCoffee(orderId, data.userId ?? null, data.items ?? null);

    return NextResponse.json({ success: true, data: { id: data.id } });
  } catch (error) {
    console.error('Error completando pedido:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos marcar el pedido como completado' },
      { status: 500 }
    );
  }
}
