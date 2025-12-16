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

import { useEffect, useState } from 'react';
import type { PrepStatus, PrepTask } from '@/lib/api';
import { fetchPrepQueue } from '@/lib/api';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

interface UsePrepQueueResult {
  tasks: PrepTask[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  filterByStatus: (status?: PrepStatus) => Promise<void>;
  activeFilter?: PrepStatus;
}

export function usePrepQueue(): UsePrepQueueResult {
  const [tasks, setTasks] = useState<PrepTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<PrepStatus | undefined>(undefined);
  const [subscriptionReady, setSubscriptionReady] = useState(false);

  const loadQueue = async (filter?: PrepStatus) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchPrepQueue(filter);
      setTasks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido en la cola de producción');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadQueue();
  }, []);

  useEffect(() => {
    if (subscriptionReady) {
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client) {
      return;
    }
    const channel = client
      .channel('pos-prep-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prep_queue' },
        () => void loadQueue(activeFilter)
      );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setSubscriptionReady(true);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        client.removeChannel(channel);
        setSubscriptionReady(false);
      }
    });
    return () => {
      client.removeChannel(channel);
      setSubscriptionReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, subscriptionReady]);

  const filterByStatus = async (status?: PrepStatus) => {
    setActiveFilter(status);
    await loadQueue(status);
  };

  return {
    tasks,
    isLoading,
    error,
    refresh: () => loadQueue(activeFilter),
    filterByStatus,
    activeFilter,
  };
}
