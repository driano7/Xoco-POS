import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const STAFF_TABLE = process.env.SUPABASE_STAFF_TABLE ?? 'staff_users';
const SESSIONS_TABLE = process.env.SUPABASE_STAFF_SESSIONS_TABLE ?? 'staff_sessions';
const MAX_STAFF = Number(process.env.STAFF_DASHBOARD_LIMIT ?? 200);
const MAX_SESSIONS = Number(process.env.STAFF_SESSION_LIMIT ?? 100);

export async function GET() {
  try {
    const [{ data: staff, error: staffError }, { data: sessions, error: sessionsError }] =
      await Promise.all([
        supabaseAdmin
          .from(STAFF_TABLE)
          .select(
            'id,email,role,"branchId",is_active,"createdAt","updatedAt","lastLoginAt","firstNameEncrypted","lastNameEncrypted"'
          )
          .order('createdAt', { ascending: false })
          .limit(MAX_STAFF),
        supabaseAdmin
          .from(SESSIONS_TABLE)
          .select(
            'id,"staffId","sessionStart","sessionEnd","durationSeconds","ipAddress","deviceType","createdAt","updatedAt"'
          )
          .order('sessionStart', { ascending: false })
          .limit(MAX_SESSIONS),
      ]);

    if (staffError || sessionsError) {
      const message = staffError?.message || sessionsError?.message || 'Failed to fetch staff data';
      throw new Error(message);
    }

    const normalizedStaff = (staff ?? []).map((member) => ({
      id: member.id,
      email: member.email,
      role: member.role,
      branchId: member.branchId,
      isActive: member.is_active ?? (member as { isActive?: boolean }).isActive ?? true,
      firstNameEncrypted: member.firstNameEncrypted ?? null,
      lastNameEncrypted: member.lastNameEncrypted ?? null,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      lastLoginAt: member.lastLoginAt,
    }));

    const staffMap = new Map(normalizedStaff.map((member) => [member.id, member]));

    const normalizedSessions = (sessions ?? []).map((session) => ({
      ...session,
      staff: session.staffId ? staffMap.get(session.staffId) ?? null : null,
      isActive: !session.sessionEnd,
    }));

    const totalStaff = normalizedStaff.length;
    const activeStaff = normalizedStaff.filter((member) => member.isActive).length;
    const roleMap = new Map<string, number>();

    normalizedStaff.forEach((member) => {
      const key = member.role || 'desconocido';
      roleMap.set(key, (roleMap.get(key) || 0) + 1);
    });

    const roles = Array.from(roleMap.entries()).map(([role, count]) => ({ role, count }));
    const activeSessions = normalizedSessions.filter((session) => session.isActive);

    return NextResponse.json({
      success: true,
      data: {
        staff: normalizedStaff,
        sessions: normalizedSessions,
        metrics: {
          totalStaff,
          activeStaff,
          roles,
          activeSessions: activeSessions.length,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching staff dashboard:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch staff dashboard' },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-dynamic';
