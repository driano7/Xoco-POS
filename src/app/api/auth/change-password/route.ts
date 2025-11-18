import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-server';

const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';

const isValidPassword = (password: string, email?: string | null) => {
  if (password.length < 10) {
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

export async function POST(request: Request) {
  try {
    const { userId, email, currentPassword, newPassword } = (await request.json()) as {
      userId?: string;
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    };

    if (!userId || !email || !currentPassword || !newPassword) {
      return NextResponse.json(
        { success: false, error: 'Falta información para validar el cambio.' },
        { status: 400 }
      );
    }

    const { data: staffRecord, error: staffError } = await supabaseAdmin
      .from(STAFF_TABLE)
      .select('id,email,"passwordHash"')
      .or(`id.eq.${userId},email.eq.${email}`)
      .maybeSingle();

    if (staffError) {
      throw new Error(staffError.message);
    }

    if (!staffRecord || !staffRecord.passwordHash) {
      return NextResponse.json(
        { success: false, error: 'No encontramos al usuario solicitado.' },
        { status: 404 }
      );
    }

    const matches = await bcrypt.compare(currentPassword, staffRecord.passwordHash);
    if (!matches) {
      return NextResponse.json(
        { success: false, error: 'La contraseña actual no coincide.' },
        { status: 401 }
      );
    }

    if (!isValidPassword(newPassword, staffRecord.email ?? email)) {
      return NextResponse.json(
        {
          success: false,
          error:
            'La contraseña debe tener al menos 10 caracteres, mayúsculas, minúsculas, número y símbolo, y no puede contener tu correo.',
        },
        { status: 400 }
      );
    }

    const hashed = await bcrypt.hash(newPassword, 12);

    const { error: updateError } = await supabaseAdmin
      .from(STAFF_TABLE)
      .update({ passwordHash: hashed })
      .eq('id', staffRecord.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error al actualizar contraseña de staff:', error);
    return NextResponse.json(
      { success: false, error: 'No pudimos actualizar la contraseña.' },
      { status: 500 }
    );
  }
}
