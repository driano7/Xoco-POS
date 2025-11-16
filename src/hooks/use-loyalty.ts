'use client';

import { useEffect, useState } from 'react';
import type { LoyaltyStats } from '@/lib/api';
import { fetchLoyaltyStats } from '@/lib/api';

interface UseLoyaltyResult {
  stats: LoyaltyStats | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useLoyalty(): UseLoyaltyResult {
  const [stats, setStats] = useState<LoyaltyStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchLoyaltyStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar lealtad');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadStats();
  }, []);

  return {
    stats,
    isLoading,
    error,
    refresh: loadStats,
  };
}
