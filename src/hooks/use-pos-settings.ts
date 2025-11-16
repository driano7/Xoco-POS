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
