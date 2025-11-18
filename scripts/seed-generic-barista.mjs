import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY antes de ejecutar este script.');
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = process.env.BARISTA_TEST_EMAIL ?? 'barista.demo@xoco.local';
const password = process.env.BARISTA_TEST_PASSWORD ?? 'Barista#2024';
const staffId = process.env.BARISTA_TEST_ID ?? 'barista-demo';
const branchId = process.env.BARISTA_TEST_BRANCH ?? 'MATRIZ';

const TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';

async function run() {
  console.log(`Creando/actualizando usuario demo ${email}…`);
  const passwordHash = await bcrypt.hash(password, 12);
  const payload = {
    id: staffId,
    email,
    role: 'barista',
    branchId,
    is_active: true,
    passwordHash,
    firstNameEncrypted: 'Demo',
    lastNameEncrypted: 'Barista',
    createdAt: new Date('2022-08-15').toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const { error } = await client.from(TABLE).upsert(payload, { onConflict: 'email' });

  if (error) {
    console.error('No pudimos registrar el usuario demo:', error.message);
    process.exit(1);
  }

  console.log(
    `Listo. Puedes iniciar sesión con ${email} / ${password}. Si la sucursal MATRIZ no existe, créala antes.`
  );
}

run();
