'use client';

import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { SearchableDropdown } from '@/components/searchable-dropdown';
import { useMenuOptions } from '@/hooks/use-menu-options';
import { useCartStore } from '@/hooks/use-cart-store';

const formatCurrency = (value?: number | null) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value ?? 0);

const TIP_PRESETS = [5, 10, 15, 20];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const PUBLIC_SALE_CLIENT_ID = (process.env.NEXT_PUBLIC_PUBLIC_SALE_CLIENT_ID ?? 'AAA-1111').trim();
const PUBLIC_SALE_USER_ID =
  (process.env.NEXT_PUBLIC_PUBLIC_SALE_USER_ID ?? process.env.NEXT_PUBLIC_PUBLIC_SALE_CLIENT_ID)?.trim() ??
  'AAA-1111';
const PUBLIC_SALE_CLIENT_ID_LOWER = PUBLIC_SALE_CLIENT_ID.toLowerCase();

const generateTicketCode = () => {
  const digits = Array.from({ length: 2 }, () => DIGITS[Math.floor(Math.random() * DIGITS.length)]);
  const letters = Array.from({ length: 3 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]);
  return `XL-${digits.join('')}${letters.join('')}`;
};

const parsePositiveNumber = (value: string) => {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

type ValidatedCustomer = {
  id: string | null;
  clientId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

interface NewOrderModalProps {
  onClose: () => void;
  onSuccess?: () => Promise<void> | void;
  prefillClientId?: string | null;
}

export function NewOrderModal({ onClose, onSuccess, prefillClientId }: NewOrderModalProps) {
  const {
    items,
    itemCount,
    subtotal,
    addItem,
    increment,
    decrement,
    removeItem,
    clearCart,
  } = useCartStore();
  const { beverageOptions, foodOptions, getMenuItemById, isLoading: menuLoading, error: menuError } =
    useMenuOptions();
  const [notes, setNotes] = useState('');
  const [selectedBeverage, setSelectedBeverage] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<string | null>(null);
  const [tipSelection, setTipSelection] = useState<'preset' | 'custom' | null>(null);
  const [selectedTipPercent, setSelectedTipPercent] = useState<number | null>(null);
  const [customTipPercent, setCustomTipPercent] = useState('');
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [useCustomTipAmount, setUseCustomTipAmount] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');
  const [validatedCustomer, setValidatedCustomer] = useState<ValidatedCustomer | null>(null);
  const [validatedIdentifier, setValidatedIdentifier] = useState<string | null>(null);
  const [clientLookupState, setClientLookupState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [clientLookupError, setClientLookupError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPublicSale, setIsPublicSale] = useState(false);

  useEffect(() => () => clearCart(), [clearCart]);

  useEffect(() => {
    const trimmed = prefillClientId?.trim();
    if (!trimmed) {
      setIsPublicSale(false);
      return;
    }
    if (trimmed.toLowerCase() === PUBLIC_SALE_CLIENT_ID_LOWER) {
      setIsPublicSale(true);
      setClientIdInput(PUBLIC_SALE_CLIENT_ID);
      setValidatedCustomer(null);
      setValidatedIdentifier(null);
      setClientLookupState('idle');
      setClientLookupError(null);
      return;
    }
    setIsPublicSale(false);
    setClientIdInput(trimmed);
    setValidatedCustomer(null);
    setValidatedIdentifier(null);
    setClientLookupState('idle');
    setClientLookupError(null);
  }, [prefillClientId]);

  const handleQuickAdd = (productId: string) => {
    const menuItem = getMenuItemById(productId);
    if (!menuItem) {
      setFormError('No encontramos ese producto en el menú.');
      return;
    }
    addItem({
      productId: menuItem.id,
      name: menuItem.label,
      price: menuItem.price ?? 0,
      quantity: 1,
      category: menuItem.category,
      subcategory: menuItem.subcategory,
    });
    setFormError(null);
  };

  const canSubmit = items.length > 0 && !isSubmitting;

  const parsedCustomPercent = useMemo(() => parsePositiveNumber(customTipPercent), [customTipPercent]);
  const parsedCustomAmount = useMemo(() => parsePositiveNumber(customTipAmount), [customTipAmount]);

  const { tipAmount, appliedPercent } = useMemo(() => {
    let percent: number | null = null;
    let amount = 0;
    if (tipSelection === 'preset' && typeof selectedTipPercent === 'number') {
      percent = selectedTipPercent;
      amount = subtotal * (selectedTipPercent / 100);
    } else if (tipSelection === 'custom') {
      if (useCustomTipAmount) {
        if (parsedCustomAmount !== null) {
          amount = parsedCustomAmount;
          percent = subtotal > 0 ? (parsedCustomAmount / subtotal) * 100 : null;
        }
      } else if (parsedCustomPercent !== null) {
        percent = parsedCustomPercent;
        amount = subtotal * (parsedCustomPercent / 100);
      }
    }
    return {
      tipAmount: Number.isFinite(amount) ? Math.max(0, amount) : 0,
      appliedPercent: percent,
    };
  }, [
    parsedCustomAmount,
    parsedCustomPercent,
    selectedTipPercent,
    subtotal,
    tipSelection,
    useCustomTipAmount,
  ]);

const totalWithTip = subtotal + tipAmount;

const getClientLabel = (customer: ValidatedCustomer | null) => {
  if (!customer) {
    return null;
  }
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
  return name || customer.email || customer.clientId;
};

  const resetFormState = () => {
    clearCart();
    setNotes('');
    setSelectedBeverage(null);
    setSelectedFood(null);
    setTipSelection(null);
    setSelectedTipPercent(null);
    setCustomTipPercent('');
    setCustomTipAmount('');
    setUseCustomTipAmount(false);
    setClientIdInput('');
    setValidatedCustomer(null);
    setValidatedIdentifier(null);
    setClientLookupError(null);
    setClientLookupState('idle');
    setFormError(null);
    setIsPublicSale(false);
  };

  const handleClientLookup = async () => {
    if (isPublicSale) {
      return;
    }
    const trimmed = clientIdInput.trim();
    if (!trimmed) {
      setClientLookupState('error');
      setClientLookupError('Ingresa un ID antes de validar.');
      setValidatedCustomer(null);
      setValidatedIdentifier(null);
      return;
    }
    setClientLookupState('loading');
    setClientLookupError(null);
    try {
      const response = await fetch(`/api/customers/lookup?clientId=${encodeURIComponent(trimmed)}`, {
        cache: 'no-store',
      });
      const result = (await response.json()) as { success: boolean; error?: string; data?: ValidatedCustomer };
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || 'No pudimos validar al cliente.');
      }
      setValidatedCustomer(result.data);
      setValidatedIdentifier(trimmed.toLowerCase());
      setClientLookupState('success');
    } catch (error) {
      setValidatedCustomer(null);
      setValidatedIdentifier(null);
      setClientLookupState('error');
      setClientLookupError(
        error instanceof Error ? error.message : 'Error desconocido al validar el cliente.'
      );
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!items.length) {
      setFormError('Agrega al menos un artículo antes de crear el pedido.');
      return;
    }
    const trimmedClientId = clientIdInput.trim();
    const isUsingPublicSaleId =
      isPublicSale && trimmedClientId.toLowerCase() === PUBLIC_SALE_CLIENT_ID_LOWER;
    if (trimmedClientId && !isUsingPublicSaleId && trimmedClientId.toLowerCase() !== validatedIdentifier) {
      setFormError('Valida el ID del cliente antes de registrar el pedido.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const ticketCode = generateTicketCode();

    const fallbackUserId = isUsingPublicSaleId ? PUBLIC_SALE_USER_ID : undefined;
    const payload = {
      ticketCode,
      status: 'pending',
      currency: 'MXN',
        items: items.map((item) => ({
          productId: item.productId,
          name: item.name,
          category: item.category,
          subcategory: item.subcategory,
          quantity: item.quantity,
          price: item.price,
        })),
        totals: {
          subtotal,
          tax: 0,
          tip: tipAmount,
          total: totalWithTip,
        },
        tip: {
          amount: tipAmount,
          percent: appliedPercent,
        },
        userId: validatedCustomer?.id ?? fallbackUserId ?? undefined,
        clientId: trimmedClientId || undefined,
        metadata: notes.trim() || undefined,
      };

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'No pudimos crear el pedido.');
      }

      const result = (await response.json()) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Error desconocido al crear el pedido.');
      }

      resetFormState();
      await onSuccess?.();
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'No pudimos registrar el nuevo pedido.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 text-sm max-h-[75vh] overflow-y-auto pr-2">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.35em] text-primary-500">Pedido manual</p>
        <h2 className="text-2xl font-semibold text-primary-700 dark:text-primary-100">
          Crear nuevo ticket
        </h2>
        <p className="text-[var(--brand-muted)]">
          Selecciona bebidas y alimentos desde el contenido editorial y genera el ticket POS.
        </p>
        {menuLoading && (
          <p className="text-xs text-[var(--brand-muted)]">
            Sincronizando catálogo con Supabase…
          </p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <SearchableDropdown
          id="new-order-beverage"
          label="Bebidas"
          options={beverageOptions}
          placeholder="Busca por nombre o categoría"
          helperText="Selecciona y se agregará automáticamente al carrito"
          value={selectedBeverage}
          onChange={(selectedId) => {
            setSelectedBeverage(selectedId);
            if (selectedId) {
              handleQuickAdd(selectedId);
              setSelectedBeverage(null);
            }
          }}
          allowClear
        />
        <SearchableDropdown
          id="new-order-food"
          label="Alimentos"
          options={foodOptions}
          placeholder="Busca snacks, postres o brunch"
          helperText="Agrega panadería, postres o brunch"
          value={selectedFood}
          onChange={(selectedId) => {
            setSelectedFood(selectedId);
            if (selectedId) {
              handleQuickAdd(selectedId);
              setSelectedFood(null);
            }
          }}
          allowClear
        />
      </div>
      {menuError && (
        <p className="rounded-2xl border border-danger-200/80 bg-danger-50/70 px-4 py-2 text-xs text-danger-600 dark:border-danger-500/30 dark:bg-danger-900/30 dark:text-danger-100">
          {menuError}
        </p>
      )}

      <div className="rounded-2xl border border-primary-100/70 bg-primary-50/60 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-primary-700 dark:text-primary-100">
            Carrito ({itemCount})
          </p>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" onClick={clearCart} className="brand-button--ghost">
              Vaciar
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-primary-200/60 px-3 py-2 text-xs text-[var(--brand-muted)]">
            Agrega artículos desde los catálogos editoriales.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {items.map((item) => (
              <li
                key={item.productId}
                className="flex items-center justify-between rounded-xl border border-primary-100/70 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-transparent"
              >
                <div>
                  <p className="font-semibold text-primary-700 dark:text-primary-50">{item.name}</p>
                  <p className="text-xs text-[var(--brand-muted)]">
                    {item.category ?? 'Especialidad'} · {formatCurrency(item.price)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => decrement(item.productId)}
                    className="rounded-full border border-primary-200 px-2 py-1 text-xs font-semibold text-primary-600 transition hover:border-primary-400"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-semibold">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => increment(item.productId)}
                    className="rounded-full border border-primary-200 px-2 py-1 text-xs font-semibold text-primary-600 transition hover:border-primary-400"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId)}
                    className="text-xs font-semibold text-danger-500"
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
            <span className="font-semibold">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Propina</span>
            <span className="font-semibold text-primary-600">{formatCurrency(tipAmount)}</span>
          </div>
          <div className="flex items-center justify-between text-base font-semibold text-primary-700">
            <span>Total con propina</span>
            <span>{formatCurrency(totalWithTip)}</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <p className="text-sm font-semibold text-primary-700 dark:text-primary-100">
          ID de cliente (opcional)
        </p>
        <p className="text-xs text-[var(--brand-muted)]">
          Vincula el ticket al historial del cliente para conservar sus cafés acumulados.
        </p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <input
            value={clientIdInput}
            onChange={(event) => {
              setClientIdInput(event.target.value);
              setValidatedCustomer(null);
              setValidatedIdentifier(null);
              setClientLookupError(null);
              setClientLookupState('idle');
              setIsPublicSale(false);
            }}
            placeholder="ID del cliente o folio de lealtad"
            disabled={isPublicSale}
            className="flex-1 rounded-xl border border-primary-100/70 px-3 py-2 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-white"
          />
          <div className="flex flex-col gap-2 text-xs">
            <label className="inline-flex items-center gap-2 font-semibold text-[var(--brand-muted)]">
              <input
                type="checkbox"
                checked={isPublicSale}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setIsPublicSale(checked);
                  if (checked) {
                    setClientIdInput(PUBLIC_SALE_CLIENT_ID);
                    setValidatedCustomer(null);
                    setValidatedIdentifier(null);
                    setClientLookupError(null);
                    setClientLookupState('idle');
                  } else {
                    setClientIdInput('');
                    setValidatedCustomer(null);
                    setValidatedIdentifier(null);
                    setClientLookupError(null);
                    setClientLookupState('idle');
                  }
                }}
                className="h-4 w-4 rounded border-primary-300 text-primary-600 focus:ring-primary-500"
              />
              Venta al público (ID {PUBLIC_SALE_CLIENT_ID})
            </label>
            <button
              type="button"
              onClick={() => void handleClientLookup()}
              className="brand-button text-xs"
              disabled={clientLookupState === 'loading' || isPublicSale}
            >
              {clientLookupState === 'loading' ? 'Validando…' : 'Validar ID'}
            </button>
          </div>
        </div>
        {isPublicSale ? (
          <div className="mt-2 rounded-xl border border-primary-200/70 bg-primary-50/70 px-3 py-2 text-xs text-primary-700 dark:border-white/20 dark:bg-white/5 dark:text-white">
            Venta al público activada · ID {PUBLIC_SALE_CLIENT_ID}
          </div>
        ) : clientLookupState === 'success' && validatedCustomer ? (
          <div className="mt-2 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-900/30 dark:text-emerald-100">
            Cliente encontrado: {getClientLabel(validatedCustomer)} · ID{' '}
            {validatedCustomer.clientId ?? validatedCustomer.id}
          </div>
        ) : null}
        {clientLookupState === 'error' && clientLookupError && (
          <div className="mt-2 rounded-xl border border-danger-200/70 bg-danger-50/70 px-3 py-2 text-xs text-danger-700 dark:border-danger-500/30 dark:bg-danger-900/30 dark:text-danger-100">
            {clientLookupError}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-primary-700 dark:text-primary-100">
            Propinas sugeridas
          </p>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2 text-xs">
          {TIP_PRESETS.map((percent) => {
            const isActive = tipSelection === 'preset' && selectedTipPercent === percent;
            return (
              <button
                type="button"
                key={percent}
                onClick={() => {
                  setTipSelection('preset');
                  setSelectedTipPercent(percent);
                  setCustomTipPercent('');
                  setCustomTipAmount('');
                }}
                className={`rounded-2xl border px-2 py-1 font-semibold transition ${
                  isActive
                    ? 'border-primary-500 bg-primary-100 text-primary-700'
                    : 'border-primary-100 hover:border-primary-200'
                }`}
              >
                {percent}%
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setTipSelection('custom');
              setSelectedTipPercent(null);
            }}
            className={`rounded-2xl border px-2 py-1 font-semibold transition ${
              tipSelection === 'custom'
                ? 'border-primary-500 bg-primary-100 text-primary-700'
                : 'border-primary-100 hover:border-primary-200'
            }`}
          >
            Otro
          </button>
        </div>
        {tipSelection === 'custom' && (
          <>
            <label className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-[var(--brand-muted)]">
              <input
                type="checkbox"
                checked={useCustomTipAmount}
                onChange={(event) => {
                  setUseCustomTipAmount(event.target.checked);
                  setCustomTipPercent('');
                  setCustomTipAmount('');
                }}
                className="h-4 w-4 rounded border-primary-300 text-primary-600 focus:ring-primary-500"
              />
              Capturar propina como monto en MXN
            </label>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">
                Porcentaje
                <input
                  value={customTipPercent}
                  onChange={(event) => setCustomTipPercent(event.target.value)}
                  placeholder="0%"
                  type="number"
                  min="0"
                  step="0.5"
                  disabled={useCustomTipAmount}
                  className="rounded-xl border border-primary-100/70 px-3 py-2 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none disabled:opacity-40 dark:border-white/20 dark:bg-white/5 dark:text-white"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">
                Monto MXN
                <input
                  value={customTipAmount}
                  onChange={(event) => setCustomTipAmount(event.target.value)}
                  placeholder="$0.00"
                  type="number"
                  min="0"
                  step="0.5"
                  disabled={!useCustomTipAmount}
                  className="rounded-xl border border-primary-100/70 px-3 py-2 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none disabled:opacity-40 dark:border-white/20 dark:bg-white/5 dark:text-white"
                />
              </label>
            </div>
          </>
        )}
        <p className="mt-3 text-xs text-[var(--brand-muted)]">
          Propina aplicada: <span className="font-semibold">{formatCurrency(tipAmount)}</span>
          {typeof appliedPercent === 'number' && ` (${appliedPercent.toFixed(1)}%)`}
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">
        Notas
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Instrucciones para barra o cocina"
          className="min-h-[90px] rounded-2xl border border-primary-100/70 px-3 py-2 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-white"
        />
      </label>

      {formError && (
        <p className="rounded-2xl border border-danger-200/80 bg-danger-50/60 px-3 py-2 text-xs text-danger-700 dark:border-danger-500/40 dark:bg-danger-900/30 dark:text-danger-100">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!canSubmit} className="brand-button px-6 disabled:opacity-40">
          {isSubmitting ? 'Creando pedido…' : 'Registrar pedido'}
        </button>
        <button type="button" onClick={onClose} className="brand-button--ghost">
          Cancelar
        </button>
      </div>
    </form>
  );
}
