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

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { AuthenticatedStaff, ShiftType, StaffRole } from '@/providers/auth-provider';

const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';
const BRANCHES_TABLE = process.env.SUPABASE_BRANCHES_TABLE ?? 'branches';
const DEFAULT_HOURLY_RATE = Number(process.env.POS_STAFF_HOURLY_RATE ?? 38.1);
const DEMO_PASSWORD = process.env.POS_DEMO_PASSWORD ?? process.env.BARISTA_DEMO_PASSWORD ?? 'Barista#2024';
const MANAGER_DEMO_PASSWORD = process.env.POS_MANAGER_DEMO_PASSWORD ?? process.env.GERENTE_DEMO_PASSWORD ?? 'Gerente#2024';
const SOCIO_DEMO_PASSWORD = process.env.POS_SOCIO_DEMO_PASSWORD ?? 'Socio#2024';
const SUPERUSER_PASSWORD = process.env.POS_SUPERUSER_PASSWORD ?? 'Super#2024';

const SOCIO_ACCOUNTS = [
  { email: 'socio.demo@xoco.local', id: 'socio-demo' },
  { email: 'cots.21d@gmail.com', id: 'socio-cots' },
  { email: 'aleisgales99@gmail.com', id: 'socio-ale' },
  { email: 'garcia.aragon.jhon23@gmail.com', id: 'socio-jhon' },
  { email: 'donovanriano@gmail.com', id: 'socio-donovan' },
];

const SUPERUSER_ACCOUNTS = [
  { email: 'donovan@criptec.io', id: 'super-criptec', password: SUPERUSER_PASSWORD },
  { email: 'super.demo@xoco.local', id: 'super-demo', password: SUPERUSER_PASSWORD },
];

type StaffPreset = Partial<AuthenticatedStaff> & {
  shiftType?: ShiftType;
  startedAt?: string;
  demoPassword?: string;
};

type StaffDbRecord = {
  id: string;
  email?: string | null;
  passwordHash?: string | null;
  role?: string | null;
  branchId?: string | null;
  createdAt?: string | null;
  firstNameEncrypted?: string | null;
  lastNameEncrypted?: string | null;
};

const STAFF_PRESETS: Record<string, StaffPreset> = {
  'barista.demo@xoco.local': {
    id: 'barista-demo',
    role: 'barista',
    firstName: 'Barista',
    lastName: 'Barista',
    shiftType: 'full_time',
    branchId: 'MATRIZ',
    branchName: 'Sucursal Matriz',
    startedAt: '2022-08-15',
  },
  'gerente.demo@xoco.local': {
    id: 'manager-demo',
    role: 'gerente',
    firstName: 'Gerente',
    lastName: 'Gerente',
    shiftType: 'full_time',
    branchId: 'MATRIZ',
    branchName: 'Sucursal Matriz',
    startedAt: '2021-06-01',
    demoPassword: MANAGER_DEMO_PASSWORD,
  },
};

SOCIO_ACCOUNTS.forEach((account) => {
  STAFF_PRESETS[account.email.toLowerCase()] = {
    id: account.id,
    role: 'socio',
    firstName:
      account.email.toLowerCase() === 'cots.21d@gmail.com'
        ? 'Sergio'
        : account.email.toLowerCase() === 'aleisgales99@gmail.com'
          ? 'Alejandro'
          : account.email.toLowerCase() === 'garcia.aragon.jhon23@gmail.com'
            ? 'Juan'
            : 'Socio',
    lastName:
      account.email.toLowerCase() === 'cots.21d@gmail.com'
        ? 'Cortés'
        : account.email.toLowerCase() === 'aleisgales99@gmail.com'
          ? 'Galván'
          : account.email.toLowerCase() === 'garcia.aragon.jhon23@gmail.com'
            ? 'García'
            : account.email.split('@')[0],
    shiftType: 'full_time',
    branchId: 'MATRIZ',
    branchName: 'Consejo Xoco',
    startedAt: '2020-01-01',
    demoPassword: SOCIO_DEMO_PASSWORD,
  };
});

SUPERUSER_ACCOUNTS.forEach((account) => {
  STAFF_PRESETS[account.email.toLowerCase()] = {
    id: account.id,
    role: 'superuser',
    firstName:
      account.email.toLowerCase() === 'donovan@criptec.io'
        ? 'Donovan'
        : 'Super',
    lastName:
      account.email.toLowerCase() === 'donovan@criptec.io'
        ? 'Riaño'
        : account.email.split('@')[0],
    shiftType: 'full_time',
    branchId: 'MATRIZ',
    branchName: 'Consejo Xoco',
    startedAt: '2019-01-01',
    demoPassword: account.password,
  };
});

const sanitizeRole = (role?: string | null): StaffRole => {
  if (role === 'gerente' || role === 'socio' || role === 'superuser') {
    return role;
  }
  return 'barista';
};

const extractRole = (role?: string | null): StaffRole | null => {
  if (role === 'barista' || role === 'gerente' || role === 'socio' || role === 'superuser') {
    return role;
  }
  return null;
};

const normalizeShift = (email: string, fallback: ShiftType = 'part_time'): ShiftType => {
  return STAFF_PRESETS[email.toLowerCase()]?.shiftType ?? fallback;
};

const normalizeName = (value?: string | null) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
};

const readStoredName = (value?: unknown) => (typeof value === 'string' ? value.trim() || null : null);

const passwordMatchesDemo = (email: string, password: string) => {
  const preset = STAFF_PRESETS[email];
  if (!preset) {
    return false;
  }
  const expected = preset.demoPassword ?? DEMO_PASSWORD;
  if (password === expected) {
    return true;
  }
  if (preset.role === 'superuser' && password === SOCIO_DEMO_PASSWORD) {
    return true;
  }
  return false;
};

const toDbRole = (role: StaffRole) => (role === 'superuser' ? 'socio' : role);

const provisionStaffRecord = async ({
  email,
  preset,
}: {
  email: string;
  preset?: StaffPreset;
}): Promise<StaffDbRecord> => {
  const normalizedRole = sanitizeRole(preset?.role ?? 'barista');
  const insertPayload: Record<string, unknown> = {
    id: randomUUID(),
    email,
    role: toDbRole(normalizedRole),
    branchId: preset?.branchId ?? 'MATRIZ',
    firstNameEncrypted: preset?.firstName ?? null,
    lastNameEncrypted: preset?.lastName ?? null,
    is_active: true,
  };

  const { data, error } = await supabaseAdmin
    .from(STAFF_TABLE)
    .insert(insertPayload)
    .select(
      [
        'id',
        'email',
        '"passwordHash"',
        'role',
        '"branchId"',
        '"createdAt"',
        '"firstNameEncrypted"',
        '"lastNameEncrypted"',
      ].join(',')
    )
    .single<StaffDbRecord>();

  if (error) {
    throw new Error(`No pudimos registrar el perfil del staff: ${error.message}`);
  }

  return data;
};

export async function POST(request: Request) {
  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Requerimos correo y contraseña.' },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim();
    const normalizedEmail = trimmedEmail.toLowerCase();

    const preset = STAFF_PRESETS[normalizedEmail] ?? {};

    const { data: initialStaffRecord, error: staffError } = await supabaseAdmin
      .from(STAFF_TABLE)
      .select(
        [
          'id',
          'email',
          '"passwordHash"',
          'role',
          '"branchId"',
          '"createdAt"',
          '"firstNameEncrypted"',
          '"lastNameEncrypted"',
        ].join(',')
      )
      .ilike('email', normalizedEmail)
      .maybeSingle<StaffDbRecord>();

    if (staffError) {
      throw new Error(staffError.message);
    }

    let staffRecord: StaffDbRecord | null = initialStaffRecord;

    if (!staffRecord) {
      staffRecord = await provisionStaffRecord({ email: trimmedEmail, preset });
    }

    let passwordIsValid =
      Boolean('passwordHash' in (staffRecord ?? {})) &&
      Boolean((staffRecord as { passwordHash?: string | null | undefined })?.passwordHash);
    if (passwordIsValid) {
      const hash = (staffRecord as { passwordHash?: string | null | undefined })?.passwordHash;
      if (hash) {
        passwordIsValid = await bcrypt.compare(password, hash);
      }
    }

    if (!passwordIsValid && passwordMatchesDemo(normalizedEmail, password)) {
      passwordIsValid = true;
    }

    if (!passwordIsValid) {
      return NextResponse.json(
        { success: false, error: 'Usuario o contraseña incorrectos.' },
        { status: 401 }
      );
    }

    const recordId =
      typeof staffRecord === 'object' && staffRecord !== null && 'id' in staffRecord
        ? (staffRecord as { id?: string | null }).id
        : null;
    const presetOverride =
      STAFF_PRESETS[normalizedEmail] ??
      (recordId && STAFF_PRESETS[recordId.toLowerCase()]) ??
      preset ??
      {};

    const branchId =
      presetOverride.branchId ??
      (typeof staffRecord === 'object' && staffRecord !== null && 'branchId' in staffRecord
        ? (staffRecord as { branchId?: string | null }).branchId ?? null
        : null);
    let branchName = presetOverride.branchName ?? null;

    if (!branchName && branchId) {
      const { data: branch, error: branchError } = await supabaseAdmin
        .from(BRANCHES_TABLE)
        .select('id,name,code')
        .eq('id', branchId)
        .maybeSingle();
      if (branchError) {
        console.warn('No pudimos obtener la sucursal asignada:', branchError);
      }
      branchName = branch?.name ?? branch?.code ?? branchId;
    }

    if (recordId) {
      const desiredFirst = normalizeName(presetOverride.firstName);
      const desiredLast = normalizeName(presetOverride.lastName);
      const currentFirst = readStoredName(
        (staffRecord as { firstNameEncrypted?: string | null })?.firstNameEncrypted
      );
      const currentLast = readStoredName(
        (staffRecord as { lastNameEncrypted?: string | null })?.lastNameEncrypted
      );
      const updates: Record<string, string> = {};
      if (desiredFirst && desiredFirst !== currentFirst) {
        updates.firstNameEncrypted = desiredFirst;
      }
      if (desiredLast && desiredLast !== currentLast) {
        updates.lastNameEncrypted = desiredLast;
      }
      if (Object.keys(updates).length) {
        const { error: updateNamesError } = await supabaseAdmin
          .from(STAFF_TABLE)
          .update(updates)
          .eq('id', recordId);
        if (updateNamesError) {
          console.warn('No pudimos actualizar los nombres del staff:', updateNamesError);
        } else {
          staffRecord = { ...(staffRecord ?? ({} as StaffDbRecord)), ...updates };
        }
      }
    }

    const storedRole = extractRole(
      typeof staffRecord === 'object' && staffRecord !== null && 'role' in staffRecord
        ? (staffRecord as { role?: string | null }).role ?? null
        : null
    );
    const effectiveRole = presetOverride.role ?? storedRole ?? 'barista';

    const user: AuthenticatedStaff = {
      id:
        recordId ??
        presetOverride.id ??
        normalizedEmail,
      email:
        (typeof staffRecord === 'object' && staffRecord !== null && 'email' in staffRecord
          ? (staffRecord as { email?: string | null }).email ?? trimmedEmail
          : trimmedEmail),
      role: effectiveRole,
      branchId,
      branchName,
      shiftType: normalizeShift(normalizedEmail, presetOverride.shiftType ?? 'part_time'),
      hourlyRate: DEFAULT_HOURLY_RATE,
      firstName: normalizeName(
        presetOverride.firstName ??
          (typeof staffRecord === 'object' && staffRecord !== null && 'firstNameEncrypted' in staffRecord
            ? (staffRecord as { firstNameEncrypted?: string | null }).firstNameEncrypted
            : null)
      ),
      lastName: normalizeName(
        presetOverride.lastName ??
          (typeof staffRecord === 'object' && staffRecord !== null && 'lastNameEncrypted' in staffRecord
            ? (staffRecord as { lastNameEncrypted?: string | null }).lastNameEncrypted
            : null)
      ),
      startedAt:
        presetOverride.startedAt ??
        (typeof staffRecord === 'object' && staffRecord !== null && 'createdAt' in staffRecord
          ? (staffRecord as { createdAt?: string | null }).createdAt
          : null) ??
        new Date().toISOString(),
    };

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('Error en login de staff:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos autenticarte. Intenta más tarde.' },
      { status: 500 }
    );
  }
}
