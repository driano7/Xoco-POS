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
/*
 * Utilidades para generar hashes salteados para el POS.
 * Combina un salt global y uno específico por usuario.
 */

import { createHash } from 'crypto';

const GLOBAL_SALT = process.env.POS_PASSWORD_GLOBAL_SALT ?? '';

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '_');

const getEnv = (prefix: string, identifier: string) => {
  const key = `${prefix}_${identifier}`.toUpperCase();
  return process.env[key] ?? null;
};

export const getUserSalt = (email: string) => getEnv('POS_PASSWORD_SALT', slugify(email)) ?? '';

export const getPresetHashOverride = (email: string) =>
  getEnv('POS_PASSWORD_HASH', slugify(email));

export const hashWithSalts = (email: string, password: string) => {
  const userSalt = getUserSalt(email);
  const payload = `${GLOBAL_SALT}${password}${userSalt}`;
  return createHash('sha256').update(payload).digest('hex');
};
