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
import type { PosSettings } from '@/lib/api';
import { fetchPosSettings, updatePosSettings } from '@/lib/api';

interface UsePosSettingsResult {
  settings: PosSettings | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (next: PosSettings) => Promise<void>;
  isSaving: boolean;
  saveError: string | null;
}

export function usePosSettings(): UsePosSettingsResult {
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadSettings = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchPosSettings();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar configuración');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const save = async (next: PosSettings) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await updatePosSettings(next);
      setSettings(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Error desconocido al guardar');
    } finally {
      setIsSaving(false);
    }
  };

  return {
    settings,
    isLoading,
    error,
    refresh: loadSettings,
    save,
    isSaving,
    saveError,
  };
}
