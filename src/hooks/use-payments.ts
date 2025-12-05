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
