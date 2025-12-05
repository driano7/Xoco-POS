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

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const RESERVATIONS_TABLE = process.env.SUPABASE_RESERVATIONS_TABLE ?? 'reservations';
const MAX_MONTHS = 18;

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type CustomerStat = {
  orders: number;
  spent: number;
  avgTicket: number;
};

type ClusterKey = 'high' | 'routine' | 'occasional';

const classifyCluster = (stat: CustomerStat): ClusterKey => {
  if (stat.spent >= 800 || stat.orders >= 12) {
    return 'high';
  }
  if (stat.spent >= 300) {
    return 'routine';
  }
  return 'occasional';
};

const buildMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const base = new Date(year, (month ?? 1) - 1, 1);
  return base.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
};

const buildClusterChart = (customers: CustomerStat[]) => {
  if (!customers.length) {
    return {
      points: [],
      centroid: { orders: 0, spent: 0 },
    };
  }
  const points = customers.map((entry) => ({ orders: entry.orders, spent: entry.spent }));
  const avgOrders = Number(
    (customers.reduce((sum, entry) => sum + entry.orders, 0) / customers.length).toFixed(2)
  );
  const avgSpent = Number(
    (customers.reduce((sum, entry) => sum + entry.spent, 0) / customers.length).toFixed(2)
  );
  return {
    points,
    centroid: { orders: avgOrders, spent: avgSpent },
  };
};
const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const formatHourRange = (hour: number) => {
  const start = hour.toString().padStart(2, '0');
  const end = ((hour + 1) % 24).toString().padStart(2, '0');
  return `${start}:00-${end}:00`;
};

type ClusterSnapshot = {
  label: string;
  count: number;
  avgTicket: number;
  chart: ReturnType<typeof buildClusterChart>;
};

type LowActivityEntry = {
  day: string;
  hour: string;
  interactions: number;
};

type MonthHistoryEntry = {
  month: string;
  label: string;
  clusters: Record<ClusterKey, ClusterSnapshot>;
  lowActivity: LowActivityEntry[];
};

const exportClusterToCsv = (customers: CustomerStat[]) => {
  const header = ['Ordenes', 'Gastado', 'Ticket promedio'];
  const rows = customers.map((entry) => [
    String(entry.orders),
    entry.spent.toFixed(2),
    entry.avgTicket.toFixed(2),
  ]);
  return [header, ...rows]
    .map((cols) => cols.map((col) => `"${col.replace(/"/g, '""')}"`).join(','))
    .join('\n');
};

const exportClusterToExcel = (customers: CustomerStat[]) => {
  const header =
    '<tr><th>Órdenes</th><th>Gastado</th><th>Ticket promedio</th></tr>';
  const body = customers
    .map(
      (entry) =>
        `<tr><td>${entry.orders}</td><td>${entry.spent.toFixed(2)}</td><td>${entry.avgTicket.toFixed(2)}</td></tr>`
    )
    .join('');
  return `<table>${header}${body}</table>`;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const targetMonth = url.searchParams.get('month')?.substring(0, 7) ?? null;
    const clusterParam = url.searchParams.get('cluster') as ClusterKey | null;
    const formatParam = url.searchParams.get('format') as 'csv' | 'excel' | null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const earliest = new Date(today);
    earliest.setMonth(earliest.getMonth() - (MAX_MONTHS - 1));
    earliest.setDate(1);
    const earliestIso = earliest.toISOString();

    const [{ data: orders, error: ordersError }, { data: reservations, error: reservationsError }] =
      await Promise.all([
        supabaseAdmin
          .from(ORDERS_TABLE)
          .select('"userId","total","createdAt"')
          .gte('createdAt', earliestIso)
          .order('createdAt', { ascending: false }),
        supabaseAdmin
          .from(RESERVATIONS_TABLE)
          .select('"reservationDate","reservationTime","createdAt"')
          .gte('createdAt', earliestIso),
      ]);

    if (ordersError || reservationsError) {
      throw new Error(ordersError?.message || reservationsError?.message || 'Supabase error');
    }

    const monthMap = new Map<
      string,
      {
        label: string;
        customers: Map<string, { orders: number; spent: number }>;
      }
    >();
    const interactionMap = new Map<string, Map<number, Map<number, number>>>();

    const trackInteraction = (monthKey: string, date: Date | null) => {
      if (!date || Number.isNaN(date.getTime())) {
        return;
      }
      const month = monthKey;
      const day = date.getDay();
      const hour = date.getHours();
      const dayMap = interactionMap.get(month) ?? new Map<number, Map<number, number>>();
      const hourMap = dayMap.get(day) ?? new Map<number, number>();
      hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);
      dayMap.set(day, hourMap);
      interactionMap.set(month, dayMap);
    };

    (orders ?? []).forEach((order) => {
      const userId = order.userId?.trim();
      if (!userId || !order.createdAt) {
        return;
      }
      const monthKey = order.createdAt.substring(0, 7);
      const entry =
        monthMap.get(monthKey) ?? {
          label: buildMonthLabel(monthKey),
          customers: new Map(),
        };
      const stats = entry.customers.get(userId) ?? { orders: 0, spent: 0 };
      stats.orders += 1;
      stats.spent += toNumber(order.total);
      entry.customers.set(userId, stats);
      monthMap.set(monthKey, entry);
      const orderDate = new Date(order.createdAt);
      trackInteraction(monthKey, orderDate);
    });

    const parseReservationDate = (record: { reservationDate?: string | null; reservationTime?: string | null; createdAt?: string | null }) => {
      if (record.reservationDate) {
        const base = `${record.reservationDate}T${record.reservationTime ?? '00:00'}:00`;
        const parsed = new Date(base);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
      if (record.createdAt) {
        const parsed = new Date(record.createdAt);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
      return null;
    };

    (reservations ?? []).forEach((reservation) => {
      const date = parseReservationDate(reservation);
      if (!date) {
        return;
      }
      const monthKey = date.toISOString().substring(0, 7);
      trackInteraction(monthKey, date);
    });

    const monthCustomers = new Map<
      string,
      Record<ClusterKey, CustomerStat[]>
    >();

    const currentMonthKey = new Date().toISOString().substring(0, 7);
    if (!monthMap.has(currentMonthKey)) {
      monthMap.set(currentMonthKey, {
        label: buildMonthLabel(currentMonthKey),
        customers: new Map(),
      });
    }
    if (!interactionMap.has(currentMonthKey)) {
      interactionMap.set(currentMonthKey, new Map());
    }
    if (!monthCustomers.has(currentMonthKey)) {
      monthCustomers.set(currentMonthKey, {
        high: [],
        routine: [],
        occasional: [],
      });
    }

    const sortedMonths = Array.from(monthMap.entries()).sort((a, b) =>
      b[0].localeCompare(a[0])
    );
    const limitedMonths = sortedMonths.slice(0, MAX_MONTHS);

    const history: MonthHistoryEntry[] = limitedMonths.map(([month, entry]) => {
      const clusterBuckets: Record<ClusterKey, CustomerStat[]> = {
        high: [],
        routine: [],
        occasional: [],
      };
      entry.customers.forEach((stats) => {
        const customerStat: CustomerStat = {
          orders: stats.orders,
          spent: Number(stats.spent.toFixed(2)),
          avgTicket: stats.orders ? Number((stats.spent / stats.orders).toFixed(2)) : 0,
        };
        const bucket = classifyCluster(customerStat);
        clusterBuckets[bucket].push(customerStat);
      });
      monthCustomers.set(month, clusterBuckets);

      const clusters = (Object.keys(clusterBuckets) as ClusterKey[]).reduce(
        (acc, key) => {
          const customers = clusterBuckets[key];
          const totalSpent = customers.reduce((sum, cust) => sum + cust.spent, 0);
          acc[key] = {
            label:
              key === 'high'
                ? 'Alta frecuencia'
                : key === 'routine'
                  ? 'Recurrentes'
                  : 'Esporádicos',
            count: customers.length,
            avgTicket:
              customers.length > 0
                ? Number((totalSpent / customers.length).toFixed(2))
                : 0,
            chart: buildClusterChart(customers),
          };
          return acc;
        },
        {} as Record<ClusterKey, ClusterSnapshot>
      );

      const dayMap = interactionMap.get(month) ?? new Map<number, Map<number, number>>();
      const lowActivity: LowActivityEntry[] = [];
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const hours = dayMap.get(dayIndex) ?? new Map<number, number>();
        if (hours.size === 0) {
          lowActivity.push({
            day: DAY_LABELS[dayIndex],
            hour: 'Sin interacciones',
            interactions: 0,
          });
          continue;
        }
        const lowest = Array.from(hours.entries()).reduce(
          (acc, [hour, count]) => {
            if (!acc || count < acc.count || (count === acc.count && hour < acc.hour)) {
              return { hour, count };
            }
            return acc;
          },
          { hour: 0, count: Number.POSITIVE_INFINITY }
        );
        lowActivity.push({
          day: DAY_LABELS[dayIndex],
          hour: formatHourRange(lowest.hour),
          interactions: lowest.count,
        });
      }

      return {
        month,
        label: entry.label,
        clusters,
        lowActivity,
      };
    });

    if (formatParam && targetMonth && clusterParam) {
      const monthEntry = monthCustomers.get(targetMonth);
      if (!monthEntry) {
        return NextResponse.json(
          { success: false, error: 'No hay datos para ese mes.' },
          { status: 404 }
        );
      }
      const customers = monthEntry[clusterParam] ?? [];
      if (formatParam === 'csv') {
        const csv = exportClusterToCsv(customers);
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="marketing-${clusterParam}-${targetMonth}.csv"`,
          },
        });
      }
      const html = exportClusterToExcel(customers);
      return new Response(html, {
        headers: {
          'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
          'Content-Disposition': `attachment; filename="marketing-${clusterParam}-${targetMonth}.xls"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        months: history.map((entry) => ({ month: entry.month, label: entry.label })),
        history,
      },
    });
  } catch (error) {
    console.error('Error building marketing history:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos calcular el histórico de marketing.' },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-dynamic';
