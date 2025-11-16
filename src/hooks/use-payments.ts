'use client';

import { useEffect, useState } from 'react';
import type { PaymentsDashboard } from '@/lib/api';
import { fetchPaymentsDashboard } from '@/lib/api';

interface UsePaymentsResult {
  payments: PaymentsDashboard | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePayments(): UsePaymentsResult {
  const [payments, setPayments] = useState<PaymentsDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPayments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchPaymentsDashboard();
      setPayments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar pagos');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPayments();
  }, []);

  return {
    payments,
    isLoading,
    error,
    refresh: loadPayments,
  };
}
