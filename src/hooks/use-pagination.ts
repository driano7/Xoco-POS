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

import { useEffect, useMemo, useState } from 'react';

interface PaginationResult<T> {
  page: number;
  totalPages: number;
  totalItems: number;
  items: T[];
  hasPagination: boolean;
  next: () => void;
  prev: () => void;
}

export function usePagination<T>(items: T[], pageSize = 3): PaginationResult<T> {
  const [page, setPage] = useState(0);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setPage(0);
  }, [totalItems, pageSize]);

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages]);

  const sliced = useMemo(() => {
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const hasPagination = totalItems > pageSize;

  return {
    page,
    totalPages,
    totalItems,
    items: sliced,
    hasPagination,
    next: () => setPage((prev) => Math.min(prev + 1, totalPages - 1)),
    prev: () => setPage((prev) => Math.max(prev - 1, 0)),
  };
}
