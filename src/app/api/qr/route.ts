import { NextRequest, NextResponse } from 'next/server';

const REMOTE_QR_API = 'https://api.qrserver.com/v1/create-qr-code/';
const DEFAULT_SIZE = '220x220';

const isValidSize = (value: string | null) => {
  if (!value) return false;
  return /^[0-9]{1,4}x[0-9]{1,4}$/.test(value);
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const data = searchParams.get('data');
  if (!data) {
    return NextResponse.json(
      { success: false, message: 'Parámetro "data" es requerido.' },
      { status: 400 }
    );
  }
  const size = isValidSize(searchParams.get('size')) ? searchParams.get('size')! : DEFAULT_SIZE;
  const upstreamUrl = `${REMOTE_QR_API}?size=${size}&data=${encodeURIComponent(data)}`;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl);
  } catch (error) {
    console.error('Error solicitando QR al servicio externo:', error);
    return NextResponse.json(
      { success: false, message: 'No pudimos generar el código QR.' },
      { status: 502 }
    );
  }

  if (!upstreamResponse.ok) {
    return NextResponse.json(
      { success: false, message: 'El servicio externo no pudo generar el QR.' },
      { status: 502 }
    );
  }

  const buffer = await upstreamResponse.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': upstreamResponse.headers.get('Content-Type') ?? 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
