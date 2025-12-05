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
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = false;

const PASSWORD_POLICY_TEXT =
  process.env.NEXT_PUBLIC_POS_PASSWORD_POLICY_MESSAGE ??
  'La contraseña debe tener al menos 10 caracteres, mayúsculas, minúsculas, número y símbolo, y no puede contener tu correo.';

export function ResetPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setFeedback(null);
    setSuccessMessage(null);
    setNewPassword('');
    setConfirmPassword('');
  }, [token]);

  const handleRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/auth/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { success: boolean; error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'No pudimos enviar el correo.');
      }
      setSuccessMessage('Si el correo existe en el sistema, enviamos instrucciones para resetear tu contraseña.');
      setEmail('');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No pudimos enviar el correo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setFeedback('El enlace no es válido. Solicita uno nuevo.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback('Las contraseñas no coinciden.');
      return;
    }
    setIsSubmitting(true);
    setFeedback(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/auth/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const payload = (await response.json()) as { success: boolean; error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'No pudimos actualizar la contraseña.');
      }
      setSuccessMessage('Tu contraseña fue actualizada. Te llevaremos al login.');
      setTimeout(() => router.push('/'), 2500);
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'No pudimos actualizar la contraseña.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--brand-bg)] px-4 py-12 text-[var(--brand-text)]">
      <div className="card w-full max-w-2xl space-y-8 p-8">
        <div className="flex flex-col items-center gap-4">
          <Image src="/xoco-logo.svg" alt="Xoco Café" width={96} height={96} priority className="h-20 w-20" />
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.35em] text-primary-500">Xoco Café · Admin</p>
            <h1 className="mt-2 text-3xl font-semibold">
              {token ? 'Define tu nueva contraseña' : 'Recupera tu contraseña'}
            </h1>
            <p className="text-sm text-[var(--brand-muted)]">
              {token
                ? 'Introduce una nueva contraseña para reactivar tu acceso.'
                : 'Ingresa el correo asociado a tu cuenta para enviarte instrucciones.'}
            </p>
          </div>
        </div>

        {token ? (
          <form onSubmit={handleConfirm} className="space-y-6">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-[var(--brand-muted)]">Nueva contraseña</label>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="w-full rounded-2xl border border-primary-100/70 bg-white/70 px-4 py-3 text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                placeholder="••••••••••"
              />
              <p className="text-xs text-[var(--brand-muted)]">{PASSWORD_POLICY_TEXT}</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-[var(--brand-muted)]">Confirmar contraseña</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-2xl border border-primary-100/70 bg-white/70 px-4 py-3 text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                placeholder="••••••••••"
              />
            </div>
            {feedback && (
              <p className="rounded-2xl border border-danger-200/60 bg-danger-50/60 px-3 py-2 text-sm text-danger-700 dark:border-danger-500/40 dark:bg-danger-900/20 dark:text-danger-200">
                {feedback}
              </p>
            )}
            {successMessage && (
              <p className="rounded-2xl border border-emerald-200/60 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-900/20 dark:text-emerald-200">
                {successMessage}
              </p>
            )}
            <button type="submit" className="brand-button w-full py-3" disabled={isSubmitting}>
              {isSubmitting ? 'Actualizando…' : 'Actualizar contraseña'}
            </button>
            <Link href="/" className="block text-center text-sm font-semibold text-primary-500">
              Volver al inicio de sesión
            </Link>
          </form>
        ) : (
          <form onSubmit={handleRequest} className="space-y-6">
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
            {feedback && (
              <p className="rounded-2xl border border-danger-200/60 bg-danger-50/60 px-3 py-2 text-sm text-danger-700 dark:border-danger-500/40 dark:bg-danger-900/20 dark:text-danger-200">
                {feedback}
              </p>
            )}
            {successMessage && (
              <p className="rounded-2xl border border-emerald-200/60 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-900/20 dark:text-emerald-200">
                {successMessage}
              </p>
            )}
            <button type="submit" className="brand-button w-full py-3" disabled={isSubmitting}>
              {isSubmitting ? 'Enviando…' : 'Enviar instrucciones'}
            </button>
            <Link href="/" className="block text-center text-sm font-semibold text-primary-500">
              Volver al inicio de sesión
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
