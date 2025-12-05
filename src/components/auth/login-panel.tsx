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

'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/providers/auth-provider';

const CLIENT_CREDENTIALS = {
  email: 'cliente.demo@xoco.local',
  password: 'Cliente#2024',
};

export function LoginPanel() {
  const { login, isAuthenticating, error } = useAuth();
  const [email, setEmail] = useState(CLIENT_CREDENTIALS.email);
  const [password, setPassword] = useState(CLIENT_CREDENTIALS.password);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!email.trim() || !password.trim()) {
      setFormError('Ingresa correo y contraseña.');
      return;
    }
    try {
      await login({ email: email.trim(), password });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Credenciales inválidas.');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--brand-bg)] px-4 py-12 text-[var(--brand-text)]">
      <div className="card w-full max-w-2xl space-y-8 p-8">
        <div className="flex flex-col items-center gap-4">
          <Image
            src="/xoco-logo.svg"
            alt="Xoco Café"
            width={96}
            height={96}
            priority
            className="h-20 w-20"
          />
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.35em] text-primary-500">Xoco Café · Admin</p>
            <h1 className="mt-2 text-3xl font-semibold">Acceso privado</h1>
            <p className="text-sm text-[var(--brand-muted)]">
              Inicia sesión con tus credenciales de cliente para continuar con el panel POS.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1">
            <label className="text-sm font-semibold text-[var(--brand-muted)]">Correo</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-primary-100/70 bg-white/70 px-4 py-3 text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
              placeholder="correo@xoco.cafe"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-[var(--brand-muted)]">Contraseña</label>
            <div className="flex rounded-2xl border border-primary-100/70 bg-white/70 px-4 focus-within:border-primary-400 dark:border-white/10 dark:bg-white/5">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full bg-transparent py-3 text-[var(--brand-text)] focus:outline-none dark:text-white"
                placeholder="••••••••"
              />
              <button
                type="button"
                className="text-xs font-semibold text-primary-500 dark:text-primary-200"
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </div>

          {(formError || error) && (
            <p className="rounded-2xl border border-danger-200/60 bg-danger-50/60 px-3 py-2 text-sm text-danger-700 dark:border-danger-500/40 dark:bg-danger-900/20 dark:text-danger-200">
              {formError || error}
            </p>
          )}

          <button type="submit" className="brand-button w-full py-3" disabled={isAuthenticating}>
            {isAuthenticating ? 'Verificando…' : 'Ingresar'}
          </button>
          <Link href="/reset-password" className="block text-center text-sm font-semibold text-primary-500">
            ¿Olvidaste tu contraseña?
          </Link>
          <div className="rounded-2xl border border-primary-100/70 bg-white/60 px-4 py-3 text-center text-xs text-[var(--brand-text)] shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-white">
            <p className="text-[var(--brand-muted)]">Demo cliente</p>
            <p className="font-semibold">{CLIENT_CREDENTIALS.email}</p>
            <p className="font-semibold">{CLIENT_CREDENTIALS.password}</p>
          </div>
        </form>
      </div>
    </div>
  );
}
