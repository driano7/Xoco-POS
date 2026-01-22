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

import { useState, useEffect, useCallback } from 'react';
import { useCatalog } from '@/hooks/use-catalog';
import { useAuth } from '@/providers/auth-provider';
import { useMenuOptions } from '@/hooks/use-menu-options';
import type { MenuItem } from '@/hooks/use-menu-options';

type ProductType = 'beverage' | 'food' | 'package';
type AvailabilityStatus = 'available' | 'low_stock' | 'unavailable';

interface AvailabilityItem {
  id: string;
  productId: string;
  productType: ProductType;
  label: string;
  category?: string | undefined;
  subcategory?: string | null;
  availabilityStatus: AvailabilityStatus;
  reason?: string | null;
  lastModified?: string;
  modifiedBy?: string;
}

interface AvailabilitySection {
  type: ProductType;
  title: string;
  icon: string;
  items: AvailabilityItem[];
  stats: {
    total: number;
    available: number;
    unavailable: number;
  };
}

const PRODUCT_TYPE_CONFIG = {
  beverage: {
    title: 'Bebidas',
    icon: '☕',
    color: 'bg-blue-50 border-blue-200 text-blue-700',
  },
  food: {
    title: 'Alimentos',
    icon: '🍽',
    color: 'bg-green-50 border-green-200 text-green-700',
  },
  package: {
    title: 'Paquetes',
    icon: '📦',
    color: 'bg-purple-50 border-purple-200 text-purple-700',
  },
} as const;

const AvailabilitySection = ({ section, onUpdateAvailability }: { 
  section: AvailabilitySection; 
  onUpdateAvailability: (productId: string, productType: ProductType, availabilityStatus: AvailabilityStatus, reason: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{section.icon}</span>
          <div>
            <h3 className="text-lg font-semibold text-primary-900 dark:text-white">
              {section.title}
            </h3>
            <div className="flex gap-4 text-sm text-[var(--brand-muted)]">
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>{section.stats.available} disponibles</span>
              </span>
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                <span>{section.stats.unavailable} no disponibles</span>
              </span>
              <span>Total: {section.stats.total}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-sm text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200"
        >
          {isExpanded ? 'Ocultar' : 'Mostrar'} detalles
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-2">
          {section.items.length === 0 ? (
            <p className="text-sm text-[var(--brand-muted)] italic">
              No hay productos de este tipo configurados.
            </p>
          ) : (
            <div className="grid gap-2">
              {section.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 p-3 bg-white dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="flex-1">
                    <p className="font-medium text-primary-900 dark:text-white">
                      {item.label}
                    </p>
                    <p className="text-sm text-[var(--brand-muted)]">
                      {item.category && `${item.category} • `}
                      {item.subcategory || 'Sin subcategoría'}
                    </p>
                    {item.lastModified && (
                      <p className="text-xs text-[var(--brand-muted)]">
                        Última modificación: {new Date(item.lastModified).toLocaleString('es-MX')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onUpdateAvailability(item.id, item.productType, 'available', 'Disponible')}
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                          item.availabilityStatus === 'available'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => onUpdateAvailability(item.id, item.productType, 'low_stock', 'Poca disponibilidad')}
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                          item.availabilityStatus === 'low_stock'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        ⚠
                      </button>
                      <button
                        onClick={() => onUpdateAvailability(item.id, item.productType, 'unavailable', 'Sin disponibilidad')}
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                          item.availabilityStatus === 'unavailable'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        ✗
                      </button>
                    </div>
                    {item.reason && (
                      <div className="text-xs text-[var(--brand-muted)] max-w-32 text-right">
                        {item.reason}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const AvailabilityPanel = () => {
  const { user } = useAuth();
  const { beverageOptions, foodOptions, packageOptions } = useMenuOptions();
  const [availabilityData, setAvailabilityData] = useState<Record<ProductType, AvailabilitySection>>({
    beverage: {
      type: 'beverage',
      title: 'Bebidas',
      icon: '☕',
      items: [],
      stats: { total: 0, available: 0, unavailable: 0 },
    },
    food: {
      type: 'food',
      title: 'Alimentos',
      icon: '🍽',
      items: [],
      stats: { total: 0, available: 0, unavailable: 0 },
    },
    package: {
      type: 'package',
      title: 'Paquetes',
      icon: '📦',
      items: [],
      stats: { total: 0, available: 0, unavailable: 0 },
    },
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Función para obtener la disponibilidad desde la BD
  const fetchAvailability = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/availability', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Error al cargar disponibilidad');
      }
      
      const data = await response.json();
      setAvailabilityData(data.data || data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Función para cambiar disponibilidad
  const handleUpdateAvailability = async (
    productId: string,
    productType: ProductType,
    availabilityStatus: AvailabilityStatus,
    reason: string
  ) => {
    if (!user) return;
    
    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId,
          productType,
          availabilityStatus,
          reason,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Error al actualizar disponibilidad');
      }
      
      // Recargar datos después de actualizar
      await fetchAvailability();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar disponibilidad');
      setTimeout(() => setError(null), 3000);
    }
  };

  // Mapear opciones del menú a datos de disponibilidad
  const mapMenuOptionsToAvailability = (
    options: MenuItem[],
    productType: ProductType
  ): AvailabilityItem[] => {
    return options.map((option) => ({
      id: option.id,
      productId: option.productId,
      productType,
      label: option.label,
      category: option.category || undefined,
      subcategory: option.subcategory || null,
      availabilityStatus: 'available', // Por defecto, hasta cargar de BD
      reason: null,
      lastModified: undefined,
      modifiedBy: undefined,
    }));
  };

  useEffect(() => {
    if (user) {
      fetchAvailability();
    }
  }, [user, fetchAvailability]);

  // Si no hay datos de BD, usar datos de los dropdowns
  if (!isLoading && !error && availabilityData.beverage.items.length === 0) {
    const beverageItems = mapMenuOptionsToAvailability(beverageOptions, 'beverage');
    const foodItems = mapMenuOptionsToAvailability(foodOptions, 'food');
    const packageItems = mapMenuOptionsToAvailability(packageOptions, 'package');

    availabilityData.beverage.items = beverageItems;
    availabilityData.beverage.stats = {
      total: beverageItems.length,
      available: beverageItems.filter(item => item.availabilityStatus === 'available').length,
      unavailable: beverageItems.filter(item => item.availabilityStatus === 'unavailable').length,
    };

    availabilityData.food.items = foodItems;
    availabilityData.food.stats = {
      total: foodItems.length,
      available: foodItems.filter(item => item.availabilityStatus === 'available').length,
      unavailable: foodItems.filter(item => item.availabilityStatus === 'unavailable').length,
    };

    availabilityData.package.items = packageItems;
    availabilityData.package.stats = {
      total: packageItems.length,
      available: packageItems.filter(item => item.availabilityStatus === 'available').length,
      unavailable: packageItems.filter(item => item.availabilityStatus === 'unavailable').length,
    };
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <p className="text-lg text-[var(--brand-muted)]">
          Inicia sesión para acceder al panel de disponibilidad.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-primary-900 dark:text-white">
            📊 Disponibilidad de Productos
          </h2>
          <p className="text-sm text-[var(--brand-muted)]">
            Gestiona la disponibilidad de bebidas, alimentos y paquetes del menú
          </p>
        </div>
        <button
          onClick={fetchAvailability}
          disabled={isLoading}
          className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Actualizando...' : '🔄 Actualizar'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">❌ {error}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <AvailabilitySection section={availabilityData.beverage} onUpdateAvailability={handleUpdateAvailability} />
        <AvailabilitySection section={availabilityData.food} onUpdateAvailability={handleUpdateAvailability} />
        <AvailabilitySection section={availabilityData.package} onUpdateAvailability={handleUpdateAvailability} />
      </div>
    </div>
  );
};

export default AvailabilityPanel;
