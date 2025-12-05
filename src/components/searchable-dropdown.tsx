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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { MenuItem } from '@/hooks/use-menu-options';

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

interface SearchableDropdownProps {
  id: string;
  label: string;
  options: MenuItem[];
  value?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  helperText?: string;
  allowClear?: boolean;
}

const formatCurrency = (value?: number | null) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value ?? 0);

export function SearchableDropdown({
  id,
  label,
  options,
  value = null,
  onChange,
  placeholder = 'Busca por nombre o categoría',
  helperText,
  allowClear = false,
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const normalizedQuery = query.trim() ? normalize(query.trim()) : '';

  const sortedOptions = useMemo(
    () =>
      [...options].sort((a, b) => {
        const byLabel = a.label.localeCompare(b.label, 'es-MX');
        if (byLabel !== 0) {
          return byLabel;
        }
        const sizeA = a.sizeLabel ?? '';
        const sizeB = b.sizeLabel ?? '';
        return sizeA.localeCompare(sizeB, 'es-MX');
      }),
    [options]
  );

  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) {
      return sortedOptions;
    }
    return sortedOptions.filter((option) => {
      const haystack = [option.label, option.category, option.subcategory, option.sizeLabel]
        .filter(Boolean)
        .join(' ');
      return normalize(haystack).includes(normalizedQuery);
    });
  }, [normalizedQuery, sortedOptions]);

  const selectedOption = useMemo(
    () => sortedOptions.find((option) => option.id === value) ?? null,
    [sortedOptions, value]
  );

  const resetQueryState = useCallback(() => {
    setQuery('');
    setActiveIndex(0);
  }, []);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    resetQueryState();
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, [resetQueryState]);

  const openDropdown = useCallback(() => {
    setIsOpen(true);
    const selectedIndex = sortedOptions.findIndex((option) => option.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [sortedOptions, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [closeDropdown, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setActiveIndex((index) => {
      if (!filteredOptions.length) {
        return 0;
      }
      return Math.min(index, filteredOptions.length - 1);
    });
  }, [filteredOptions.length, isOpen]);

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (isOpen) {
        closeDropdown();
      } else {
        openDropdown();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      setActiveIndex((index) => Math.min(filteredOptions.length - 1, index + 1));
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(filteredOptions.length - 1, index + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = filteredOptions[activeIndex];
      if (option) {
        onChange(option.id);
        closeDropdown();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDropdown();
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const optionNode = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`
    );
    optionNode?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const handleOptionClick = (optionId: string) => {
    onChange(optionId);
    closeDropdown();
  };

  const clearSelection = () => {
    onChange(null);
    resetQueryState();
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      requestAnimationFrame(() => buttonRef.current?.focus());
    }
  };

  return (
    <div ref={containerRef} className="space-y-1 text-sm" id={id}>
      <label className="block text-xs font-semibold uppercase tracking-[0.35em] text-[var(--brand-muted)]">
        {label}
      </label>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? closeDropdown() : openDropdown())}
        onKeyDown={handleButtonKeyDown}
        className="flex w-full items-center justify-between rounded-2xl border border-primary-100/70 bg-white/80 px-4 py-3 text-left text-sm text-[var(--brand-text)] transition hover:border-primary-300 focus:border-primary-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`${id}-listbox`}
      >
        <span className="flex flex-col">
          <span className="truncate font-semibold">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption && (
            <span className="text-xs text-[var(--brand-muted)]">
              {selectedOption.sizeLabel ? `${selectedOption.sizeLabel} · ` : ''}
              {formatCurrency(selectedOption.price)}
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 transition ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
        >
          <path d="M6 8l4 4 4-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {helperText && <p className="text-xs text-[var(--brand-muted)]">{helperText}</p>}
      {isOpen && (
        <div className="relative z-10">
          <div className="absolute mt-2 w-full rounded-2xl border border-primary-100/80 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#1b1b1b]">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={placeholder}
                className="flex-1 rounded-xl border border-primary-100/70 px-3 py-2 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-white"
              />
              {allowClear && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs font-semibold text-primary-600 hover:underline disabled:opacity-40"
                  disabled={!value}
                >
                  Limpiar
                </button>
              )}
            </div>
            <div
              ref={listRef}
              id={`${id}-listbox`}
              role="listbox"
              aria-activedescendant={`${id}-option-${activeIndex}`}
              className="mt-3 max-h-60 space-y-1 overflow-auto rounded-xl border border-primary-50/70 bg-white/90 p-2 text-sm dark:border-white/10 dark:bg-white/5"
            >
              {filteredOptions.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-[var(--brand-muted)]">
                  No hay resultados
                </p>
              ) : (
                filteredOptions.map((option, index) => {
                  const isActive = index === activeIndex;
                  const isSelected = option.id === value;
                  return (
                    <button
                      type="button"
                      role="option"
                      id={`${id}-option-${index}`}
                      data-index={index}
                      aria-selected={isSelected}
                      key={option.id}
                        onClick={() => handleOptionClick(option.id)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition focus:outline-none ${
                        isActive
                          ? 'border-primary-400 bg-primary-50 text-primary-700'
                          : 'border-transparent hover:border-primary-200 hover:bg-primary-50/80'
                      } ${isSelected ? 'font-semibold' : ''}`}
                    >
                      <div>
                        <p className="font-semibold text-primary-700 dark:text-primary-100">{option.label}</p>
                        <p className="text-xs text-[var(--brand-muted)]">
                          {option.sizeLabel ? `${option.sizeLabel} · ` : ''}
                          {typeof option.price === 'number'
                            ? formatCurrency(option.price)
                            : 'Precio no registrado'}
                          {typeof option.calories === 'number' ? ` · ${option.calories} kcal` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-primary-500 capitalize">
                          {option.category ?? 'Sin categoría'}
                        </span>
                        {option.subcategory && (
                          <p className="text-[10px] uppercase tracking-wider text-[var(--brand-muted)]">
                            {option.subcategory}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
