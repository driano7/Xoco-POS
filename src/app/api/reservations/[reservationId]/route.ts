import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { withDecryptedUserNames, type RawUserRecord } from '@/lib/customer-decrypt';

const RESERVATIONS_TABLE = process.env.SUPABASE_RESERVATIONS_TABLE ?? 'reservations';
const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';

const SELECT_COLUMNS = [
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
].join(',');

const normalizeReservationRecord = (reservation: Record<string, unknown>) => {
  const { user, ...rest } = reservation as { user?: RawUserRecord | null };
  return {
    ...(rest as Record<string, unknown>),
    user: withDecryptedUserNames(user ?? null),
  };
};

const fetchReservationById = async (value: string) => {
  const { data, error } = await supabaseAdmin
    .from(RESERVATIONS_TABLE)
    .select(SELECT_COLUMNS)
    .eq('id', value)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw new Error(error.message);
  }

  return data ?? null;
};

const fetchReservationByCode = async (value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const pattern = normalized.replace(/[%_]/g, '\\$&');
  const { data, error } = await supabaseAdmin
    .from(RESERVATIONS_TABLE)
    .select(SELECT_COLUMNS)
    .ilike('reservationCode', pattern)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw new Error(error.message);
  }

  return data ?? null;
};

export async function GET(_: Request, { params }: { params: { reservationId?: string } }) {
  const identifier = params.reservationId?.trim();
  if (!identifier) {
    return NextResponse.json(
      { success: false, error: 'Debes proporcionar un identificador de reservación.' },
      { status: 400 }
    );
  }

  try {
    let reservation = await fetchReservationById(identifier);
    if (!reservation) {
      reservation = await fetchReservationByCode(identifier);
    }
    if (!reservation) {
      reservation = await fetchReservationByCode(identifier.toUpperCase());
    }
    if (!reservation) {
      return NextResponse.json(
        { success: false, error: 'No encontramos la reservación buscada.' },
        { status: 404 }
      );
    }

    const normalized = normalizeReservationRecord(reservation as unknown as Record<string, unknown>) as {
      userId?: string | null;
      user?: RawUserRecord | null;
    };

    if (!normalized.user && normalized.userId) {
      const { data: fallbackUser } = await supabaseAdmin
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
        .eq('id', normalized.userId)
        .maybeSingle();
      if (fallbackUser && typeof fallbackUser === 'object') {
        normalized.user = withDecryptedUserNames(fallbackUser as RawUserRecord);
      }
    }

    return NextResponse.json({ success: true, data: normalized });
  } catch (error) {
    console.error('Error fetching reservation detail:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos recuperar la reservación solicitada.' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
