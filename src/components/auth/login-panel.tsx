'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useAuth, type StaffRole } from '@/providers/auth-provider';

const DEFAULT_CREDENTIALS = {
  email: 'barista.demo@xoco.local',
  password: 'Barista#2024',
};

const MANAGER_CREDENTIALS = {
  email: 'gerente.demo@xoco.local',
  password: 'Gerente#2024',
};

const SOCIO_CREDENTIALS = {
  email: 'socio.demo@xoco.local',
  password: 'Socio#2024',
};

const SUPERUSER_CREDENTIALS = {
  email: 'super.demo@xoco.local',
  password: 'Super#2024',
};

const ROLE_OPTIONS: { id: StaffRole; label: string; description: string }[] = [
  { id: 'barista', label: 'Barista', description: 'Opera la barra y gestiona pedidos.' },
  { id: 'gerente', label: 'Gerente', description: 'Supervisa el día a día de la sucursal.' },
  { id: 'socio', label: 'Socio', description: 'Acceso completo a métricas y reportes.' },
  { id: 'superuser', label: 'Super usuario', description: 'Administra socios y accesos especiales.' },
];

export function LoginPanel() {
  const { login, isAuthenticating, error } = useAuth();
  const [email, setEmail] = useState(DEFAULT_CREDENTIALS.email);
  const [password, setPassword] = useState(DEFAULT_CREDENTIALS.password);
  const [role, setRole] = useState<StaffRole>('barista');
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
      await login({ email: email.trim(), password, role });
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
              Autentica tu rol para continuar con el panel POS.
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

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--brand-muted)]">
              Selecciona tu rol
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {ROLE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setRole(option.id)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    role === option.id
                      ? 'border-primary-500 bg-primary-50 text-primary-900 dark:border-primary-200 dark:bg-primary-900/30 dark:text-white'
                      : 'border-primary-100/70 text-[var(--brand-text)] hover:border-primary-300 dark:border-white/10 dark:text-white'
                  }`}
                >
                  <p className="font-semibold">{option.label}</p>
                  <p className="text-xs text-[var(--brand-muted)]">{option.description}</p>
                </button>
              ))}
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
          <div className="space-y-1 text-center text-xs text-[var(--brand-muted)]">
            <p>
              Demo barista:{' '}
              <span className="font-semibold">{DEFAULT_CREDENTIALS.email}</span> ·{' '}
              <span className="font-semibold">{DEFAULT_CREDENTIALS.password}</span>
            </p>
            <p>
              Demo gerente:{' '}
              <span className="font-semibold">{MANAGER_CREDENTIALS.email}</span> ·{' '}
              <span className="font-semibold">{MANAGER_CREDENTIALS.password}</span>
            </p>
            <p>
              Demo socio:{' '}
              <span className="font-semibold">{SOCIO_CREDENTIALS.email}</span> ·{' '}
              <span className="font-semibold">{SOCIO_CREDENTIALS.password}</span>
            </p>
            <p>
              Demo super usuario:{' '}
              <span className="font-semibold">{SUPERUSER_CREDENTIALS.email}</span> ·{' '}
              <span className="font-semibold">{SUPERUSER_CREDENTIALS.password}</span>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
