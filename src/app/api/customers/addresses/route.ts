/*
 * --------------------------------------------------------------------
 *  Xoco POS — Customer addresses lookup endpoint
 * --------------------------------------------------------------------
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { withDecryptedUserNames, type RawUserRecord } from '@/lib/customer-decrypt';
import { decryptAddressRow } from '@/lib/address-decrypt';

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';
const ADDRESSES_TABLE = process.env.SUPABASE_ADDRESSES_TABLE ?? 'addresses';

type GenericStringError = {
  error: true;
} & String;

const normalizeString = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
};

const isGenericError = (value: unknown): value is GenericStringError =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'error' in (value as Record<string, unknown>)
  );

const isRawUserRecord = (value: unknown): value is RawUserRecord =>
  Boolean(value && typeof value === 'object');

const getStringField = (record: RawUserRecord | null, field: string): string | null => {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const rawValue = (record as Record<string, unknown>)[field];
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    return trimmed || null;
  }
  return null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userIdParam = normalizeString(searchParams.get('userId'));
  const clientIdParam = normalizeString(searchParams.get('clientId'));

  if (!userIdParam && !clientIdParam) {
    return NextResponse.json(
      { success: false, error: 'Proporciona el userId o el clientId del cliente.' },
      { status: 400 }
    );
  }

  try {
    let targetUserId = userIdParam;
    let targetEmail: string | null = null;

    if (!targetUserId) {
      const { data: userRecord, error: userError } = await supabaseAdmin
        .from(USERS_TABLE)
        .select(
          [
            'id',
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
            'email',
          ].join(',')
        )
        .or(`"clientId".eq.${clientIdParam},id.eq.${clientIdParam}`)
        .maybeSingle();

      if (userError) {
        throw new Error(userError.message);
      }
      if (!userRecord || isGenericError(userRecord) || !isRawUserRecord(userRecord)) {
        return NextResponse.json(
          { success: false, error: 'No encontramos a ese cliente.' },
          { status: 404 }
        );
      }

      const baseUser = userRecord as NonNullable<RawUserRecord>;
      const hydratedUser = (withDecryptedUserNames(baseUser) ?? baseUser) as RawUserRecord | null;
      targetUserId = getStringField(hydratedUser ?? baseUser, 'id');
      targetEmail = getStringField(hydratedUser ?? baseUser, 'email');
    }

    if (!targetUserId) {
      return NextResponse.json(
        { success: false, error: 'No contamos con el userId del cliente solicitado.' },
        { status: 404 }
      );
    }

    if (!targetEmail) {
      const { data: userRecord, error: fetchError } = await supabaseAdmin
        .from(USERS_TABLE)
        .select('email')
        .eq('id', targetUserId)
        .maybeSingle();
      if (fetchError) {
        throw new Error(fetchError.message);
      }
      targetEmail = typeof userRecord?.email === 'string' ? userRecord.email : null;
    }

    const { data: addressRows, error: addressesError } = await supabaseAdmin
      .from(ADDRESSES_TABLE)
      .select(
        'id,"userId",label,nickname,type,payload,payload_iv,payload_tag,payload_salt,street,city,state,"postalCode",country,reference,"isDefault"'
      )
      .eq('"userId"', targetUserId)
      .order('createdAt', { ascending: false });

    if (addressesError) {
      throw new Error(addressesError.message);
    }

    const addresses =
      addressRows
        ?.map((row) => decryptAddressRow(row, targetEmail))
        .filter((payload): payload is NonNullable<typeof payload> => Boolean(payload)) ?? [];

    return NextResponse.json({
      success: true,
      data: addresses.map((address) => ({
        id: address.id,
        label: address.label ?? address.nickname ?? 'Dirección',
        nickname: address.nickname ?? address.label ?? null,
        type: address.type ?? 'shipping',
        street: address.street ?? '',
        city: address.city ?? '',
        state: address.state ?? '',
        postalCode: address.postalCode ?? '',
        country: address.country ?? '',
        reference: address.reference ?? '',
        contactPhone: address.contactPhone ?? '',
        isWhatsapp: address.isWhatsapp ?? false,
        isDefault: Boolean(address.isDefault),
      })),
    });
  } catch (error) {
    console.error('Error consultando direcciones del cliente:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'No pudimos recuperar las direcciones del cliente.',
      },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
