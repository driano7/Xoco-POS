'use client';

import { useEffect, useState } from 'react';
import type { CatalogPayload } from '@/lib/api';
import { fetchCatalog } from '@/lib/api';

interface UseCatalogResult {
  catalog: CatalogPayload | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCatalog(): UseCatalogResult {
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchCatalog();
      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar el catálogo');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  return {
    catalog,
    isLoading,
    error,
    refresh: loadCatalog,
  };
}
