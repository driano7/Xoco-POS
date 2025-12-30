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

const parseEnvList = (value?: string | null) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => Boolean(entry));

const resolvedMaxStamps =
  Number(process.env.LOYALTY_MAX_STAMPS ?? process.env.NEXT_PUBLIC_LOYALTY_TARGET ?? 7) || 7;

export const LOYALTY_STAMPS_TARGET = Math.max(1, resolvedMaxStamps);
export const PUBLIC_SALE_CLIENT_ID = resolvedPublicClientId;
export const PUBLIC_SALE_USER_ID = resolvedPublicUserId;
export const LOYALTY_ELIGIBLE_PRODUCTS = parseEnvList(process.env.LOYALTY_ELIGIBLE_PRODUCTS);

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

const normalizedEligibleProducts = new Set(
  LOYALTY_ELIGIBLE_PRODUCTS.map((productId) => productId.toLowerCase())
);

export const isLoyaltyEligibleProduct = (productId?: string | null) => {
  if (!productId) {
    return false;
  }
  const normalized = productId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalizedEligibleProducts.has(normalized);
};

export const getCurrentWeekBounds = () => {
  const now = new Date();
  const day = now.getDay(); // 0 (Sun) - 6 (Sat)
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
};

export const normalizeWeeklyPunches = (totalPunches: number) => {
  const sanitized = Math.max(0, Math.floor(totalPunches));
  if (sanitized >= LOYALTY_STAMPS_TARGET) {
    return { weeklyCoffeeCount: 0, rewardEarned: true };
  }
  return { weeklyCoffeeCount: sanitized, rewardEarned: false };
};

export const addWeeklyPunches = (currentCount: number, punchesToAdd: number) => {
  const sanitizedCurrent = Math.max(0, Math.floor(currentCount));
  const sanitizedPunches = Math.max(0, Math.floor(punchesToAdd));
  if (sanitizedPunches === 0) {
    return {
      weeklyCoffeeCount: sanitizedCurrent,
      rewardEarned: false,
    };
  }
  const total = sanitizedCurrent + sanitizedPunches;
  return normalizeWeeklyPunches(total);
};
