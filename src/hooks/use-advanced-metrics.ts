'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchAdvancedMetrics, type AdvancedMetricsPayload } from '@/lib/api';

interface UseAdvancedMetricsResult {
  metrics: AdvancedMetricsPayload | null;
  isLoading: boolean;
  error: string | null;
  selectedRange: string;
  setRange: (range: string) => void;
  setExtraParams: (params: Record<string, string>) => void;
  refresh: () => Promise<void>;
}

const DEFAULT_RANGE = '14d';

export function useAdvancedMetrics(initialRange = DEFAULT_RANGE): UseAdvancedMetricsResult {
  const [selectedRange, setSelectedRange] = useState(initialRange);
  const [metrics, setMetrics] = useState<AdvancedMetricsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extraParams, setExtraParamsState] = useState<Record<string, string>>({});

  const loadMetrics = useCallback(
    async (range = selectedRange, params = extraParams) => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchAdvancedMetrics(range, params);
        setMetrics(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido al cargar métricas.');
      } finally {
        setIsLoading(false);
      }
    },
    [selectedRange, extraParams]
  );

  useEffect(() => {
    void loadMetrics(selectedRange, extraParams);
  }, [loadMetrics, selectedRange, extraParams]);

  return {
    metrics,
    isLoading,
    error,
    selectedRange,
    setRange: useCallback((range: string) => {
      setSelectedRange(range);
    }, []),
    setExtraParams: useCallback((params: Record<string, string>) => {
      setExtraParamsState(params);
    }, []),
    refresh: () => loadMetrics(selectedRange, extraParams),
  };
}
