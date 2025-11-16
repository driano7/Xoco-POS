'use client';

import { useEffect, useState } from 'react';
import type { PrepStatus, PrepTask } from '@/lib/api';
import { fetchPrepQueue } from '@/lib/api';

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
