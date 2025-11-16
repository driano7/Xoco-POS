import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const POS_SETTINGS_TABLE = process.env.SUPABASE_POS_SETTINGS_TABLE ?? 'pos_settings';
const DEFAULT_SETTINGS = {
  app: 'POS Xoco',
  store: 'Sucursal Matriz',
  address_one: '',
  address_two: '',
  contact: '',
  tax: 0,
  symbol: 'MXN',
  percentage: 0,
  charge_tax: false,
  footer: '',
  img: null as string | null,
  updatedAt: null as string | null,
};

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from(POS_SETTINGS_TABLE)
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      data: data ?? DEFAULT_SETTINGS,
    });
  } catch (error) {
    console.error('Error fetching POS settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch POS settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const payload = {
      id: body.id || 'pos_default',
      app: body.app,
      store: body.store,
      address_one: body.address_one,
      address_two: body.address_two,
      contact: body.contact,
      tax: body.tax,
      symbol: body.symbol,
      percentage: body.percentage,
      charge_tax: body.charge_tax,
      footer: body.footer,
      img: body.img,
      updatedAt: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from(POS_SETTINGS_TABLE)
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error updating POS settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update POS settings' },
      { status: 500 }
    );
  }
}
