#!/usr/bin/env node
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

import { createHash } from 'node:crypto';

const [, , emailArg, passwordArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error('Uso: node scripts/hash-staff-password.mjs <correo> <contraseña>');
  process.exit(1);
}

const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '_');
const buildSaltKey = (email) => `POS_PASSWORD_SALT_${slugify(email)}`.toUpperCase();

const email = emailArg.trim().toLowerCase();
const password = passwordArg;
const globalSalt = process.env.POS_PASSWORD_GLOBAL_SALT ?? '';
const userSalt = process.env[buildSaltKey(email)] ?? '';
const payload = `${globalSalt}${password}${userSalt}`;
const hash = createHash('sha256').update(payload).digest('hex');

console.log(`Email: ${email}`);
console.log(`GLOBAL salt usado: ${globalSalt ? '[definido]' : '[vacío]'}`);
console.log(`USER salt key: ${buildSaltKey(email)} ${userSalt ? '(definido)' : '(vacío)'}`);
console.log(`Hash SHA-256 resultante: ${hash}`);
console.log('\nInserta este valor en staff_users."passwordHash" para ese correo.');
