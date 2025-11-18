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
];

const SUPERUSER_ACCOUNTS = [
  { email: 'donovanriano@gmail.com', id: 'super-donovan', password: SOCIO_DEMO_PASSWORD },
  { email: 'donovan@criptec.io', id: 'super-criptec', password: SOCIO_DEMO_PASSWORD },
  { email: 'super.demo@xoco.local', id: 'super-demo', password: SUPERUSER_PASSWORD },
];

type StaffPreset = Partial<AuthenticatedStaff> & {
  shiftType?: ShiftType;
  startedAt?: string;
  demoPassword?: string;
};

const STAFF_PRESETS: Record<string, StaffPreset> = {
  'barista.demo@xoco.local': {
    id: 'barista-demo',
    role: 'barista',
    firstName: 'Demo',
    lastName: 'Barista',
    shiftType: 'full_time',
    branchId: 'MATRIZ',
    branchName: 'Sucursal Matriz',
    startedAt: '2022-08-15',
  },
  'gerente.demo@xoco.local': {
    id: 'manager-demo',
    role: 'gerente',
    firstName: 'Demo',
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
    firstName: 'Socio',
    lastName: account.email.split('@')[0],
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
    firstName: 'Super',
    lastName: account.email.split('@')[0],
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

const passwordMatchesDemo = (email: string, password: string) => {
  const preset = STAFF_PRESETS[email];
  if (!preset) {
    return false;
  }
  const expected = preset.demoPassword ?? DEMO_PASSWORD;
  return password === expected;
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

    const { data: staffRecord, error: staffError } = await supabaseAdmin
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
      .maybeSingle();

    if (staffError) {
      throw new Error(staffError.message);
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
    const preset =
      STAFF_PRESETS[normalizedEmail] ??
      (recordId && STAFF_PRESETS[recordId.toLowerCase()]) ??
      {};

    const branchId =
      preset.branchId ??
      (typeof staffRecord === 'object' && staffRecord !== null && 'branchId' in staffRecord
        ? (staffRecord as { branchId?: string | null }).branchId ?? null
        : null);
    let branchName = preset.branchName ?? null;

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

    const user: AuthenticatedStaff = {
      id:
        recordId ??
        preset.id ??
        normalizedEmail,
      email:
        (typeof staffRecord === 'object' && staffRecord !== null && 'email' in staffRecord
          ? (staffRecord as { email?: string | null }).email ?? trimmedEmail
          : trimmedEmail),
      role: sanitizeRole(
        (typeof staffRecord === 'object' && staffRecord !== null && 'role' in staffRecord
          ? (staffRecord as { role?: string | null }).role
          : null) ?? preset.role ?? 'barista'
      ),
      branchId,
      branchName,
      shiftType: normalizeShift(normalizedEmail, preset.shiftType ?? 'part_time'),
      hourlyRate: DEFAULT_HOURLY_RATE,
      firstName: normalizeName(
        preset.firstName ??
          (typeof staffRecord === 'object' && staffRecord !== null && 'firstNameEncrypted' in staffRecord
            ? (staffRecord as { firstNameEncrypted?: string | null }).firstNameEncrypted
            : null)
      ),
      lastName: normalizeName(
        preset.lastName ??
          (typeof staffRecord === 'object' && staffRecord !== null && 'lastNameEncrypted' in staffRecord
            ? (staffRecord as { lastNameEncrypted?: string | null }).lastNameEncrypted
            : null)
      ),
      startedAt:
        preset.startedAt ??
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
