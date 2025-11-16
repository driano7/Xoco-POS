'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
    () => [...options].sort((a, b) => a.label.localeCompare(b.label, 'es-MX')),
    [options]
  );

  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) {
      return sortedOptions;
    }
    return sortedOptions.filter((option) => {
      const haystack = [option.label, option.category, option.subcategory]
        .filter(Boolean)
        .join(' ');
      return normalize(haystack).includes(normalizedQuery);
    });
  }, [normalizedQuery, sortedOptions]);

  const selectedOption = useMemo(
    () => sortedOptions.find((option) => option.id === value) ?? null,
    [sortedOptions, value]
  );

  const resetQueryState = () => {
    setQuery('');
    setActiveIndex(0);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    resetQueryState();
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const openDropdown = () => {
    setIsOpen(true);
    const selectedIndex = sortedOptions.findIndex((option) => option.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  };

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
  }, [isOpen]);

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
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.price !== undefined && selectedOption?.price !== null && (
            <span className="text-xs text-[var(--brand-muted)]">{formatCurrency(selectedOption.price)}</span>
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
                          {typeof option.price === 'number'
                            ? formatCurrency(option.price)
                            : 'Precio no registrado'}
                          {typeof option.calories === 'number' ? ` · ${option.calories} kcal` : ''}
                        </p>
                      </div>
                      <span className="text-xs text-primary-500 capitalize">
                        {option.category ?? 'Sin categoría'}
                      </span>
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
