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
  availableMonths: Array<{ month: string; label: string }>;
  selectedMonth: string | null;
  setMonth: (month: string | null) => void;
  useRange: boolean;
  setUseRange: (value: boolean) => void;
}

export function usePartnerMetrics(initialDays = 30): UsePartnerMetricsResult {
  const [metrics, setMetrics] = useState<PartnerMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState(initialDays);
  const [availableMonths, setAvailableMonths] = useState<Array<{ month: string; label: string }>>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [useRange, setUseRange] = useState(true);

  const loadMetrics = useCallback(
    async (options: { days: number; month: string | null; useRange: boolean }) => {
      setIsLoading(true);
      setError(null);
      try {
        const query = options.useRange
          ? { days: options.days }
          : { month: options.month ?? undefined };
        const data = await fetchPartnerMetrics(query);
        setMetrics(data);
        setAvailableMonths(data.availableMonths ?? []);
        if (!options.useRange) {
          const resolvedMonth =
            data.selectedMonth ??
            options.month ??
            data.availableMonths?.[0]?.month ??
            null;
          setSelectedMonth(resolvedMonth);
        } else {
          setSelectedMonth(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido al cargar métricas');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadMetrics({
      days: selectedDays,
      month: selectedMonth,
      useRange,
    });
  }, [loadMetrics, selectedDays, selectedMonth, useRange]);

  const handleSetDays = (days: number) => {
    setSelectedDays(days);
    setUseRange(true);
  };

  const handleSetMonth = (month: string | null) => {
    setSelectedMonth(month);
    setUseRange(false);
  };

  return {
    metrics,
    isLoading,
    error,
    refresh: () => loadMetrics({ days: selectedDays, month: selectedMonth, useRange }),
    setDays: handleSetDays,
    selectedDays,
    availableMonths,
    selectedMonth,
    setMonth: handleSetMonth,
    useRange,
    setUseRange: (value: boolean) => {
      setUseRange(value);
    },
  };
}
