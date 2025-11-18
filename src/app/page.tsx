'use client';

import { PosDashboard } from '@/components/pos-dashboard';
import { LoginPanel } from '@/components/auth/login-panel';
import { useAuth } from '@/providers/auth-provider';

export default function Page() {
  const { user } = useAuth();
  if (!user) {
    return <LoginPanel />;
  }
  return <PosDashboard />;
}
