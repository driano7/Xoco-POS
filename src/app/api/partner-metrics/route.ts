import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const PAYMENTS_TABLE = process.env.SUPABASE_PAYMENTS_TABLE ?? 'payments';
const CUSTOMER_METRICS_VIEW =
  process.env.SUPABASE_CUSTOMER_METRICS_VIEW ?? 'v_customer_last_month';
const REPORTS_TABLE = process.env.SUPABASE_REPORTS_TABLE ?? 'report_requests';

const DAYS = Number(process.env.PARTNER_METRICS_DAYS ?? 30);

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET() {
  try {
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: orders, error: ordersError },
      { data: payments, error: paymentsError },
      { data: customerView, error: viewError },
      { data: reports, error: reportsError },
    ] = await Promise.all([
      supabaseAdmin
        .from(ORDERS_TABLE)
        .select('id,total,status,"createdAt"')
        .gte('createdAt', since),
      supabaseAdmin
        .from(PAYMENTS_TABLE)
        .select('id,amount,"tipAmount",status,"createdAt"')
        .gte('createdAt', since),
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

    return NextResponse.json({
      success: true,
      data: {
        metrics,
        loyalty,
        reports: reports ?? [],
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
