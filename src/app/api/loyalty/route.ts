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
import { withDecryptedUserNames, type RawUserRecord } from '@/lib/customer-decrypt';

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const ORDERS_TABLE = process.env.SUPABASE_ORDERS_TABLE ?? 'orders';
const RESERVATIONS_TABLE = process.env.SUPABASE_RESERVATIONS_TABLE ?? 'reservations';

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
    let users: Array<
      RawUserRecord & {
        favoriteColdDrink?: string | null;
        favoriteHotDrink?: string | null;
        favoriteFood?: string | null;
        weeklyCoffeeCount?: number | null;
        rewardEarned?: boolean | null;
      }
    > = [];

    const loadUsersWithFallback = async (
      includeRewardEarned: boolean
    ): Promise<typeof users> => {
      if (!userIds.length) {
        return [];
      }
      const baseFields = [
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
      ];
      if (includeRewardEarned) {
        baseFields.push('"rewardEarned"');
      }
      const { data, error } = await supabaseAdmin
        .from(USERS_TABLE)
        .select(baseFields.join(','))
        .in('id', userIds);

      if (error) {
        const message = (error.message ?? '').toLowerCase();
        if (
          includeRewardEarned &&
          (error.code === '42703' || message.includes('rewardearned'))
        ) {
          console.warn(
            'users.rewardEarned column missing in Supabase; continuing without reward flag.'
          );
          return loadUsersWithFallback(false);
        }
        throw error;
      }

      return Array.isArray(data) ? (data as unknown as typeof users) : [];
    };

    if (userIds.length) {
      try {
        users = await loadUsersWithFallback(true);
      } catch (error) {
        const message =
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: string }).message ?? '')
            : '';
        const code = (error as { code?: string | number }).code;
        if (
          (typeof code === 'string' && code === '42703') ||
          message.toLowerCase().includes('rewardearned')
        ) {
          console.warn(
            'users.rewardEarned column unavailable in Supabase; retrying without reward flag.'
          );
          users = await loadUsersWithFallback(false);
        } else {
          console.error('Error fetching users for loyalty stats:', error);
          users = [];
        }
      }
    }

    const userMap = new Map(
      users.map((user) => {
        const decrypted = withDecryptedUserNames(user as RawUserRecord);
        return [user.id, decrypted ?? user];
      })
    );

    const customers = Array.from(statsMap.values())
      .map((record) => {
        const user = userMap.get(record.userId);
        const favoriteBeverage =
          user?.favoriteColdDrink ?? user?.favoriteHotDrink ?? null;
        const loyaltyCount = Math.max(0, Number(user?.weeklyCoffeeCount ?? 0));
        const rewardEarned = Boolean(user?.rewardEarned);

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
          firstName: (user as RawUserRecord & { firstName?: string | null })?.firstName ?? null,
          lastName: (user as RawUserRecord & { lastName?: string | null })?.lastName ?? null,
          firstNameEncrypted: user?.firstNameEncrypted || null,
          lastNameEncrypted: user?.lastNameEncrypted || null,
          favoriteColdDrink: user?.favoriteColdDrink ?? null,
          favoriteHotDrink: user?.favoriteHotDrink ?? null,
          loyaltyCoffees: loyaltyCount,
          weeklyCoffeeCount: loyaltyCount,
          rewardEarned,
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
