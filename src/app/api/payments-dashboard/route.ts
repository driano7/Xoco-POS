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

    const [
      { data: payments, error: paymentsError },
      { data: orders, error: ordersError },
      { data: reportRequests, error: reportsError },
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
    ]);

    if (paymentsError || ordersError || reportsError) {
      const message =
        paymentsError?.message ||
        ordersError?.message ||
        reportsError?.message ||
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

    return NextResponse.json({
      success: true,
      data: {
        totalAmount: Number(totalAmount.toFixed(2)),
        totalTips: Number(totalTips.toFixed(2)),
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
