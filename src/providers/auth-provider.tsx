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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type StaffRole = 'barista' | 'gerente' | 'socio' | 'superuser';
export type ShiftType = 'full_time' | 'part_time';

export interface AuthenticatedStaff {
  id: string;
  email: string;
  role: StaffRole;
  branchId?: string | null;
  branchName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  startedAt?: string | null;
  shiftType: ShiftType;
  hourlyRate: number;
  permissions?: string[];
}

interface AuthContextValue {
  user: AuthenticatedStaff | null;
  isAuthenticating: boolean;
  error: string | null;
  sessionSeconds: number;
  login: (payload: { email: string; password: string; role?: StaffRole }) => Promise<void>;
  logout: () => void;
  changePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = 'xoco-pos.auth.user';
const SESSION_STORAGE_KEY = 'xoco-pos.auth.sessionStartedAt';
const LAST_ACTIVITY_KEY = 'xoco-pos.auth.lastActivity';
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const readStoredUser = () => {
  if (typeof window === 'undefined') {
    return { user: null, sessionStartedAt: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const session = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return {
      user: raw ? (JSON.parse(raw) as AuthenticatedStaff) : null,
      sessionStartedAt: session,
    };
  } catch {
    return { user: null, sessionStartedAt: null };
  }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [{ user, sessionStartedAt }, setState] = useState(() => readStoredUser());
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(0);

  const persistState = useCallback((nextUser: AuthenticatedStaff | null, startedAt: string | null) => {
    if (typeof window === 'undefined') {
      return;
    }
    if (nextUser) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    if (startedAt) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, startedAt);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    if (!nextUser) {
      window.localStorage.removeItem(LAST_ACTIVITY_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleUnload = () => {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.removeItem(LAST_ACTIVITY_KEY);
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  useEffect(() => {
    if (!sessionStartedAt) {
      setSessionSeconds(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const start = new Date(sessionStartedAt).getTime();
    const updateTimer = () => {
      const delta = Math.max(0, Date.now() - start);
      setSessionSeconds(Math.floor(delta / 1000));
    };
    updateTimer();
    timerRef.current = setInterval(updateTimer, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionStartedAt]);

  const login = useCallback(
    async ({ email, password, role }: { email: string; password: string; role?: StaffRole }) => {
      setIsAuthenticating(true);
      setError(null);
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, role }),
        });

        const payload = (await response.json()) as {
          success: boolean;
          error?: string;
          user?: AuthenticatedStaff;
        };

        if (!response.ok || !payload.success || !payload.user) {
          throw new Error(payload.error || 'No pudimos iniciar sesión.');
        }

        const startedAt = new Date().toISOString();
        setState({ user: payload.user, sessionStartedAt: startedAt });
        persistState(payload.user, startedAt);
        if (typeof window !== 'undefined') {
          const now = Date.now();
          lastActivityRef.current = now;
          window.localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No pudimos iniciar sesión.');
        throw err;
      } finally {
        setIsAuthenticating(false);
      }
    },
    [persistState]
  );

  const logout = useCallback(() => {
    setState({ user: null, sessionStartedAt: null });
    persistState(null, null);
    setSessionSeconds(0);
    setError(null);
    lastActivityRef.current = 0;
  }, [persistState]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const markActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      }
    };
    markActivity();
    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, markActivity));
    const interval = window.setInterval(() => {
      const last = lastActivityRef.current || Number(window.localStorage.getItem(LAST_ACTIVITY_KEY) ?? 0);
      if (last && Date.now() - last >= SESSION_TIMEOUT_MS) {
        logout();
      }
    }, 1000);
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActivity));
      window.clearInterval(interval);
    };
  }, [user, logout]);

  const changePassword = useCallback(
    async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
      if (!user) {
        throw new Error('Debes iniciar sesión primero.');
      }
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          currentPassword,
          newPassword,
        }),
      });

      const payload = (await response.json()) as { success: boolean; error?: string };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'No pudimos actualizar la contraseña.');
      }
    },
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticating,
      error,
      sessionSeconds,
      login,
      logout,
      changePassword,
    }),
    [user, isAuthenticating, error, sessionSeconds, login, logout, changePassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
