'use server';

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

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-server';

const TURNOS_TABLE = process.env.SUPABASE_TURNOS_TABLE ?? 'turnos';
const VENTAS_TABLE = process.env.SUPABASE_VENTAS_TABLE ?? 'ventas';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';

const registrarVentaSchema = z.object({
  turnoId: z.number().int().positive(),
  total: z.number().positive(),
  metodoPago: z.enum(['efectivo', 'tarjeta', 'transferencia']),
  montoRecibido: z.number().nonnegative().optional(),
  orderId: z.string().min(1).optional(),
});

const cerrarTurnoSchema = z.object({
  turnoId: z.number().int().positive(),
  montoFisico: z.number().nonnegative(),
});

type RegistrarVentaInput = z.infer<typeof registrarVentaSchema>;
type RegistrarVentaResult = {
  ventaId: number;
  turnoId: number;
  cambioEntregado: number | null;
};

type CerrarTurnoInput = z.infer<typeof cerrarTurnoSchema>;
type CerrarTurnoResult = {
  turnoId: number;
  saldoEsperado: number;
  montoFisico: number;
  diferencia: number;
  estado: 'OK' | 'Faltante' | 'Sobrante';
};

type TurnoRecord = {
  id: number;
  estado?: string | null;
  saldo_inicial?: number | string | null;
  total_ventas_efectivo?: number | string | null;
  total_gastos_efectivo?: number | string | null;
};

const toNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const fetchTurno = async (turnoId: number): Promise<TurnoRecord> => {
  const { data, error } = await supabaseAdmin
    .from(TURNOS_TABLE)
    .select('id,estado,saldo_inicial,total_ventas_efectivo,total_gastos_efectivo')
    .eq('id', turnoId)
    .single();

  if (error || !data) {
    throw new Error('No encontramos el turno solicitado.');
  }

  if (data.estado && data.estado.toLowerCase() === 'cerrado') {
    throw new Error('El turno ya está cerrado.');
  }

  return data as TurnoRecord;
};

export async function registrarVenta(input: RegistrarVentaInput): Promise<RegistrarVentaResult> {
  const payload = registrarVentaSchema.parse(input);
  const turno = await fetchTurno(payload.turnoId);
  const isCash = payload.metodoPago === 'efectivo';

  if (isCash) {
    if (payload.montoRecibido === undefined) {
      throw new Error('Debes registrar con cuánto pagó el cliente.');
    }
    if (payload.montoRecibido < payload.total) {
      throw new Error('El monto recibido no puede ser menor al total.');
    }
  }

  const cambio =
    isCash && payload.montoRecibido !== undefined ? payload.montoRecibido - payload.total : null;

  const { data: venta, error: ventaError } = await supabaseAdmin
    .from(VENTAS_TABLE)
    .insert({
      turno_id: payload.turnoId,
      order_id: payload.orderId ?? null,
      total: payload.total,
      metodo_pago: payload.metodoPago,
      monto_recibido: isCash ? payload.montoRecibido ?? payload.total : null,
      cambio_entregado: cambio,
    })
    .select('id,turno_id')
    .single();

  if (ventaError || !venta) {
    throw new Error(ventaError?.message ?? 'No pudimos registrar la venta.');
  }

  if (isCash) {
    const currentCash = toNumber(turno.total_ventas_efectivo, 0);
    const nextCash = currentCash + payload.total;
    const { error: updateError } = await supabaseAdmin
      .from(TURNOS_TABLE)
      .update({ total_ventas_efectivo: nextCash })
      .eq('id', payload.turnoId);

    if (updateError) {
      throw new Error(updateError.message ?? 'No pudimos actualizar el total del turno.');
    }
  }

  if (payload.orderId) {
    const orderUpdate: Record<string, unknown> = {
      paymentMethod: payload.metodoPago,
    };
    if (isCash) {
      orderUpdate.cashTendered = payload.montoRecibido ?? payload.total;
      orderUpdate.cashChange = cambio;
    }
    const { error: orderUpdateError } = await supabaseAdmin
      .from(ORDERS_TABLE)
      .update(orderUpdate)
      .eq('id', payload.orderId);
    if (orderUpdateError) {
      console.warn('No se pudo actualizar el pedido al registrar la venta:', orderUpdateError);
    }
  }

  return {
    ventaId: venta.id as number,
    turnoId: venta.turno_id as number,
    cambioEntregado: cambio,
  };
}

export async function cerrarTurno(input: CerrarTurnoInput): Promise<CerrarTurnoResult> {
  const payload = cerrarTurnoSchema.parse(input);
  const turno = await fetchTurno(payload.turnoId);
  const saldoInicial = toNumber(turno.saldo_inicial, 0);
  const ventasEfectivo = toNumber(turno.total_ventas_efectivo, 0);
  const gastosEfectivo = toNumber(turno.total_gastos_efectivo, 0);
  const saldoEsperado = saldoInicial + ventasEfectivo - gastosEfectivo;
  const diferencia = Number((payload.montoFisico - saldoEsperado).toFixed(2));

  let estado: CerrarTurnoResult['estado'] = 'OK';
  if (Math.abs(diferencia) > 0.009) {
    estado = diferencia < 0 ? 'Faltante' : 'Sobrante';
  }

  const { error: updateError } = await supabaseAdmin
    .from(TURNOS_TABLE)
    .update({
      estado: 'cerrado',
      fecha_cierre: new Date().toISOString(),
    })
    .eq('id', payload.turnoId);

  if (updateError) {
    throw new Error(updateError.message ?? 'No pudimos cerrar el turno.');
  }

  return {
    turnoId: payload.turnoId,
    saldoEsperado: Number(saldoEsperado.toFixed(2)),
    montoFisico: Number(payload.montoFisico.toFixed(2)),
    diferencia,
    estado,
  };
}
