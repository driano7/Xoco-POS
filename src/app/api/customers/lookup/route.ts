import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { type RawUserRecord, withDecryptedUserNames } from '@/lib/customer-decrypt';

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';

type GenericStringError = {
  error: true;
} & String;

const isGenericStringError = (value: unknown): value is GenericStringError =>
  typeof value === 'object' && value !== null && 'error' in value;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId')?.trim();
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Debes proporcionar un ID de cliente.' }, { status: 400 });
  }

  try {
    const selectFields = [
      'id',
      '"clientId"',
      'email',
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
    ].join(',');

    const { data, error } = await supabaseAdmin
      .from(USERS_TABLE)
      .select(selectFields)
      .or(`"clientId".eq.${clientId},id.eq.${clientId}`)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data || isGenericStringError(data)) {
      return NextResponse.json({ success: false, error: 'No encontramos un cliente con ese ID.' }, { status: 404 });
    }

    const rawUser = data as NonNullable<RawUserRecord>;
    const hydrated = withDecryptedUserNames(rawUser) ?? rawUser;

    return NextResponse.json({
      success: true,
      data: {
        id: hydrated.id ?? null,
        clientId: hydrated.clientId ?? null,
        email: hydrated.email ?? null,
        firstName: hydrated.firstName ?? null,
        lastName: hydrated.lastName ?? null,
        phone: hydrated.phone ?? null,
      },
    });
  } catch (err) {
    console.error('Customer lookup error:', err);
    const message = err instanceof Error ? err.message : 'Error desconocido al buscar al cliente.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
