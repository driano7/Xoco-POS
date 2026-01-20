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

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpSecure =
  String(process.env.SMTP_SECURE ?? '').toLowerCase() === 'true' ||
  String(process.env.SMTP_SECURE ?? '').toLowerCase() === '1' ||
  smtpPort === 465;

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

const resolveTransporter = () => {
  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error('SMTP configuration is incomplete. Define SMTP_HOST/USER/PASS.');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }
  return transporter;
};

const defaultFrom =
  process.env.SMTP_FROM || (smtpUser ? `Xoco Café <${smtpUser}>` : 'Xoco Café <noreply@xoco.cafe>');

type EmailResult = { success: boolean; message?: string };

interface BaseEmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  templateId?: number | null;
  templateParams?: Record<string, unknown>;
  headers?: Record<string, string>;
  replyTo?: string;
}

const deliverTransactionalEmail = async ({
  to,
  subject,
  html,
  text,
  templateId,
  templateParams,
  headers,
  replyTo,
}: BaseEmailPayload): Promise<EmailResult> => {
  try {
    const mailer = resolveTransporter();
    const composedHeaders: Record<string, string> = { ...(headers ?? {}) };
    if (templateId && Number.isFinite(templateId)) {
      composedHeaders['X-SIB-Template-ID'] = String(templateId);
      if (templateParams) {
        composedHeaders['X-SIB-Template-Parameters'] = JSON.stringify(templateParams);
      }
    }
    await mailer.sendMail({
      from: defaultFrom,
      to,
      subject,
      html,
      text,
      headers: composedHeaders,
      replyTo,
    });
    return { success: true };
  } catch (error) {
    console.error('Error delivering transactional email:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Email transport not configured',
    };
  }
};

const formatCurrency = (value?: number | null, currency: string = 'MXN') => {
  if (typeof value !== 'number') {
    return null;
  }
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};

const friendlyName = (value?: string | null) => (value?.trim() ? value.trim() : 'Amigo Xoco');

interface PasswordResetCodePayload {
  to: string;
  code: string;
  expiresAt: string;
  requestId: string;
  displayName?: string | null;
}

interface PasswordResetLinkPayload {
  to: string;
  resetUrl: string;
  expiresMinutes: number;
  requester?: string | null;
}

type PasswordResetEmailInput = PasswordResetCodePayload | PasswordResetLinkPayload;

const isCodePayload = (payload: PasswordResetEmailInput): payload is PasswordResetCodePayload =>
  Object.prototype.hasOwnProperty.call(payload, 'code');

export async function sendPasswordResetEmail(payload: PasswordResetEmailInput) {
  if (isCodePayload(payload)) {
    const expirationDate = new Date(payload.expiresAt);
    const formattedExpiration = expirationDate.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const name = friendlyName(payload.displayName);
    const subject = 'Recupera tu acceso a Xoco Café';
    const htmlBody = `
      <p>Hola ${name},</p>
      <p>
        Recibimos una solicitud para restablecer tu contraseña. Ingresa el siguiente código en la app
        durante los próximos minutos.
      </p>
      <p style="font-size:32px;font-weight:700;letter-spacing:0.3rem;text-align:center;margin:16px 0;">${payload.code}</p>
      <p>El código expira a las <strong>${formattedExpiration}</strong>. Si no pediste este cambio, ignora este correo.</p>
      <p style="margin-top:24px;color:#6B7280;font-size:13px;">ID de solicitud: ${payload.requestId}</p>
    `;
    const textBody = `Hola ${name}, tu código de recuperación es ${payload.code}. Expira a las ${formattedExpiration}. ID de solicitud: ${payload.requestId}.`;
    const templateId = Number(
      process.env.BREVO_RESET_TEMPLATE_ID ?? process.env.BREVO_TEMPLATE_ID ?? 0
    );
    return deliverTransactionalEmail({
      to: payload.to,
      subject,
      html: htmlBody,
      text: textBody,
      templateId: templateId > 0 ? templateId : undefined,
      templateParams: templateId
        ? {
            FIRSTNAME: name,
            RESET_CODE: payload.code,
            EXPIRES_AT: formattedExpiration,
            REQUEST_ID: payload.requestId,
          }
        : undefined,
    });
  }

  const htmlBody = `
    <p>Hola,</p>
    <p>Recibimos una solicitud para cambiar tu contraseña del POS.</p>
    <p>Haz clic en el siguiente enlace para continuar:</p>
    <p><a href="${payload.resetUrl}" style="color:#78350f;font-weight:600;">Restablecer contraseña</a></p>
    <p>El enlace expira en ${payload.expiresMinutes} minutos.</p>
    ${payload.requester ? `<p style="color:#6B7280;font-size:13px;">Solicitud desde: ${payload.requester}</p>` : ''}
  `;
  const textBody = [
    'Hola,',
    'Recibimos una solicitud para cambiar tu contraseña del POS.',
    `Enlace: ${payload.resetUrl}`,
    `Expira en ${payload.expiresMinutes} minutos.`,
    payload.requester ? `Solicitud registrada desde: ${payload.requester}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return deliverTransactionalEmail({
    to: payload.to,
    subject: 'Restablece tu contraseña | Xoco Café POS',
    html: htmlBody,
    text: textBody,
  });
}

interface OrderDeliveredEmailInput {
  to: string;
  displayName?: string | null;
  orderNumber: string;
  totalAmount?: number | null;
  currency?: string | null;
  paymentMethod: string;
  paymentReference?: string | null;
  ticketUrl?: string | null;
  deliveredAt?: string | null;
  items?: Array<{
    name: string;
    quantity?: number | null;
    price?: number | null;
  }>;
}

export async function sendOrderDeliveredEmail({
  to,
  displayName,
  orderNumber,
  totalAmount,
  currency,
  paymentMethod,
  paymentReference,
  ticketUrl,
  deliveredAt,
  items,
}: OrderDeliveredEmailInput) {
  const name = friendlyName(displayName);
  const subject = `Tu pedido ${orderNumber} fue entregado`;
  const totalFormatted = formatCurrency(totalAmount ?? undefined, currency ?? 'MXN');
  const deliveryTime = deliveredAt
    ? new Date(deliveredAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const itemsHtml = items?.length
    ? `<ul>${items
        .map(
          (item) =>
            `<li><strong>${item.quantity ?? 1}×</strong> ${item.name}${
              item.price ? ` — ${formatCurrency(item.price, currency ?? 'MXN')}` : ''
            }</li>`
        )
        .join('')}</ul>`
    : '';

  const htmlBody = `
    <p>Hola ${name},</p>
    <p>Tu pedido <strong>${orderNumber}</strong> se entregó ${
      deliveryTime ? `el <strong>${deliveryTime}</strong>.` : 'correctamente.'
    }</p>
    ${
      totalFormatted
        ? `<p style="font-size:24px;font-weight:700;margin:8px 0;">${totalFormatted}</p>`
        : ''
    }
    <p>Método de pago: <strong>${paymentMethod}</strong>${
      paymentReference ? `<br/>Referencia: <strong>${paymentReference}</strong>` : ''
    }</p>
    ${itemsHtml}
    ${
      ticketUrl
        ? `<p>Puedes ver tu ticket virtual en el siguiente enlace:</p>
      <p><a href="${ticketUrl}" style="color:#78350f;font-weight:600;">Ver ticket virtual</a></p>`
        : ''
    }
    <p>Gracias por confiar en Xoco Café. ¡Esperamos verte pronto!</p>
  `;

  const textBody = [
    `Hola ${name}, tu pedido ${orderNumber} fue entregado.`,
    deliveryTime ? `Fecha de entrega: ${deliveryTime}` : '',
    totalFormatted ? `Total: ${totalFormatted}` : '',
    `Método de pago: ${paymentMethod}`,
    paymentReference ? `Referencia: ${paymentReference}` : '',
    ticketUrl ? `Ticket virtual: ${ticketUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return deliverTransactionalEmail({
    to,
    subject,
    html: htmlBody,
    text: textBody,
  });
}

interface ReservationCreatedEmailInput {
  to: string;
  displayName?: string | null;
  reservationCode: string;
  reservationDate: string;
  reservationTime: string;
  peopleCount: number;
  branchLabel?: string | null;
  message?: string | null;
  preOrderItems?: string | null;
}

export async function sendReservationCreatedEmail({
  to,
  displayName,
  reservationCode,
  reservationDate,
  reservationTime,
  peopleCount,
  branchLabel,
  message,
  preOrderItems,
}: ReservationCreatedEmailInput) {
  const name = friendlyName(displayName);
  const subject = `Reserva ${reservationCode} confirmada`;

  const readableDate = new Date(`${reservationDate}T${reservationTime}:00`).toLocaleString(
    'es-MX',
    {
      dateStyle: 'full',
      timeStyle: 'short',
    }
  );

  const htmlBody = `
    <p>Hola ${name},</p>
    <p>Tu reservación quedó registrada con el código <strong>${reservationCode}</strong>.</p>
    <ul>
      <li><strong>Fecha:</strong> ${readableDate}</li>
      <li><strong>Personas:</strong> ${peopleCount}</li>
      ${
        branchLabel
          ? `<li><strong>Sucursal:</strong> ${branchLabel}</li>`
          : '<li><strong>Sucursal:</strong> Matriz</li>'
      }
    </ul>
    ${message ? `<p><strong>Comentario:</strong> ${message}</p>` : ''}
    ${
      preOrderItems
        ? `<p><strong>Pre-orden:</strong><br/>${preOrderItems.replace(/\n/g, '<br/>')}</p>`
        : ''
    }
    <p>Recuerda llegar 10 minutos antes para asegurar tu mesa. ¡Te esperamos!</p>
  `;

  const textBody = [
    `Hola ${name},`,
    `Código de reservación: ${reservationCode}`,
    `Fecha: ${readableDate}`,
    `Personas: ${peopleCount}`,
    branchLabel ? `Sucursal: ${branchLabel}` : '',
    message ? `Comentario: ${message}` : '',
    preOrderItems ? `Pre-orden: ${preOrderItems}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return deliverTransactionalEmail({
    to,
    subject,
    html: htmlBody,
    text: textBody,
  });
}

interface PasswordChangedEmailInput {
  to: string;
  displayName?: string | null;
  changedAt?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function sendPasswordChangedEmail({
  to,
  displayName,
  changedAt,
  ip,
  userAgent,
}: PasswordChangedEmailInput) {
  const name = friendlyName(displayName);
  const subject = 'Tu contraseña se actualizó correctamente';
  const readableDate = changedAt
    ? new Date(changedAt).toLocaleString('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  const htmlBody = `
    <p>Hola ${name},</p>
    <p>Te confirmamos que la contraseña de tu cuenta fue actualizada${
      readableDate ? ` el <strong>${readableDate}</strong>` : ''
    }.</p>
    ${
      ip || userAgent
        ? `<p>Información de seguridad:</p>
      <ul>
        ${ip ? `<li>IP: <strong>${ip}</strong></li>` : ''}
        ${userAgent ? `<li>Dispositivo: ${userAgent}</li>` : ''}
      </ul>`
        : ''
    }
    <p>Si no fuiste tú, restablece tu contraseña de inmediato o contáctanos.</p>
  `;

  const textBody = [
    `Hola ${name}, tu contraseña fue actualizada.`,
    readableDate ? `Fecha: ${readableDate}` : '',
    ip ? `IP: ${ip}` : '',
    userAgent ? `Dispositivo: ${userAgent}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return deliverTransactionalEmail({
    to,
    subject,
    html: htmlBody,
    text: textBody,
  });
}

interface MarketingOptInEmailInput {
  to: string;
  displayName?: string | null;
  channels: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
}

export async function sendMarketingOptInEmail({
  to,
  displayName,
  channels,
}: MarketingOptInEmailInput) {
  const name = friendlyName(displayName);
  const subject = 'Gracias por mantenerte en contacto con Xoco Café';
  const enabledChannels = [
    channels.email ? 'Email' : null,
    channels.sms ? 'SMS' : null,
    channels.push ? 'Notificaciones push' : null,
  ].filter(Boolean);

  const htmlBody = `
    <p>Hola ${name},</p>
    <p>Confirmamos que deseas recibir nuestras novedades por ${enabledChannels.join(', ')}.</p>
    <p>Puedes actualizar tus preferencias desde tu perfil en cualquier momento.</p>
    <p>Prepárate para enterarte antes que nadie de promociones, eventos y beneficios.</p>
  `;

  const textBody = `Hola ${name}, confirmamos que deseas recibir nuestras novedades por ${enabledChannels.join(
    ', '
  )}.`;

  return deliverTransactionalEmail({
    to,
    subject,
    html: htmlBody,
    text: textBody,
  });
}
