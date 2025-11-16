'use client';

import { useEffect, useState } from 'react';
import type { TransactionHistoryEntry } from '@/lib/api';
import { fetchTransactionsHistory } from '@/lib/api';

interface UseTransactionsResult {
  transactions: TransactionHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTransactions(): UseTransactionsResult {
  const [transactions, setTransactions] = useState<TransactionHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTransactions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchTransactionsHistory();
      setTransactions(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Error desconocido al cargar las transacciones'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTransactions();
  }, []);

  return {
    transactions,
    isLoading,
    error,
    refresh: loadTransactions,
  };
}
