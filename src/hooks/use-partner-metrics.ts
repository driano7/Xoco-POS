'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PartnerMetrics } from '@/lib/api';
import { fetchPartnerMetrics } from '@/lib/api';

interface UsePartnerMetricsResult {
  metrics: PartnerMetrics | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setDays: (days: number) => void;
  selectedDays: number;
}

export function usePartnerMetrics(initialDays = 30): UsePartnerMetricsResult {
  const [metrics, setMetrics] = useState<PartnerMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState(initialDays);

  const loadMetrics = useCallback(async (daysParam = selectedDays) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchPartnerMetrics(daysParam);
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar métricas');
    } finally {
      setIsLoading(false);
    }
  }, [selectedDays]);

  useEffect(() => {
    void loadMetrics(selectedDays);
  }, [loadMetrics, selectedDays]);

  return {
    metrics,
    isLoading,
    error,
    refresh: () => loadMetrics(selectedDays),
    setDays: (days: number) => setSelectedDays(days),
    selectedDays,
  };
}
