'use client';

import { useEffect, useState } from 'react';
import type { InventoryDashboard } from '@/lib/api';
import { fetchInventoryDashboard } from '@/lib/api';

interface UseInventoryResult {
  inventory: InventoryDashboard | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useInventory(): UseInventoryResult {
  const [inventory, setInventory] = useState<InventoryDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInventory = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchInventoryDashboard();
      setInventory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar inventario');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadInventory();
  }, []);

  return {
    inventory,
    isLoading,
    error,
    refresh: loadInventory,
  };
}
