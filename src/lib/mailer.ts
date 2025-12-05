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

import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE =
  process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1' || SMTP_PORT === 465;
const SMTP_FROM = process.env.SMTP_FROM ?? `Xoco Café <${SMTP_USER ?? 'noreply@xoco.cafe'}>`;

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

const assertMailerConfig = () => {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP configuration is incomplete. Define SMTP_HOST/PORT/USER/PASS.');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
};

if (process.env.NODE_ENV === 'production') {
  try {
    assertMailerConfig();
  } catch (error) {
    console.error('SMTP configuration error:', error);
  }
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
  expiresMinutes,
  requester,
}: {
  to: string;
  resetUrl: string;
  expiresMinutes: number;
  requester?: string | null;
}) {
  const mailer = assertMailerConfig();

  const plainText =
    `Hola,\n\n` +
    `Si solicitaste cambiar tu contraseña del POS, abre este enlace: ${resetUrl}\n\n` +
    `Expira en ${expiresMinutes} minutos. Si no fuiste tú, ignora este correo.\n\n` +
    (requester ? `Solicitud registrada desde: ${requester}\n\n` : '') +
    `– Equipo Xoco Café`;

  const headers: Record<string, string> = {
    'X-Mailin-Template': '2',
    'X-Mailin-Parameters': JSON.stringify({
      resetUrl,
      expiresMinutes,
      requester,
    }),
  };

  await mailer.sendMail({
    to,
    from: SMTP_FROM,
    subject: 'Restablece tu contraseña | Xoco Café POS',
    headers,
    text: plainText,
  });
}
