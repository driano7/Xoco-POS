import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const PAYMENTS_TABLE = process.env.SUPABASE_PAYMENTS_TABLE ?? 'payments';
const CUSTOMER_METRICS_VIEW =
  process.env.SUPABASE_CUSTOMER_METRICS_VIEW ?? 'v_customer_last_month';
const REPORTS_TABLE = process.env.SUPABASE_REPORTS_TABLE ?? 'report_requests';

const DEFAULT_DAYS = Number(process.env.PARTNER_METRICS_DAYS ?? 30);
const VIP_SPENT_THRESHOLD = Number(process.env.PARTNER_VIP_THRESHOLD ?? 1200);
const MAX_MONTH_HISTORY = 18;

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getDateKey = (value?: string | null) => {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed?.getTime?.()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
};

type DailyTotals = { sales: number; orders: number; tips: number };

const ensureBucket = (collection: Map<string, DailyTotals>, key: string) => {
  if (!collection.has(key)) {
    collection.set(key, { sales: 0, orders: 0, tips: 0 });
  }
  return collection.get(key)!;
};

const buildMonthLabel = (monthKey: string) => {
  const base = new Date(`${monthKey}-01T00:00:00Z`);
  return base.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
};

const resolveMonthRange = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) {
    throw new Error('Mes inválido');
  }
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
};

const collectAvailableMonths = async () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const earliest = new Date(now);
  earliest.setMonth(earliest.getMonth() - (MAX_MONTH_HISTORY - 1));
  earliest.setDate(1);
  const { data, error } = await supabaseAdmin
    .from(ORDERS_TABLE)
    .select('"createdAt"')
    .gte('createdAt', earliest.toISOString());
  if (error) {
    console.warn('Partner metrics months query failed:', error.message);
    return [];
  }
  const months = new Set<string>();
  (data ?? []).forEach((row) => {
    const createdAt = row?.createdAt;
    if (typeof createdAt === 'string' && createdAt.length >= 7) {
      months.add(createdAt.substring(0, 7));
    }
  });
  const currentMonth = new Date().toISOString().substring(0, 7);
  months.add(currentMonth);
  return Array.from(months)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, MAX_MONTH_HISTORY)
    .map((month) => ({ month, label: buildMonthLabel(month) }));
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedDays = Number(searchParams.get('days'));
    const requestedMonth = searchParams.get('month')?.substring(0, 7) ?? null;
    const availableMonths = await collectAvailableMonths();
    const validMonth =
      requestedMonth && availableMonths.some((entry) => entry.month === requestedMonth)
        ? requestedMonth
        : null;
    const useMonthMode = Boolean(validMonth);

    const daysWindow =
      Number.isFinite(requestedDays) && requestedDays > 0 ? Math.min(requestedDays, 360) : DEFAULT_DAYS;

    let sinceIso: string;
    let untilIso: string | null = null;
    if (useMonthMode && validMonth) {
      const { start, end } = resolveMonthRange(validMonth);
      sinceIso = start.toISOString();
      untilIso = end.toISOString();
    } else {
      sinceIso = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000).toISOString();
      untilIso = null;
    }

    let ordersQuery = supabaseAdmin
      .from(ORDERS_TABLE)
      .select('id,total,status,"createdAt"')
      .gte('createdAt', sinceIso);
    if (untilIso) {
      ordersQuery = ordersQuery.lt('createdAt', untilIso);
    }

    let paymentsQuery = supabaseAdmin
      .from(PAYMENTS_TABLE)
      .select('id,amount,"tipAmount",status,"createdAt",method')
      .gte('createdAt', sinceIso);
    if (untilIso) {
      paymentsQuery = paymentsQuery.lt('createdAt', untilIso);
    }

    const [
      { data: orders, error: ordersError },
      { data: payments, error: paymentsError },
      { data: customerView, error: viewError },
      { data: reports, error: reportsError },
    ] = await Promise.all([
      ordersQuery,
      paymentsQuery,
      supabaseAdmin.from(CUSTOMER_METRICS_VIEW).select('clientId,orders,spent,items'),
      supabaseAdmin
        .from(REPORTS_TABLE)
        .select('id,scope,status,"createdAt","resultUrl"')
        .order('createdAt', { ascending: false })
        .limit(10),
    ]);

    if (ordersError || paymentsError || viewError || reportsError) {
      const message =
        ordersError?.message ||
        paymentsError?.message ||
        viewError?.message ||
        reportsError?.message ||
        'Supabase query failed';
      throw new Error(message);
    }

    const orderCount = orders?.length || 0;
    const salesTotal = (orders ?? []).reduce((sum, order) => sum + toNumber(order.total), 0);
    const avgTicket = orderCount ? salesTotal / orderCount : 0;
    const completedOrders = (orders ?? []).filter((order) => order.status === 'completed').length;

    const paymentsTotal = (payments ?? []).reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    const tipsTotal = (payments ?? []).reduce((sum, payment) => sum + toNumber(payment.tipAmount), 0);

    const loyalty = {
      customersTracked: customerView?.length || 0,
      totalOrders: customerView?.reduce((sum, entry) => sum + (entry.orders || 0), 0) || 0,
      totalSpent: customerView?.reduce((sum, entry) => sum + toNumber(entry.spent), 0) || 0,
      topCustomers: (customerView ?? [])
        .slice()
        .sort((a, b) => toNumber(b.spent) - toNumber(a.spent))
        .slice(0, 5),
    };

    const metrics = {
      salesTotal: Number(salesTotal.toFixed(2)),
      paymentsTotal: Number(paymentsTotal.toFixed(2)),
      avgTicket: Number(avgTicket.toFixed(2)),
      completedOrders,
      tipsTotal: Number(tipsTotal.toFixed(2)),
    };

    const dailyCollection = new Map<string, DailyTotals>();
    const orderStatusMap = new Map<string, number>();

    (orders ?? []).forEach((order) => {
      const bucket = ensureBucket(dailyCollection, getDateKey(order.createdAt));
      bucket.sales += toNumber(order.total);
      bucket.orders += 1;

      const statusKey = (order.status ?? 'desconocido').toLowerCase();
      orderStatusMap.set(statusKey, (orderStatusMap.get(statusKey) ?? 0) + 1);
    });

    const paymentMethodMap = new Map<string, number>();

    (payments ?? []).forEach((payment) => {
      const bucket = ensureBucket(dailyCollection, getDateKey(payment.createdAt));
      bucket.tips += toNumber(payment.tipAmount);

      const methodKey = (payment.method ?? 'otro').toLowerCase();
      paymentMethodMap.set(methodKey, (paymentMethodMap.get(methodKey) ?? 0) + toNumber(payment.amount));
    });

    const dailySales = Array.from(dailyCollection.entries())
      .map(([date, totals]) => ({
        date,
        sales: Number(totals.sales.toFixed(2)),
        orders: totals.orders,
        tips: Number(totals.tips.toFixed(2)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const paymentMethodsRaw = Array.from(paymentMethodMap.entries()).map(([method, amount]) => ({
      method,
      amount: Number(amount.toFixed(2)),
    }));

    const paymentVolume = paymentMethodsRaw.reduce((sum, entry) => sum + entry.amount, 0);
    const paymentMethods = paymentMethodsRaw.map((entry) => ({
      ...entry,
      percent: paymentVolume ? Number((entry.amount / paymentVolume).toFixed(4)) : 0,
    }));

    const orderStatus = Array.from(orderStatusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    const newCustomers =
      customerView?.filter((entry) => (entry.orders ?? 0) <= 1).length ?? 0;
    const returningCustomers = (customerView?.length ?? 0) - newCustomers;
    const vipCustomers = customerView
      ? customerView.filter((entry) => toNumber(entry.spent) >= VIP_SPENT_THRESHOLD).length
      : 0;

    const tipPerformance = {
      totalTips: Number(tipsTotal.toFixed(2)),
      avgTip: payments && payments.length ? Number((tipsTotal / payments.length).toFixed(2)) : 0,
      tipRate: paymentsTotal ? Number((tipsTotal / paymentsTotal).toFixed(4)) : 0,
    };

    const advanced = {
      dailySales,
      paymentMethods,
      orderStatus,
      customerSegments: {
        newCustomers,
        returningCustomers: Math.max(0, returningCustomers),
        vipCustomers,
      },
      tipPerformance,
    };

    return NextResponse.json({
      success: true,
      data: {
        metrics,
        loyalty,
        reports: reports ?? [],
        advanced,
        availableMonths,
        selectedMonth: validMonth,
      },
    });
  } catch (error) {
    console.error('Error fetching partner metrics:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch partner metrics' },
      { status: 500 }
    );
  }
}
