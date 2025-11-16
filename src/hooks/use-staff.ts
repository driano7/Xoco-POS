'use client';

import { useEffect, useState } from 'react';
import type { StaffDashboard } from '@/lib/api';
import { fetchStaffDashboard } from '@/lib/api';

interface UseStaffResult {
  staffData: StaffDashboard | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useStaff(): UseStaffResult {
  const [staffData, setStaffData] = useState<StaffDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStaff = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchStaffDashboard();
      setStaffData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar staff');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadStaff();
  }, []);

  return {
    staffData,
    isLoading,
    error,
    refresh: loadStaff,
  };
}
