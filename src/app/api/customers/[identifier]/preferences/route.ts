import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE ?? 'users';

type RouteParams = {
  params: {
    identifier: string;
  };
};

const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const loadUserByIdentifier = async (identifier: string) => {
  const byClientId = await supabaseAdmin
    .from(USERS_TABLE)
    .select('id,"clientId"')
    .eq('clientId', identifier)
    .maybeSingle();

  if (byClientId.data) {
    return byClientId.data;
  }

  if (byClientId.error && byClientId.error.code !== 'PGRST116') {
    throw new Error(byClientId.error.message);
  }

  const byId = await supabaseAdmin
    .from(USERS_TABLE)
    .select('id,"clientId"')
    .eq('id', identifier)
    .maybeSingle();

  if (byId.error && byId.error.code !== 'PGRST116') {
    throw new Error(byId.error.message);
  }

  return byId.data;
};

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const identifier = params.identifier?.trim();
  if (!identifier) {
    return NextResponse.json(
      { success: false, error: 'Debes proporcionar un identificador de cliente válido.' },
      { status: 400 }
    );
  }

  let payload: { beverage?: unknown; food?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'El cuerpo de la petición debe ser un JSON válido.' },
      { status: 400 }
    );
  }

  const shouldUpdateBeverage = Object.prototype.hasOwnProperty.call(payload, 'beverage');
  const shouldUpdateFood = Object.prototype.hasOwnProperty.call(payload, 'food');

  if (!shouldUpdateBeverage && !shouldUpdateFood) {
    return NextResponse.json(
      { success: false, error: 'No se proporcionaron cambios para guardar.' },
      { status: 400 }
    );
  }

  try {
    const userRecord = await loadUserByIdentifier(identifier);
    if (!userRecord) {
      return NextResponse.json(
        { success: false, error: 'No encontramos a la persona indicada.' },
        { status: 404 }
      );
    }

    const beverageValue = shouldUpdateBeverage ? normalizeOptionalString(payload.beverage) : undefined;
    const foodValue = shouldUpdateFood ? normalizeOptionalString(payload.food) : undefined;

    const updates: Record<string, string | null> = {};
    if (shouldUpdateBeverage) {
      updates.favoriteColdDrink = beverageValue ?? null;
      updates.favoriteHotDrink = beverageValue ?? null;
    }
    if (shouldUpdateFood) {
      updates.favoriteFood = foodValue ?? null;
    }

    if (!Object.keys(updates).length) {
      return NextResponse.json(
        { success: false, error: 'No se detectaron cambios válidos.' },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from(USERS_TABLE)
      .update(updates)
      .eq('id', userRecord.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({
      success: true,
      data: {
        beverage: beverageValue ?? null,
        food: foodValue ?? null,
      },
    });
  } catch (error) {
    console.error('Error actualizando preferencias del cliente:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos guardar las preferencias del cliente.' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
