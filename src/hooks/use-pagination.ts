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
