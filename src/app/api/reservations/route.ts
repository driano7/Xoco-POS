import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { type RawUserRecord, withDecryptedUserNames } from '@/lib/customer-decrypt';

const RESERVATIONS_TABLE = process.env.SUPABASE_RESERVATIONS_TABLE ?? 'reservations';
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const MAX_RESULTS = Number(process.env.RESERVATIONS_LIMIT ?? 100);

type ReservationWithUser = Record<string, unknown> & {
  userId?: string | null;
  user?: ReturnType<typeof withDecryptedUserNames>;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = supabaseAdmin
      .from(RESERVATIONS_TABLE)
      .select(
        [
          'id',
          '"reservationCode"',
          '"userId"',
          '"peopleCount"',
          '"reservationDate"',
          '"reservationTime"',
          '"branchId"',
          '"branchNumber"',
          'message',
          '"preOrderItems"',
          'status',
          '"createdAt"',
          '"updatedAt"',
          [
            'user:users(',
            [
              '"firstNameEncrypted"',
              '"firstNameIv"',
              '"firstNameTag"',
              '"firstNameSalt"',
              '"lastNameEncrypted"',
              '"lastNameIv"',
              '"lastNameTag"',
              '"lastNameSalt"',
              '"phoneEncrypted"',
              '"phoneIv"',
              '"phoneTag"',
              '"phoneSalt"',
              '"clientId"',
              '"email"',
            ].join(','),
            ')',
          ].join(''),
        ].join(',')
      )
      .order('reservationDate', { ascending: false })
      .order('reservationTime', { ascending: false })
      .limit(MAX_RESULTS);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    const reservationRows = (
      Array.isArray(data) ? data.filter((row) => !!row && typeof row === 'object' && !('error' in row)) : []
    ) as Array<Record<string, unknown> & { user?: Record<string, unknown> | null }>;

    let normalized = reservationRows.map((reservation) => {
      const { user, ...rest } = reservation;
      return {
        ...(rest as Record<string, unknown>),
        user: withDecryptedUserNames((user as RawUserRecord) ?? null),
      };
    }) as ReservationWithUser[];

    const missingUserIds = Array.from(
      new Set(
        normalized
          .filter((reservation) => reservation.userId && !reservation.user)
          .map((reservation) => String(reservation.userId))
      )
    );

    if (missingUserIds.length) {
      const { data: fallbackUsers, error: fallbackError } = await supabaseAdmin
        .from(USERS_TABLE)
        .select(
          [
            '"id"',
            '"email"',
            '"clientId"',
            '"firstNameEncrypted"',
            '"firstNameIv"',
            '"firstNameTag"',
            '"firstNameSalt"',
            '"lastNameEncrypted"',
            '"lastNameIv"',
            '"lastNameTag"',
            '"lastNameSalt"',
            '"phoneEncrypted"',
            '"phoneIv"',
            '"phoneTag"',
            '"phoneSalt"',
          ].join(',')
        )
        .in('id', missingUserIds);

      if (fallbackError) {
        console.error('Error fetching reservation users:', fallbackError);
      } else if (fallbackUsers?.length) {
        const fallbackMap = new Map<string, NonNullable<ReturnType<typeof withDecryptedUserNames>>>();
        fallbackUsers.forEach((user) => {
          if (!user || typeof user !== 'object' || 'error' in user) {
            return;
          }
          const castUser = user as Record<string, unknown> & { id?: string };
          if (!castUser.id) {
            return;
          }
          const normalizedUser = withDecryptedUserNames(castUser as RawUserRecord);
          if (normalizedUser) {
            fallbackMap.set(String(castUser.id), normalizedUser);
          }
        });

        if (fallbackMap.size) {
          normalized = normalized.map((reservation) => {
            if (!reservation.user && reservation.userId) {
              const fallbackUser = fallbackMap.get(String(reservation.userId));
              return {
                ...reservation,
                user: fallbackUser ?? null,
              };
            }
            return reservation;
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: normalized,
    });
  } catch (error) {
    console.error('Error fetching reservations:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch reservations' },
      { status: 500 }
    );
  }
}
