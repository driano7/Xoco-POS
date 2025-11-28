import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const sanitizeEnv = (value?: string | null) => value?.trim() || null;

const PUBLIC_SALE_CLIENT_ID =
  sanitizeEnv(process.env.SUPABASE_PUBLIC_SALE_CLIENT_ID) ??
  sanitizeEnv(process.env.NEXT_PUBLIC_PUBLIC_SALE_CLIENT_ID) ??
  'AAA-1111';
const PUBLIC_SALE_USER_ID =
  sanitizeEnv(process.env.SUPABASE_PUBLIC_SALE_USER_ID) ??
  sanitizeEnv(process.env.NEXT_PUBLIC_PUBLIC_SALE_USER_ID) ??
  PUBLIC_SALE_CLIENT_ID;
const PUBLIC_SALE_CLIENT_ID_LOWER = PUBLIC_SALE_CLIENT_ID?.toLowerCase() ?? '';
const PUBLIC_SALE_USER_ID_LOWER = PUBLIC_SALE_USER_ID?.toLowerCase() ?? '';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const MAX_MONTHS = 18;

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalize = (value?: string | null) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const isPublicSaleOrder = (order: { userId?: string | null }) => {
  const userId = normalize(order.userId);
  if (!userId) {
    return false;
  }
  if (PUBLIC_SALE_USER_ID_LOWER && userId === PUBLIC_SALE_USER_ID_LOWER) {
    return true;
  }
  return false;
};

const buildMonthLabel = (monthKey: string) => {
  const baseDate = new Date(`${monthKey}-01T00:00:00Z`);
  return baseDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
};

const buildCsv = (month: string, orders: NormalizedOrder[]) => {
  const header = ['Fecha', 'Ticket', 'Orden', 'Total', 'Propina', 'Método'];
  const rows = orders.map((order) => [
    new Date(order.createdAt).toLocaleString('es-MX'),
    order.ticketCode ?? order.orderNumber ?? '—',
    order.orderNumber ?? '—',
    order.total.toFixed(2),
    order.tipAmount.toFixed(2),
    order.paymentMethod ?? '—',
  ]);
  return [header, ...rows]
    .map((cols) => cols.map((col) => `"${String(col).replace(/"/g, '""')}"`).join(','))
    .join('\n');
};

const buildExcelHtml = (orders: NormalizedOrder[]) => {
  const header =
    '<tr><th>Fecha</th><th>Ticket</th><th>Orden</th><th>Total</th><th>Propina</th><th>Método</th></tr>';
  const body = orders
    .map((order) => {
      const dateLabel = new Date(order.createdAt).toLocaleString('es-MX');
      const ticket = order.ticketCode ?? order.orderNumber ?? '—';
      return `<tr><td>${dateLabel}</td><td>${ticket}</td><td>${order.orderNumber ?? '—'}</td><td>${
        order.total.toFixed(2)
      }</td><td>${order.tipAmount.toFixed(2)}</td><td>${order.paymentMethod ?? '—'}</td></tr>`;
    })
    .join('');
  return `<table>${header}${body}</table>`;
};

type NormalizedOrder = {
  id: string;
  ticketCode: string | null;
  orderNumber: string | null;
  total: number;
  tipAmount: number;
  createdAt: string;
  paymentMethod: string | null;
};

type RawOrderRow = {
  id: string;
  orderNumber?: string | null;
  userId?: string | null;
  status?: string | null;
  total?: number | null;
  tipAmount?: number | null;
  createdAt?: string | null;
  queuedPaymentMethod?: string | null;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedFormat = searchParams.get('format');
    const requestedMonth =
      searchParams.get('month')?.replace(/[^0-9-]/g, '').substring(0, 7) ?? null;

    const now = new Date();
    const earliest = new Date(now.getFullYear(), now.getMonth() - (MAX_MONTHS - 1), 1);
    earliest.setHours(0, 0, 0, 0);

    const orderSelectFields = [
      'id',
      '"orderNumber"',
      '"userId"',
      '"status"',
      '"total"',
      '"tipAmount"',
      '"createdAt"',
      '"queuedPaymentMethod"',
    ];
    const { data, error } = await supabaseAdmin
      .from(ORDERS_TABLE)
      .select(orderSelectFields.join(','))
      .eq('status', 'completed')
      .gte('createdAt', earliest.toISOString())
      .order('createdAt', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const publicMonthMap = new Map<string, { label: string; orders: NormalizedOrder[] }>();
    const overallMonthMap = new Map<string, { label: string; orders: NormalizedOrder[] }>();

    const rows: RawOrderRow[] = Array.isArray(data) ? ((data as unknown) as RawOrderRow[]) : [];
    rows.forEach((order) => {
      if (!order.createdAt) {
        return;
      }
      const monthKey = order.createdAt.substring(0, 7);
      const normalized: NormalizedOrder = {
        id: order.id,
        ticketCode: order.orderNumber ?? null,
        orderNumber: order.orderNumber ?? null,
        total: toNumber(order.total),
        tipAmount: toNumber(order.tipAmount),
        createdAt: order.createdAt,
        paymentMethod: order.queuedPaymentMethod ?? null,
      };
      const overallEntry =
        overallMonthMap.get(monthKey) ?? { label: buildMonthLabel(monthKey), orders: [] };
      overallEntry.orders.push(normalized);
      overallMonthMap.set(monthKey, overallEntry);

      if (isPublicSaleOrder(order)) {
        const publicEntry =
          publicMonthMap.get(monthKey) ?? { label: buildMonthLabel(monthKey), orders: [] };
        publicEntry.orders.push(normalized);
        publicMonthMap.set(monthKey, publicEntry);
      }
    });

    const ensureMonthEntry = (
      map: Map<string, { label: string; orders: NormalizedOrder[] }>,
      monthKey: string
    ) => {
      if (!map.has(monthKey)) {
        map.set(monthKey, { label: buildMonthLabel(monthKey), orders: [] });
      }
    };

    const currentMonthKey = new Date().toISOString().substring(0, 7);
    ensureMonthEntry(publicMonthMap, currentMonthKey);
    ensureMonthEntry(overallMonthMap, currentMonthKey);

    const buildHistory = (map: Map<string, { label: string; orders: NormalizedOrder[] }>) => {
      const sortedMonths = Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
      const limitedMonths = sortedMonths.slice(0, MAX_MONTHS);
      return limitedMonths.map(([month, entry]) => {
        const totalSales = entry.orders.reduce((sum, order) => sum + order.total, 0);
        const totalTips = entry.orders.reduce((sum, order) => sum + order.tipAmount, 0);
        const recentOrders = [...entry.orders]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 3);
        return {
          month,
          label: entry.label,
          totalSales: Number(totalSales.toFixed(2)),
          totalTips: Number(totalTips.toFixed(2)),
          orderCount: entry.orders.length,
          recentOrders,
          orders: entry.orders,
        };
      });
    };

    const publicHistory = buildHistory(publicMonthMap);
    const overallHistory = buildHistory(overallMonthMap);

    if (requestedFormat && requestedMonth) {
      const target = [...publicHistory, ...overallHistory].find(
        (entry) => entry.month === requestedMonth
      );
      if (!target) {
        return NextResponse.json(
          { success: false, error: 'No hay información para ese mes' },
          { status: 404 }
        );
      }

      if (requestedFormat === 'csv') {
        const csv = buildCsv(requestedMonth, target.orders);
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="public-sales-${requestedMonth}.csv"`,
          },
        });
      }

      if (requestedFormat === 'excel') {
        const html = buildExcelHtml(target.orders);
        return new Response(html, {
          headers: {
            'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
            'Content-Disposition': `attachment; filename="public-sales-${requestedMonth}.xls"`,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        publicHistory: publicHistory.map(({ orders, ...rest }) => rest),
        overallHistory: overallHistory.map(({ orders, ...rest }) => rest),
      },
    });
  } catch (error) {
    console.error('Error in public-sales-summary:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos generar el resumen del público general' },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-dynamic';
