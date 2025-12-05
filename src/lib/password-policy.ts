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

const DEFAULT_POLICY_MESSAGE =
  'La contraseña debe tener al menos 10 caracteres, mayúsculas, minúsculas, número y símbolo, y no puede contener tu correo.';

export const PASSWORD_POLICY_MESSAGE = process.env.POS_PASSWORD_POLICY_MESSAGE ?? DEFAULT_POLICY_MESSAGE;

export const meetsPasswordPolicy = (password: string, email?: string | null) => {
  if (!password || password.length < 10) {
    return false;
  }
  const hasUpper = /[A-ZÁÉÍÓÚÜÑ]/.test(password);
  const hasLower = /[a-záéíóúüñ]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  if (!hasUpper || !hasLower || !hasNumber || !hasSymbol) {
    return false;
  }
  if (email) {
    const [local] = email.split('@');
    if (local && password.toLowerCase().includes(local.toLowerCase())) {
      return false;
    }
  }
  return true;
};

export const assertPasswordPolicy = (password: string, email?: string | null) => {
  if (!meetsPasswordPolicy(password, email)) {
    throw new Error(PASSWORD_POLICY_MESSAGE);
  }
};
