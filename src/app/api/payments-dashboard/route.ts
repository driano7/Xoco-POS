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

const PAYMENTS_TABLE = process.env.SUPABASE_PAYMENTS_TABLE ?? 'payments';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const REPORTS_TABLE = process.env.SUPABASE_REPORTS_TABLE ?? 'report_requests';

const DEFAULT_WINDOW_HOURS = Number(process.env.PAYMENTS_WINDOW_HOURS ?? 24);

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = Number(searchParams.get('hours')) || DEFAULT_WINDOW_HOURS;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartIso = monthStart.toISOString();

    const [
      { data: payments, error: paymentsError },
      { data: orders, error: ordersError },
      { data: reportRequests, error: reportsError },
      { data: monthlyTipsRows, error: monthlyTipsError },
    ] = await Promise.all([
      supabaseAdmin
        .from(PAYMENTS_TABLE)
        .select(
          'id,"orderId","ticketId",method,amount,currency,status,"tipAmount","tipPercent","createdAt","updatedAt"'
        )
        .gte('createdAt', since)
        .order('createdAt', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from(ORDERS_TABLE)
        .select('id,"orderNumber",status,total,currency,"createdAt"')
        .gte('createdAt', since),
      supabaseAdmin
        .from(REPORTS_TABLE)
        .select(
          'id,scope,granularity,status,"periodStart","periodEnd","resultUrl","createdAt","updatedAt"'
        )
        .order('createdAt', { ascending: false })
        .limit(20),
      supabaseAdmin.from(PAYMENTS_TABLE).select('"tipAmount"').gte('createdAt', monthStartIso),
    ]);

    if (paymentsError || ordersError || reportsError || monthlyTipsError) {
      const message =
        paymentsError?.message ||
        ordersError?.message ||
        reportsError?.message ||
        monthlyTipsError?.message ||
        'Supabase error';
      throw new Error(message);
    }

    const orderMap = new Map((orders ?? []).map((order) => [order.id, order]));

    let totalAmount = 0;
    let totalTips = 0;
    const byMethod = new Map<string, number>();
    const byStatus = new Map<string, number>();

    (payments ?? []).forEach((payment) => {
      const amount = toNumber(payment.amount);
      const tip = toNumber(payment.tipAmount);
      totalAmount += amount;
      totalTips += tip;

      const methodKey = payment.method || 'otro';
      byMethod.set(methodKey, (byMethod.get(methodKey) || 0) + amount);

      const statusKey = payment.status || 'desconocido';
      byStatus.set(statusKey, (byStatus.get(statusKey) || 0) + 1);
    });

    const methodBreakdown = Array.from(byMethod.entries()).map(([method, amount]) => ({
      method,
      amount,
    }));

    const statusBreakdown = Array.from(byStatus.entries()).map(([status, count]) => ({
      status,
      count,
    }));

    const enrichedPayments = (payments ?? []).map((payment) => ({
      ...payment,
      order: payment.orderId ? orderMap.get(payment.orderId) || null : null,
    }));

    const pendingReports = (reportRequests ?? []).filter(
      (report) => report.status === 'queued' || report.status === 'processing'
    );

    const monthlyTipsTotal = (monthlyTipsRows ?? []).reduce(
      (sum, row) => sum + toNumber((row as { tipAmount?: unknown })?.tipAmount),
      0
    );

    return NextResponse.json({
      success: true,
      data: {
        totalAmount: Number(totalAmount.toFixed(2)),
        totalTips: Number(totalTips.toFixed(2)),
        monthlyTipsTotal: Number(monthlyTipsTotal.toFixed(2)),
        monthlyTipPeriodStart: monthStartIso,
        monthlyTipPeriodEnd: new Date().toISOString(),
        payments: enrichedPayments,
        methodBreakdown,
        statusBreakdown,
        pendingReports,
      },
    });
  } catch (error) {
    console.error('Error fetching payments dashboard:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch payments dashboard' },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-dynamic';
