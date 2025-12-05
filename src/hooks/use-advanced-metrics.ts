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
