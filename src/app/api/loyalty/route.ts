import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const RESERVATIONS_TABLE = process.env.SUPABASE_RESERVATIONS_TABLE ?? 'reservations';
const LOYALTY_PUNCHES_TABLE = process.env.SUPABASE_LOYALTY_PUNCHES_TABLE ?? 'loyalty_points';

const MAX_ROWS = Number(process.env.SUPABASE_STATS_LIMIT ?? 500);

const normalizeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET() {
  try {
    const [{ data: orders, error: ordersError }, { data: reservations, error: reservationsError }] =
      await Promise.all([
        supabaseAdmin
          .from(ORDERS_TABLE)
          .select('id,"userId",total,"createdAt"')
          .order('createdAt', { ascending: false })
          .limit(MAX_ROWS),
        supabaseAdmin
          .from(RESERVATIONS_TABLE)
          .select('id,"userId","reservationDate","reservationTime",status,"createdAt"')
          .order('createdAt', { ascending: false })
          .limit(MAX_ROWS),
      ]);

    if (ordersError || reservationsError) {
      const message = ordersError?.message || reservationsError?.message || 'Supabase query failed';
      throw new Error(message);
    }

    const statsMap = new Map<
      string,
      {
        userId: string;
        orders: number;
        reservations: number;
        totalSpent: number;
        lastActivity: string | null;
      }
    >();

    (orders ?? []).forEach((order) => {
      if (!order.userId) {
        return;
      }

      let record = statsMap.get(order.userId);
      if (!record) {
        record = {
          userId: order.userId,
          orders: 0,
          reservations: 0,
          totalSpent: 0,
          lastActivity: null,
        };
        statsMap.set(order.userId, record);
      }

      record.orders += 1;
      record.totalSpent += normalizeNumber(order.total);
      const createdAt = order.createdAt ? new Date(order.createdAt).toISOString() : null;
      if (!record.lastActivity || (createdAt && createdAt > record.lastActivity)) {
        record.lastActivity = createdAt;
      }

      statsMap.set(order.userId, record);
    });

    (reservations ?? []).forEach((reservation) => {
      if (!reservation.userId) {
        return;
      }

      let record = statsMap.get(reservation.userId);
      if (!record) {
        record = {
          userId: reservation.userId,
          orders: 0,
          reservations: 0,
          totalSpent: 0,
          lastActivity: null,
        };
        statsMap.set(reservation.userId, record);
      }

      record.reservations += 1;
      const timestamp =
        reservation.reservationDate && reservation.reservationTime
          ? `${reservation.reservationDate}T${reservation.reservationTime}`
          : reservation.createdAt;
      const parsedDate = timestamp ? new Date(timestamp).toISOString() : null;

      if (!record.lastActivity || (parsedDate && parsedDate > record.lastActivity)) {
        record.lastActivity = parsedDate;
      }

      statsMap.set(reservation.userId, record);
    });

    const userIds = Array.from(statsMap.keys());
    let users: Array<{
      id: string;
      email?: string | null;
      clientId?: string | null;
      city?: string | null;
      country?: string | null;
      lastActivityAt?: string | null;
      firstNameEncrypted?: string | null;
      lastNameEncrypted?: string | null;
    }> = [];

    let loyaltyPunches: Record<string, number> = {};

    if (userIds.length) {
      const { data, error } = await supabaseAdmin
        .from(USERS_TABLE)
        .select(
          'id,email,"clientId",city,country,"lastActivityAt","firstNameEncrypted","lastNameEncrypted"'
        )
        .in('id', userIds);

      if (error) {
        console.error('Error fetching users for loyalty stats:', error);
      } else if (data) {
        users = data;
      }

      const { data: punches, error: punchesError } = await supabaseAdmin
        .from(LOYALTY_PUNCHES_TABLE)
        .select('userId')
        .in('userId', userIds);

      if (punchesError) {
        console.error('Error fetching loyalty punches:', punchesError);
      } else if (punches) {
        loyaltyPunches = punches.reduce<Record<string, number>>((acc, punch) => {
          if (typeof punch.userId === 'string') {
            acc[punch.userId] = (acc[punch.userId] ?? 0) + 1;
          }
          return acc;
        }, {});
      }
    }

    const userMap = new Map(users.map((user) => [user.id, user]));

    const customers = Array.from(statsMap.values())
      .map((record) => {
        const user = userMap.get(record.userId);
        return {
          userId: record.userId,
          orders: record.orders,
          reservations: record.reservations,
          totalInteractions: record.orders + record.reservations,
          totalSpent: Number(record.totalSpent.toFixed(2)),
          lastActivity: record.lastActivity || user?.lastActivityAt || null,
          clientId: user?.clientId || null,
          email: user?.email || null,
          city: user?.city || null,
          country: user?.country || null,
          firstNameEncrypted: user?.firstNameEncrypted || null,
          lastNameEncrypted: user?.lastNameEncrypted || null,
          loyaltyCoffees: loyaltyPunches[record.userId] ?? 0,
        };
      })
      .sort((a, b) => {
        if (b.totalInteractions === a.totalInteractions) {
          return b.totalSpent - a.totalSpent;
        }
        return b.totalInteractions - a.totalInteractions;
      });

    return NextResponse.json({
      success: true,
      data: {
        topCustomer: customers[0] || null,
        customers,
      },
    });
  } catch (error) {
    console.error('Error generating loyalty stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to calculate loyalty metrics' },
      { status: 500 }
    );
  }
}
