/*
 * --------------------------------------------------------------------
 *  Xoco POS — Point of Sale System
 *  Software Property of Xoco Café
 *  Copyright (c) 2025 Xoco Café
 *  Principal Developer: Donovan Riaño
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at:
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 *  --------------------------------------------------------------------
 *  PROPIEDAD DEL SOFTWARE — XOCO CAFÉ.
 *  Sistema Xoco POS — Punto de Venta.
 *  Desarrollador Principal: Donovan Riaño.
 *
 *  Este archivo está licenciado bajo Apache License 2.0.
 *  Consulta el archivo LICENSE en la raíz del proyecto para más detalles.
 * --------------------------------------------------------------------
 */

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
