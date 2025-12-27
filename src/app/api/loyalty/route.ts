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

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const RESERVATIONS_TABLE = process.env.SUPABASE_RESERVATIONS_TABLE ?? 'reservations';
const LOYALTY_PUNCHES_TABLE = process.env.SUPABASE_LOYALTY_PUNCHES_TABLE ?? 'loyalty_points';

const MAX_ROWS = Number(process.env.SUPABASE_STATS_LIMIT ?? 500);

const normalizeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getWeekBounds = () => {
  const now = new Date();
  const day = now.getDay(); // 0 (Sun) - 6 (Sat)
  const diff = day === 0 ? 6 : day - 1; // start week on Monday
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
};

const parsePunchDate = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  // Support YYYY-MM-DD as well as full ISO timestamps.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yearStr, monthStr, dayStr] = trimmed.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }
    return new Date(year, month - 1, day);
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
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
      favoriteColdDrink?: string | null;
      favoriteHotDrink?: string | null;
      favoriteFood?: string | null;
      weeklyCoffeeCount?: number | null;
    }> = [];

    let loyaltyPunches: Record<string, number> = {};

    if (userIds.length) {
      const { data, error } = await supabaseAdmin
        .from(USERS_TABLE)
        .select(
          [
            'id',
            'email',
            '"clientId"',
            'city',
            'country',
            '"lastActivityAt"',
            '"firstNameEncrypted"',
            '"lastNameEncrypted"',
            '"favoriteColdDrink"',
            '"favoriteHotDrink"',
            '"favoriteFood"',
            '"weeklyCoffeeCount"',
          ].join(',')
        )
        .in('id', userIds);

      if (error) {
        console.error('Error fetching users for loyalty stats:', error);
      } else if (Array.isArray(data)) {
        users = data as unknown as typeof users;
      }

      const { data: punches, error: punchesError } = await supabaseAdmin
        .from(LOYALTY_PUNCHES_TABLE)
        .select('"userId","createdAt",points')
        .in('userId', userIds);

      if (punchesError) {
        console.error('Error fetching loyalty punches:', punchesError);
      } else if (punches) {
        const { start, end } = getWeekBounds();
        loyaltyPunches = punches.reduce<Record<string, number>>((acc, punch) => {
          if (typeof punch.userId !== 'string') {
            return acc;
          }
          const punchTimestamp = parsePunchDate((punch as { createdAt?: string | null }).createdAt ?? null);
          if (punchTimestamp && punchTimestamp >= start && punchTimestamp < end) {
            const pointsValue =
              typeof (punch as { points?: number }).points === 'number'
                ? Number((punch as { points?: number }).points)
                : 1;
            acc[punch.userId] = (acc[punch.userId] ?? 0) + Math.max(1, pointsValue);
          }
          return acc;
        }, {});
      }
    }

    const userMap = new Map(users.map((user) => [user.id, user]));

    const customers = Array.from(statsMap.values())
      .map((record) => {
        const user = userMap.get(record.userId);
        const favoriteBeverage = user?.favoriteColdDrink ?? user?.favoriteHotDrink ?? null;
        const fallbackWeeklyCount = Math.max(0, Number(user?.weeklyCoffeeCount ?? 0));
        const loyaltyCount = Math.max(fallbackWeeklyCount, loyaltyPunches[record.userId] ?? 0);

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
          loyaltyCoffees: loyaltyCount,
          favoriteBeverage,
          favoriteFood: user?.favoriteFood ?? null,
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
export const dynamic = 'force-dynamic';
