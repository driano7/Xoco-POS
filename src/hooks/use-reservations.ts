'use client';

import { useEffect, useState } from 'react';
import type { Reservation } from '@/lib/api';
import { fetchReservations } from '@/lib/api';
import { applyReservationStatusRules, purgeExpiredPastReservations } from '@/lib/status-rules';

interface UseReservationsResult {
  reservations: Reservation[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useReservations(): UseReservationsResult {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReservations = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchReservations();
      setReservations(purgeExpiredPastReservations(applyReservationStatusRules(data)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Error desconocido al cargar las reservaciones'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadReservations();
  }, []);

  return {
    reservations,
    isLoading,
    error,
    refresh: loadReservations,
  };
}
