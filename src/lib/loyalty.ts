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
const normalizeEnvValue = (value?: string | null) => value?.trim() ?? '';

const resolvedPublicClientId = normalizeEnvValue(process.env.NEXT_PUBLIC_PUBLIC_SALE_CLIENT_ID) || 'AAA-1111';
const resolvedPublicUserId =
  normalizeEnvValue(process.env.NEXT_PUBLIC_PUBLIC_SALE_USER_ID) || resolvedPublicClientId;

const PUBLIC_SALE_IDENTIFIERS = [resolvedPublicClientId, resolvedPublicUserId]
  .map((value) => value.trim().toLowerCase())
  .filter((value) => Boolean(value));

export const LOYALTY_STAMPS_TARGET = 7;
export const PUBLIC_SALE_CLIENT_ID = resolvedPublicClientId;
export const PUBLIC_SALE_USER_ID = resolvedPublicUserId;

export const isPublicSaleIdentifier = (value?: string | null) => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return PUBLIC_SALE_IDENTIFIERS.includes(normalized);
};

type PublicSaleOrderInput = {
  clientId?: string | null;
  userId?: string | null;
  user?: {
    clientId?: string | null;
    id?: string | null;
  } | null;
} | null;

export const isPublicSaleOrder = (order: PublicSaleOrderInput) => {
  if (!order) {
    return false;
  }
  const candidates = [order.clientId, order.userId, order.user?.clientId, order.user?.id];
  return candidates.some((identifier) => isPublicSaleIdentifier(identifier));
};
