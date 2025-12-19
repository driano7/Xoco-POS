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

import { useState, useEffect, useMemo, useCallback, type FormEvent } from 'react';
import { SearchableDropdown } from '@/components/searchable-dropdown';
import { useMenuOptions } from '@/hooks/use-menu-options';
import { useCartStore, type CartItem } from '@/hooks/use-cart-store';
import type { LoyaltyCustomer } from '@/lib/api';

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

const looksLikeEvmAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value.trim());
const looksLikeEnsName = (value: string) =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(eth|xyz|luxe)$/i.test(value.trim());
const looksLikeLightningInvoice = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/^lightning:/, '');
  return (
    normalized.startsWith('lnbc') ||
    normalized.startsWith('lnurl') ||
    normalized.startsWith('lntb') ||
    normalized.startsWith('lnbcrt')
  );
};
const normalizeLightningReference = (value: string) => value.replace(/^lightning:/i, '');

const normalizeToken = (value?: string | null) =>
  value
    ?.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim() ?? '';

const BEVERAGE_DISPLAY_TOKENS = ['bebida', 'drink', 'coffee', 'cafe', 'café', 'latte', 'espresso'];
const isLikelyBeverageDescriptor = (value?: string | null) => {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return false;
  }
  return BEVERAGE_DISPLAY_TOKENS.some((token) => normalized.includes(token));
};

const detectReferenceType = (value: string) => {
  if (looksLikeEvmAddress(value)) {
    return 'evm_address';
  }
  if (looksLikeEnsName(value)) {
    return 'ens_name';
  }
  if (looksLikeLightningInvoice(value)) {
    return 'lightning_invoice';
  }
  if (/^\d{6,}$/.test(value.trim())) {
    return 'transaction_id';
  }
  return 'text';
};
const requiresPaymentReference = (method?: string | null) => Boolean(method && method !== 'efectivo');
const PAYMENT_REFERENCE_LABELS: Record<string, string> = {
  debito: 'ID de referencia de transacción',
  credito: 'ID de referencia de transacción',
  transferencia: 'ID de transferencia',
  cripto: 'Wallet / ENS / Lightning',
};
const PAYMENT_REFERENCE_PLACEHOLDERS: Record<string, string> = {
  debito: 'Folio impreso por la terminal',
  credito: 'Folio impreso por la terminal',
  transferencia: 'ID o folio del SPEI',
  cripto: '0xABC..., cafecito.eth o lnbc1...',
};
const PAYMENT_REFERENCE_HINTS: Record<string, string> = {
  debito: 'Captura el folio impreso por la terminal bancaria.',
  credito: 'Captura el folio impreso por la terminal bancaria.',
  transferencia: 'Ingresa el identificador del comprobante de transferencia.',
  cripto: 'Aceptamos direcciones 0x, nombres ENS y facturas Lightning.',
};
const isValidCryptoReference = (value: string) =>
  looksLikeEvmAddress(value) || looksLikeEnsName(value) || looksLikeLightningInvoice(value);
const isValidReferenceForMethod = (method: string, reference: string) => {
  const trimmed = reference.trim();
  if (!trimmed) {
    return false;
  }
  if (method === 'cripto') {
    return isValidCryptoReference(trimmed);
  }
  if (method === 'transferencia') {
    return trimmed.length >= 6;
  }
  return trimmed.length >= 4;
};

const isBeverageCartItem = (item: CartItem) => {
  if (item.kind === 'beverage') {
    return true;
  }
  if (item.kind && item.kind !== 'other') {
    return false;
  }
  return (
    isLikelyBeverageDescriptor(item.category) ||
    isLikelyBeverageDescriptor(item.subcategory) ||
    isLikelyBeverageDescriptor(item.name) ||
    isLikelyBeverageDescriptor(item.sizeLabel)
  );
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
  onWalletScanRequest?: (onCapture: (value: string) => void) => void;
  resolveLoyaltyCustomer?: (identifier: string) => LoyaltyCustomer | null;
}

export function NewOrderModal({
  onClose,
  onSuccess,
  prefillClientId,
  onWalletScanRequest,
  resolveLoyaltyCustomer,
}: NewOrderModalProps) {
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
  const {
    beverageOptions,
    foodOptions,
    packageOptions,
    getMenuItemById,
    isLoading: menuLoading,
    error: menuError,
  } = useMenuOptions();
  const [notes, setNotes] = useState('');
  const [selectedBeverage, setSelectedBeverage] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
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
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [loyaltyMatch, setLoyaltyMatch] = useState<LoyaltyCustomer | null>(null);
  const [loyaltyBaseCoffees, setLoyaltyBaseCoffees] = useState<number | null>(null);
  const beverageOptionIds = useMemo(
    () => new Set(beverageOptions.map((item) => item.id)),
    [beverageOptions]
  );
  const foodOptionIds = useMemo(() => new Set(foodOptions.map((item) => item.id)), [foodOptions]);
  const packageOptionIds = useMemo(
    () => new Set(packageOptions.map((item) => item.id)),
    [packageOptions]
  );
  const resolveItemKind = useCallback(
    (menuItemId?: string | null): CartItem['kind'] => {
      if (!menuItemId) {
        return 'other';
      }
      if (beverageOptionIds.has(menuItemId)) {
        return 'beverage';
      }
      if (foodOptionIds.has(menuItemId)) {
        return 'food';
      }
      if (packageOptionIds.has(menuItemId)) {
        return 'package';
      }
      return 'other';
    },
    [beverageOptionIds, foodOptionIds, packageOptionIds]
  );
  const getBeverageUnitsInCart = useCallback(
    () => items.reduce((total, entry) => total + (isBeverageCartItem(entry) ? entry.quantity : 0), 0),
    [items]
  );

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

  useEffect(() => {
    if (!resolveLoyaltyCustomer || isPublicSale) {
      setLoyaltyMatch(null);
      setLoyaltyBaseCoffees(null);
      return;
    }
    const normalizedIdentifier = clientIdInput.trim().toLowerCase();
    if (!normalizedIdentifier) {
      setLoyaltyMatch(null);
      setLoyaltyBaseCoffees(null);
      return;
    }
    const match = resolveLoyaltyCustomer(normalizedIdentifier);
    setLoyaltyMatch(match);
    setLoyaltyBaseCoffees(
      match && typeof match.loyaltyCoffees === 'number' ? match.loyaltyCoffees : null
    );
  }, [clientIdInput, resolveLoyaltyCustomer, isPublicSale]);

  useEffect(() => {
    if (paymentMethod === 'efectivo') {
      setPaymentReference('');
    }
  }, [paymentMethod]);

  const handleQuickAdd = (productId: string) => {
    const menuItem = getMenuItemById(productId);
    if (!menuItem) {
      setFormError('No encontramos ese producto en el menú.');
      return;
    }
    const kind = resolveItemKind(menuItem.id);
    const isBeverage =
      kind === 'beverage' ||
      isLikelyBeverageDescriptor(menuItem.category) ||
      isLikelyBeverageDescriptor(menuItem.subcategory) ||
      isLikelyBeverageDescriptor(menuItem.label) ||
      isLikelyBeverageDescriptor(menuItem.sizeLabel);
    const beveragesAlreadyInCart = getBeverageUnitsInCart();
    const baseCoffees = typeof loyaltyBaseCoffees === 'number' ? loyaltyBaseCoffees : null;
    const isEligibleForReward = isBeverage && baseCoffees !== null;
    let loyaltyReward = false;
    let variantId = menuItem.id ?? menuItem.productId;
    if (isEligibleForReward) {
      const projectedTotal = baseCoffees + beveragesAlreadyInCart + 1;
      loyaltyReward = projectedTotal % 7 === 0;
      if (loyaltyReward) {
        variantId = `${variantId ?? menuItem.productId}-loyalty-${Date.now()}`;
      }
    }
    addItem({
      productId: menuItem.productId,
      variantId: variantId ?? menuItem.productId,
      name: menuItem.label,
      price: loyaltyReward ? 0 : menuItem.price ?? 0,
      quantity: 1,
      category: menuItem.category ?? (kind === 'beverage' ? 'Bebida' : menuItem.category),
      subcategory: menuItem.subcategory,
      sizeId: menuItem.sizeId,
      sizeLabel: menuItem.sizeLabel,
      kind: isBeverage ? 'beverage' : kind,
      originalPrice: menuItem.price ?? 0,
      loyaltyReward,
    });
    setFormError(null);
  };

  const canSubmit = items.length > 0 && !isSubmitting && Boolean(paymentMethod);
  const showPaymentReferenceField = Boolean(paymentMethod && paymentMethod !== 'efectivo');
  const paymentReferenceLabel =
    (paymentMethod && PAYMENT_REFERENCE_LABELS[paymentMethod]) || 'Referencia de pago';
  const paymentReferencePlaceholder =
    (paymentMethod && PAYMENT_REFERENCE_PLACEHOLDERS[paymentMethod]) || 'Referencia de pago';
  const paymentReferenceHint =
    (paymentMethod && PAYMENT_REFERENCE_HINTS[paymentMethod]) ||
    'Captura la referencia proporcionada por el comprobante.';
  const walletScannerAvailable = Boolean(onWalletScanRequest);
  const loyaltyModulo = useMemo(
    () => (typeof loyaltyBaseCoffees === 'number' ? loyaltyBaseCoffees % 7 : null),
    [loyaltyBaseCoffees]
  );
  const coffeesUntilReward = useMemo(() => {
    if (loyaltyModulo === null) {
      return null;
    }
    return loyaltyModulo === 6 ? 0 : 6 - loyaltyModulo;
  }, [loyaltyModulo]);

  const parsedCustomPercent = useMemo(() => parsePositiveNumber(customTipPercent), [customTipPercent]);
  const parsedCustomAmount = useMemo(() => parsePositiveNumber(customTipAmount), [customTipAmount]);
  const loyaltyStatusMessage = useMemo(() => {
    if (!loyaltyMatch || typeof loyaltyBaseCoffees !== 'number') {
      return null;
    }
    if (coffeesUntilReward === 0) {
      return 'El siguiente café de este pedido se descuenta automáticamente.';
    }
    if (typeof coffeesUntilReward === 'number') {
      return coffeesUntilReward === 1
        ? 'Te falta 1 café para activar el beneficio.'
        : `Te faltan ${coffeesUntilReward} cafés para activar el beneficio.`;
    }
    return null;
  }, [coffeesUntilReward, loyaltyBaseCoffees, loyaltyMatch]);

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
    setSelectedPackage(null);
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
    setPaymentMethod(null);
    setPaymentReference('');
    setLoyaltyMatch(null);
    setLoyaltyBaseCoffees(null);
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
  const handleWalletScan = () => {
    if (!onWalletScanRequest) {
      setFormError('El lector no está disponible en este entorno.');
      return;
    }
    onWalletScanRequest((value) => {
      setPaymentReference(value);
      setFormError(null);
    });
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

    if (!paymentMethod) {
      setFormError('Selecciona un método de pago antes de registrar el pedido.');
      return;
    }

    const needsReference = requiresPaymentReference(paymentMethod);
    const trimmedReference = paymentReference.trim();
    const normalizedReference = looksLikeLightningInvoice(trimmedReference)
      ? normalizeLightningReference(trimmedReference)
      : trimmedReference;
    if (needsReference) {
      if (!normalizedReference) {
        setFormError('Captura la referencia de pago correspondiente.');
        return;
      }
      if (!isValidReferenceForMethod(paymentMethod, normalizedReference)) {
        setFormError(
          paymentMethod === 'cripto'
            ? 'Ingresa una wallet 0x, ENS o factura Lightning válida.'
            : 'La referencia necesita al menos 4 caracteres.'
        );
        return;
      }
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const ticketCode = generateTicketCode();

    const fallbackUserId = isUsingPublicSaleId ? PUBLIC_SALE_USER_ID : undefined;
    const referenceType = normalizedReference ? detectReferenceType(normalizedReference) : null;
    const metadataPayload: Record<string, unknown> = {};
    if (normalizedReference) {
      metadataPayload.paymentReference = {
        value: normalizedReference,
        method: paymentMethod,
        type: referenceType,
      };
    }
    const trimmedNotes = notes.trim();
    const payload: Record<string, unknown> = {
      ticketCode,
      status: 'pending',
      currency: 'MXN',
      items: items.map((item) => {
        const metadata = item.variantId ? { variantId: item.variantId } : undefined;
        return {
          productId: item.productId,
          name: item.name,
          category: item.category,
          subcategory: item.subcategory,
          quantity: item.quantity,
          price: item.price,
          sizeId: item.sizeId,
          sizeLabel: item.sizeLabel,
          metadata,
        };
      }),
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
      paymentMethod,
    };
    if (trimmedNotes) {
      payload.notes = trimmedNotes;
    }
    if (Object.keys(metadataPayload).length > 0) {
      payload.metadata = metadataPayload;
    }
    if (needsReference && normalizedReference) {
      payload.paymentReference = normalizedReference;
    }

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
      <div className="mt-4">
        <SearchableDropdown
          id="new-order-packages"
          label="Paquetes"
          options={packageOptions}
          placeholder="Combos, kits u ofertas del menú editorial"
          helperText="Basado en xococafe.netlify.app/uses"
          value={selectedPackage}
          onChange={(selectedId) => {
            setSelectedPackage(selectedId);
            if (selectedId) {
              handleQuickAdd(selectedId);
              setSelectedPackage(null);
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
            {items.map((item) => {
              const itemKey = item.variantId ?? item.productId;
              const displayPrice = formatCurrency(item.price);
              const originalPrice =
                typeof item.originalPrice === 'number' && item.originalPrice > 0
                  ? formatCurrency(item.originalPrice)
                  : null;
              return (
                <li
                  key={itemKey}
                  className="flex items-center justify-between rounded-xl border border-primary-100/70 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-transparent"
                >
                  <div>
                    <p className="font-semibold text-primary-700 dark:text-primary-50">{item.name}</p>
                    <p className="text-xs text-[var(--brand-muted)]">
                      {item.category ?? 'Especialidad'}
                      {item.sizeLabel ? ` · ${item.sizeLabel}` : ''}
                      {' · '}
                      {item.loyaltyReward ? (
                        <span className="font-semibold text-emerald-600">{displayPrice}</span>
                      ) : (
                        displayPrice
                      )}
                      {item.loyaltyReward && originalPrice && (
                        <span className="ml-2 text-[var(--brand-muted)] line-through">{originalPrice}</span>
                      )}
                    </p>
                    {item.loyaltyReward && (
                      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-600">
                        Gratis por lealtad
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => decrement(itemKey)}
                      className="rounded-full border border-primary-200 px-2 py-1 text-xs font-semibold text-primary-600 transition hover:border-primary-400 disabled:opacity-40"
                      disabled={item.quantity <= 1 && item.loyaltyReward}
                      title={item.loyaltyReward ? 'El beneficio aplica a un solo café.' : undefined}
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-semibold">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => increment(itemKey)}
                      className="rounded-full border border-primary-200 px-2 py-1 text-xs font-semibold text-primary-600 transition hover:border-primary-400 disabled:opacity-40"
                      disabled={item.loyaltyReward}
                      title={item.loyaltyReward ? 'El café gratis no se puede duplicar desde aquí.' : undefined}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(itemKey)}
                      className="text-xs font-semibold text-danger-500"
                    >
                      Quitar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 border-t border-primary-100/60 pt-4 dark:border-white/10">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-100">Propinas sugeridas</p>
            <span className="text-xs text-[var(--brand-muted)]">
              Propina aplicada: <span className="font-semibold">{formatCurrency(tipAmount)}</span>
              {typeof appliedPercent === 'number' && ` (${appliedPercent.toFixed(1)}%)`}
            </span>
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
        </div>
        <div className="mt-4 space-y-1 rounded-2xl bg-white/60 p-3 text-sm shadow-sm dark:bg-white/5">
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
            <span className="font-semibold">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Propina</span>
            <span className="font-semibold text-primary-600">{formatCurrency(tipAmount)}</span>
          </div>
          <div className="flex items-center justify-between text-base font-semibold text-primary-700 dark:text-primary-100">
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
        {!isPublicSale && loyaltyMatch && (
          <div className="mt-2 rounded-xl border border-primary-200/70 bg-primary-50/70 px-3 py-2 text-xs text-primary-800 dark:border-white/20 dark:bg-white/10 dark:text-white">
            Cafés acumulados: {loyaltyMatch.loyaltyCoffees ?? 0}
            {loyaltyStatusMessage && <span className="ml-1 text-[var(--brand-muted)]">· {loyaltyStatusMessage}</span>}
          </div>
        )}
        {clientLookupState === 'error' && clientLookupError && (
          <div className="mt-2 rounded-xl border border-danger-200/70 bg-danger-50/70 px-3 py-2 text-xs text-danger-700 dark:border-danger-500/30 dark:bg-danger-900/30 dark:text-danger-100">
            {clientLookupError}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-primary-100/70 bg-white/80 p-4 text-sm dark:border-white/10 dark:bg-white/5">
        <p className="text-sm font-semibold text-primary-700 dark:text-primary-100">Método de pago</p>
        <p className="mt-1 text-xs text-[var(--brand-muted)]">
          Selecciona cómo se liquidó este pedido antes de registrarlo.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[
            { key: 'debito', label: 'Débito' },
            { key: 'credito', label: 'Crédito' },
            { key: 'transferencia', label: 'Transferencia' },
            { key: 'efectivo', label: 'Efectivo' },
            { key: 'cripto', label: 'Cripto' },
          ].map((method) => {
            const isActive = paymentMethod === method.key;
            return (
              <button
                type="button"
                key={method.key}
                onClick={() => setPaymentMethod(method.key)}
                className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
                  isActive
                    ? 'border-primary-500 bg-primary-100 text-primary-800 dark:border-primary-300 dark:bg-primary-500/20 dark:text-primary-100'
                    : 'border-primary-100 text-[var(--brand-text)] dark:border-white/20 dark:text-white'
                }`}
              >
                {method.label}
              </button>
            );
          })}
        </div>
        {!paymentMethod && (
          <p className="mt-2 text-xs text-danger-500">Este campo es obligatorio.</p>
        )}
        {showPaymentReferenceField && (
          <div className="mt-4">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--brand-muted)]">
              {paymentReferenceLabel}
            </label>
            <div className="mt-2">
              <div className="relative">
                <input
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder={paymentReferencePlaceholder}
                  className="w-full rounded-xl border border-primary-100/70 bg-transparent px-3 py-2 pr-12 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/20 dark:bg-white/5 dark:text-white"
                />
                {paymentMethod === 'cripto' && (
                  <button
                    type="button"
                    onClick={handleWalletScan}
                    className="absolute inset-y-0 right-3 flex items-center justify-center rounded-full border border-primary-200 bg-primary-50 px-2 text-base transition hover:border-primary-400 hover:bg-primary-100 disabled:opacity-40 dark:border-white/30 dark:bg-white/10"
                    disabled={!walletScannerAvailable}
                  >
                    <span aria-hidden="true">📷</span>
                    <span className="sr-only">Escanear referencia cripto</span>
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-[var(--brand-muted)]">{paymentReferenceHint}</p>
          </div>
        )}
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
