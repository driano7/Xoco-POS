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

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sendReservationCreatedEmail } from '@/lib/mailer';

const ReservationNotificationSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional().nullable(),
  reservationCode: z.string().min(3),
  reservationDate: z.string().min(4),
  reservationTime: z.string().regex(/^\d{2}:\d{2}$/),
  peopleCount: z.number().int().positive(),
  branchLabel: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  preOrderItems: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const apiKey = process.env.NOTIFY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, message: 'NOTIFY_API_KEY no configurado en el servidor' },
      { status: 500 }
    );
  }

  const providedKey = request.headers.get('x-xoco-notify-key');
  if (!providedKey || providedKey !== apiKey) {
    return NextResponse.json({ success: false, message: 'Acceso no autorizado' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const payload = ReservationNotificationSchema.parse(body);

    await sendReservationCreatedEmail({
      to: payload.email,
      displayName: payload.displayName ?? undefined,
      reservationCode: payload.reservationCode,
      reservationDate: payload.reservationDate,
      reservationTime: payload.reservationTime,
      peopleCount: payload.peopleCount,
      branchLabel: payload.branchLabel ?? undefined,
      message: payload.message ?? undefined,
      preOrderItems: payload.preOrderItems ?? undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: 'Datos inválidos', errors: error.issues },
        { status: 400 }
      );
    }
    console.error('Error enviando correo de reservación creada:', error);
    return NextResponse.json(
      { success: false, message: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
