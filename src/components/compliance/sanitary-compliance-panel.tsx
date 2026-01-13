'use client';

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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadHygieneChecklistPdf,
  exportCofeprisReport,
  fetchHygieneChecklist,
  fetchPestControlStatus,
  fetchSmartInventoryStatus,
  fetchWasteLogs,
  runSmartInventoryAction,
  savePestControlRecord,
  submitHygieneChecklist,
  submitWasteLog,
  type HygieneArea,
  type HygieneChecklist,
  type HygieneChecklistSummary,
  type HygieneLogEntry,
  type PestControlRecord,
  type PestControlStatus,
  type SmartInventoryActionRequest,
  type SmartInventoryEntry,
  type SmartInventoryStatus,
  type WasteLogEntry,
} from '@/lib/api';
import { ChartButton } from '@/components/chart-button';

type StatusState =
  | { type: 'idle'; message?: string }
  | { type: 'loading'; message?: string }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string };

const useStatus = (): [
  StatusState,
  {
    loading: (message?: string) => void;
    success: (message: string) => void;
    error: (message: string) => void;
    reset: () => void;
  }
] => {
  const [state, setState] = useState<StatusState>({ type: 'idle' });
  return [
    state,
    {
      loading: (message) => setState({ type: 'loading', message }),
      success: (message) => setState({ type: 'success', message }),
      error: (message) => setState({ type: 'error', message }),
      reset: () => setState({ type: 'idle' }),
    },
  ];
};

const monthValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const HYGIENE_AREAS: Record<
  HygieneArea,
  { label: string; description: string; icon: string; requiresBathroomChecklist?: boolean }
> = {
  BAÑO: { label: 'Baño', description: 'Checklist NOM-251', icon: '🚽', requiresBathroomChecklist: true },
  COCINA: { label: 'Cocina', description: 'Órdenes y superficies', icon: '👩‍🍳' },
  BARRA: { label: 'Barra', description: 'Área de servicio', icon: '🥤' },
  MESAS: { label: 'Mesas', description: 'Área común y clientes', icon: '🪑' },
};

const COFEPRIS_TABS = [
  { id: 'summary', label: 'Resumen' },
  { id: 'hygiene', label: 'Higiene' },
  { id: 'pest', label: 'Plagas' },
  { id: 'inventory', label: 'Manejo de alimentos' },
  { id: 'waste', label: 'Residuos' },
] as const;

type CofeprisTabId = (typeof COFEPRIS_TABS)[number]['id'];

export interface SanitaryCompliancePanelProps {
  staffId: string;
  staffName: string;
  branchId?: string | null;
  onPestAlertChange?: (message: string | null) => void;
  onSummarySnapshotChange?: (data: Array<{ name: string; value: number }>) => void;
}

export const SanitaryCompliancePanel = ({
  staffId,
  staffName,
  branchId,
  onPestAlertChange,
  onSummarySnapshotChange,
}: SanitaryCompliancePanelProps) => {
  const [activeTab, setActiveTab] = useState<CofeprisTabId>('summary');
  const [selectedArea, setSelectedArea] = useState<HygieneArea>('BAÑO');
  const [bathroomChecklist, setBathroomChecklist] = useState<HygieneChecklist>({
    toilet: false,
    mirrors: false,
    dryFloor: false,
    soapRefill: false,
  });
  const [generalClean, setGeneralClean] = useState(true);
  const [generalSuppliesRefilled, setGeneralSuppliesRefilled] = useState(true);
  const [hygieneNotes, setHygieneNotes] = useState('');
  const [hygieneMonth, setHygieneMonth] = useState(monthValue(new Date()));
  const [hygieneSummary, setHygieneSummary] = useState<HygieneChecklistSummary | null>(null);
  const [pestStatus, setPestStatus] = useState<PestControlStatus | null>(null);
  const [pestForm, setPestForm] = useState<{
    certificateNumber: string;
    serviceDate: string;
    providerName: string;
    nextServiceDate: string;
    observations: string;
  }>({
    certificateNumber: '',
    serviceDate: '',
    providerName: '',
    nextServiceDate: '',
    observations: '',
  });
  const [inventoryStatus, setInventoryStatus] = useState<SmartInventoryStatus | null>(null);
  const [wasteLogs, setWasteLogs] = useState<WasteLogEntry[]>([]);
  const [ingressForm, setIngressForm] = useState({
    itemId: '',
    quantity: '',
    unitSize: '',
    expiresAt: '',
    reference: '',
  });
  const [saleForm, setSaleForm] = useState({ productId: '', quantity: '' });
  const [wasteForm, setWasteForm] = useState({
    organicBeverages: '',
    organicFoods: '',
    inorganic: '',
    trashRemoved: false,
    binsWashed: false,
  });

  const [hygieneStatus, hygieneStatusActions] = useStatus();
  const [pestStatusState, pestStatusActions] = useStatus();
  const [inventoryStatusState, inventoryStatusActions] = useStatus();
  const [wasteStatus, wasteStatusActions] = useStatus();
  const [exportStatus, exportStatusActions] = useStatus();
  const summarySnapshotRef = useRef<string | null>(null);

  const hygieneChartData = useMemo(() => {
    const base = (Object.keys(HYGIENE_AREAS) as HygieneArea[]).map((area) => ({
      area,
      label: HYGIENE_AREAS[area].label,
      value: 0,
    }));
    if (!hygieneSummary?.entries?.length) {
      return base.map(({ label, value }) => ({ name: label, value }));
    }
    const counts = new Map<HygieneArea, number>();
    hygieneSummary.entries.forEach((entry) => {
      counts.set(entry.area, (counts.get(entry.area) ?? 0) + 1);
    });
    return base.map(({ area, label }) => ({ name: label, value: counts.get(area) ?? 0 }));
  }, [hygieneSummary]);

  const pestChartData = useMemo(() => {
    return [
      {
        name: 'Días desde fumigación',
        value: Math.max(0, pestStatus?.daysSince ?? 0),
      },
      {
        name: 'Servicios registrados',
        value: pestStatus?.latest ? 1 : 0,
      },
      {
        name: 'Alertas activas',
        value: pestStatus?.alert ? 1 : 0,
      },
    ];
  }, [pestStatus]);

  const inventoryChartData = useMemo(() => {
    const totalEntries = inventoryStatus?.entries?.length ?? 0;
    const lowStock = inventoryStatus?.lowStock?.length ?? 0;
    const zeroStock = inventoryStatus?.zeroStock?.length ?? 0;
    return [
      { name: 'Monitoreados', value: totalEntries },
      { name: 'Bajo stock', value: lowStock },
      { name: 'Sin stock', value: zeroStock },
    ];
  }, [inventoryStatus]);

  const wasteChartData = useMemo(() => {
    if (wasteLogs.length === 0) {
      return [
        { name: 'Orgánico (bebidas)', value: 0 },
        { name: 'Orgánico (alimentos)', value: 0 },
        { name: 'Inorgánico', value: 0 },
      ];
    }
    const totals = wasteLogs.reduce(
      (acc, log) => ({
        beverages: acc.beverages + (Number(log.organicBeveragesKg) || 0),
        foods: acc.foods + (Number(log.organicFoodsKg) || 0),
        inorganic: acc.inorganic + (Number(log.inorganicKg) || 0),
      }),
      { beverages: 0, foods: 0, inorganic: 0 }
    );
    return [
      { name: 'Orgánico (bebidas)', value: Number(totals.beverages.toFixed(2)) },
      { name: 'Orgánico (alimentos)', value: Number(totals.foods.toFixed(2)) },
      { name: 'Inorgánico', value: Number(totals.inorganic.toFixed(2)) },
    ];
  }, [wasteLogs]);

  const summarySnapshotData = useMemo(
    () => [
      { name: 'Higiene', value: hygieneSummary?.summary.total ?? 0 },
      { name: 'Plagas', value: Math.max(0, pestStatus?.daysSince ?? 0) },
      { name: 'Manejo de alimentos', value: inventoryStatus?.entries?.length ?? 0 },
      { name: 'Residuos', value: wasteLogs.length },
    ],
    [hygieneSummary?.summary.total, inventoryStatus?.entries?.length, pestStatus?.daysSince, wasteLogs.length]
  );

  const chartData = useMemo(() => {
    switch (activeTab) {
      case 'hygiene':
        return hygieneChartData;
      case 'pest':
        return pestChartData;
      case 'inventory':
        return inventoryChartData;
      case 'waste':
        return wasteChartData;
      default:
        return summarySnapshotData;
    }
  }, [activeTab, hygieneChartData, inventoryChartData, pestChartData, summarySnapshotData, wasteChartData]);
  const chartPresentation: Record<CofeprisTabId, { title: string; yLabel: string }> = {
    summary: { title: 'Resumen COFEPRIS', yLabel: 'Registros' },
    hygiene: { title: 'Higiene (NOM-251)', yLabel: 'Registros' },
    pest: { title: 'Control de plagas', yLabel: 'Eventos' },
    inventory: { title: 'Manejo de alimentos', yLabel: 'Alertas' },
    waste: { title: 'Residuos (kg)', yLabel: 'Kg totales' },
  };
  const currentChartPresentation = chartPresentation[activeTab] ?? chartPresentation.summary;

  useEffect(() => {
    if (!onSummarySnapshotChange) {
      return;
    }
    const serialized = JSON.stringify(summarySnapshotData);
    if (summarySnapshotRef.current === serialized) {
      return;
    }
    summarySnapshotRef.current = serialized;
    onSummarySnapshotChange(summarySnapshotData);
  }, [onSummarySnapshotChange, summarySnapshotData]);

  const loadHygiene = useCallback(async () => {
    hygieneStatusActions.loading();
    try {
      const data = await fetchHygieneChecklist(hygieneMonth);
      setHygieneSummary(data);
      hygieneStatusActions.success('Checklist actualizado.');
    } catch (error) {
      hygieneStatusActions.error(
        error instanceof Error ? error.message : 'No pudimos cargar la bitácora NOM-251.'
      );
    }
  }, [hygieneMonth, hygieneStatusActions]);

  const loadPestControl = useCallback(async () => {
    try {
      const data = await fetchPestControlStatus();
      setPestStatus(data);
      onPestAlertChange?.(data.alertMessage ?? null);
    } catch (error) {
      onPestAlertChange?.('No pudimos verificar la fumigación.');
      console.error(error);
    }
  }, [onPestAlertChange]);

  const loadInventoryStatus = useCallback(async () => {
    try {
      const status = await fetchSmartInventoryStatus();
      setInventoryStatus(status);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadWasteLogs = useCallback(async () => {
    try {
      const data = await fetchWasteLogs();
      setWasteLogs(data.logs);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    void loadHygiene();
  }, [loadHygiene]);

  useEffect(() => {
    void loadPestControl();
    void loadInventoryStatus();
    void loadWasteLogs();
  }, [loadInventoryStatus, loadPestControl, loadWasteLogs]);

  const handleChecklistChange = (key: keyof HygieneChecklist) => {
    setBathroomChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmitHygiene = async () => {
    hygieneStatusActions.loading('Guardando...');
    try {
      const isBathroom = selectedArea === 'BAÑO';
      const isClean = isBathroom
        ? Object.values(bathroomChecklist).every((value) => Boolean(value))
        : generalClean;
      const suppliesRefilled = isBathroom
        ? Boolean(bathroomChecklist.soapRefill)
        : generalSuppliesRefilled;
      const bathroomDetail = isBathroom
        ? [
          `Inodoro ${bathroomChecklist.toilet ? '✅' : '⚠️'}`,
          `Espejos ${bathroomChecklist.mirrors ? '✅' : '⚠️'}`,
          `Piso ${bathroomChecklist.dryFloor ? 'Seco' : 'Húmedo'}`,
          `Suministros ${bathroomChecklist.soapRefill ? 'OK' : 'Falta'}`,
        ].join(' · ')
        : null;
      const staffNote = staffName ? `Registrado por ${staffName}` : null;
      const observations = [staffNote, hygieneNotes.trim(), bathroomDetail?.trim()]
        .filter((value) => value && value.length > 0)
        .join(' | ');
      await submitHygieneChecklist({
        area: selectedArea,
        isClean,
        suppliesRefilled,
        observations: observations || undefined,
        staffId,
      });
      hygieneStatusActions.success('Registro enviado.');
      setHygieneNotes('');
      if (isBathroom) {
        setBathroomChecklist({
          toilet: false,
          mirrors: false,
          dryFloor: false,
          soapRefill: false,
        });
      } else {
        setGeneralClean(true);
        setGeneralSuppliesRefilled(true);
      }
      await loadHygiene();
    } catch (error) {
      hygieneStatusActions.error(
        error instanceof Error ? error.message : 'No pudimos guardar el checklist.'
      );
    }
  };

  const handleDownloadPdf = async () => {
    hygieneStatusActions.loading('Generando PDF...');
    try {
      const blob = await downloadHygieneChecklistPdf(hygieneMonth);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `higiene-${hygieneMonth}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      hygieneStatusActions.success('PDF generado.');
    } catch (error) {
      hygieneStatusActions.error(
        error instanceof Error ? error.message : 'No pudimos generar el PDF mensual.'
      );
    }
  };

  const handleExportReport = async (format: 'csv' | 'xlsx') => {
    exportStatusActions.loading('Generando exportación...');
    try {
      const blob = await exportCofeprisReport(format, hygieneMonth);
      const extension = format === 'xlsx' ? 'xlsx' : 'csv';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cofepris-${hygieneMonth}.${extension}`;
      link.click();
      URL.revokeObjectURL(url);
      exportStatusActions.success(`Archivo ${extension.toUpperCase()} listo.`);
    } catch (error) {
      exportStatusActions.error(
        error instanceof Error ? error.message : 'No pudimos generar la exportación.'
      );
    }
  };

  const handleSavePestControl = async () => {
    pestStatusActions.loading('Registrando certificado...');
    try {
      await savePestControlRecord({
        serviceDate: pestForm.serviceDate,
        providerName: pestForm.providerName || undefined,
        certificateNumber: pestForm.certificateNumber || undefined,
        nextServiceDate: pestForm.nextServiceDate || undefined,
        staffId,
        observations: pestForm.observations || undefined,
      });
      pestStatusActions.success('Fumigación registrada.');
      setPestForm({
        certificateNumber: '',
        serviceDate: '',
        providerName: '',
        nextServiceDate: '',
        observations: '',
      });
      await loadPestControl();
    } catch (error) {
      pestStatusActions.error(
        error instanceof Error ? error.message : 'No pudimos guardar el certificado.'
      );
    }
  };

  const handleIngressSubmit = async () => {
    inventoryStatusActions.loading('Registrando ingreso...');
    try {
      const payload: SmartInventoryActionRequest = {
        action: 'ingress',
        itemId: ingressForm.itemId,
        quantity: Number(ingressForm.quantity || 0),
        unitSize: Number(ingressForm.unitSize || 0),
        reference: ingressForm.reference || undefined,
        expiresAt: ingressForm.expiresAt || undefined,
        branchId: branchId ?? undefined,
        staffId,
      };
      await runSmartInventoryAction(payload);
      inventoryStatusActions.success('Ingreso registrado.');
      setIngressForm({ itemId: '', quantity: '', unitSize: '', expiresAt: '', reference: '' });
      await loadInventoryStatus();
    } catch (error) {
      inventoryStatusActions.error(
        error instanceof Error ? error.message : 'No pudimos actualizar el inventario.'
      );
    }
  };

  const handleSaleSubmit = async () => {
    inventoryStatusActions.loading('Descontando receta...');
    try {
      const payload: SmartInventoryActionRequest = {
        action: 'sale',
        branchId: branchId ?? undefined,
        staffId,
        saleItems: [
          { productId: saleForm.productId, quantity: Number(saleForm.quantity || 0) },
        ],
      };
      await runSmartInventoryAction(payload);
      inventoryStatusActions.success('Receta descontada vía PEPS.');
      setSaleForm({ productId: '', quantity: '' });
      await loadInventoryStatus();
    } catch (error) {
      inventoryStatusActions.error(
        error instanceof Error ? error.message : 'No pudimos descontar los insumos.'
      );
    }
  };

  const handleWasteSubmit = async () => {
    wasteStatusActions.loading('Guardando cierre sanitario...');
    try {
      await submitWasteLog({
        organicBeverages: Number(wasteForm.organicBeverages || 0),
        organicFoods: Number(wasteForm.organicFoods || 0),
        inorganic: Number(wasteForm.inorganic || 0),
        trashRemoved: wasteForm.trashRemoved,
        binsWashed: wasteForm.binsWashed,
        branchId: branchId ?? undefined,
        staffId,
      });
      wasteStatusActions.success('Cierre registrado.');
      setWasteForm({
        organicBeverages: '',
        organicFoods: '',
        inorganic: '',
        trashRemoved: false,
        binsWashed: false,
      });
      await loadWasteLogs();
    } catch (error) {
      wasteStatusActions.error(
        error instanceof Error ? error.message : 'No pudimos guardar el cierre de residuos.'
      );
    }
  };

  const hygieneHistory = useMemo(() => hygieneSummary?.entries.slice(-5).reverse() ?? [], [hygieneSummary]);
  const lowStockEntries = inventoryStatus?.lowStock ?? [];
  const latestHygieneEntry = hygieneSummary?.summary.lastEntry ?? hygieneHistory[0] ?? null;
  const lastWasteLog = wasteLogs[0] ?? null;

  const summaryCards = [
    {
      title: 'Último checklist',
      value: latestHygieneEntry
        ? new Date(latestHygieneEntry.createdAt).toLocaleString('es-MX', {
            dateStyle: 'short',
            timeStyle: 'short',
          })
        : 'Pendiente',
      detail: `${hygieneSummary?.summary.total ?? 0} registros en ${
        hygieneSummary?.month ?? hygieneMonth
      }`,
      tone: 'primary' as const,
    },
    {
      title: 'Fumigación',
      value: pestStatus?.latest
        ? new Date(pestStatus.latest.serviceDate).toLocaleDateString('es-MX')
        : 'Sin registro',
      detail: pestStatus?.alertMessage ?? 'Sin alertas activas',
      tone: pestStatus?.alert ? 'danger' : 'amber',
    },
    {
      title: 'Insumos críticos',
      value: lowStockEntries.length.toString(),
      detail: lowStockEntries.length === 0 ? 'Stock saludable' : 'Revisar inventario',
      tone: lowStockEntries.length === 0 ? 'emerald' : 'amber',
    },
    {
      title: 'Cierre sanitario',
      value: lastWasteLog
        ? new Date(lastWasteLog.createdAt).toLocaleDateString('es-MX', {
            dateStyle: 'medium',
          })
        : 'Pendiente',
      detail: lastWasteLog
        ? `${lastWasteLog.organicBeveragesKg}kg bebidas · ${lastWasteLog.organicFoodsKg}kg alimentos`
        : 'Registra el turno del día',
      tone: 'slate' as const,
    },
  ];

  const renderHygieneTab = () => (
    <div className="space-y-4 rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="badge">Checklist de higiene</p>
          <p className="text-sm text-[var(--brand-muted)]">
            Tablero táctil para Baño, Cocina, Barra y Mesas · registramos staff y hora automáticamente.
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {(Object.keys(HYGIENE_AREAS) as HygieneArea[]).map((area) => {
          const meta = HYGIENE_AREAS[area];
          const isActive = selectedArea === area;
          return (
            <button
              key={area}
              type="button"
              className={`flex flex-col rounded-3xl border px-4 py-3 text-left transition ${isActive
                ? 'border-primary-300 bg-primary-50/80 text-primary-900 dark:border-primary-300/40 dark:bg-primary-900/30 dark:text-primary-50'
                : 'border-primary-100 bg-white text-[var(--brand-text)] hover:border-primary-200 dark:border-white/10 dark:bg-white/5 dark:text-white'
                }`}
              onClick={() => {
                setSelectedArea(area);
                setHygieneNotes('');
                if (area !== 'BAÑO') {
                  setGeneralClean(true);
                  setGeneralSuppliesRefilled(true);
                }
              }}
            >
              <span className="text-3xl">{meta.icon}</span>
              <span className="font-semibold">{meta.label}</span>
              <span className="text-xs text-[var(--brand-muted)]">{meta.description}</span>
            </button>
          );
        })}
      </div>
      {selectedArea === 'BAÑO' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ['toilet', 'Limpieza de inodoro'],
            ['mirrors', 'Espejos sin manchas'],
            ['dryFloor', 'Piso seco'],
            ['soapRefill', 'Relleno de jabón/papel'],
          ] as Array<[keyof HygieneChecklist, string]>).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-3 rounded-2xl border border-primary-100/70 bg-white/70 px-3 py-2 text-sm font-semibold text-[var(--brand-text)] dark:border-white/10 dark:bg-white/5"
            >
              <input
                type="checkbox"
                checked={Boolean(bathroomChecklist[key])}
                onChange={() => handleChecklistChange(key)}
                className="h-4 w-4 rounded border-primary-200 text-primary-600 focus:ring-primary-500"
              />
              {label}
            </label>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--brand-muted)]">
            Confirma limpieza profunda en {HYGIENE_AREAS[selectedArea].label}. Agrega notas para tareas específicas.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-2xl border border-primary-100/70 bg-white/70 px-3 py-2 text-sm font-semibold text-[var(--brand-text)] dark:border-white/10 dark:bg-white/5">
              <input
                type="checkbox"
                checked={generalClean}
                onChange={(event) => setGeneralClean(event.target.checked)}
                className="h-4 w-4 rounded border-primary-200 text-primary-600 focus:ring-primary-500"
              />
              Área limpia y sanitizada
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-primary-100/70 bg-white/70 px-3 py-2 text-sm font-semibold text-[var(--brand-text)] dark:border-white/10 dark:bg-white/5">
              <input
                type="checkbox"
                checked={generalSuppliesRefilled}
                onChange={(event) => setGeneralSuppliesRefilled(event.target.checked)}
                className="h-4 w-4 rounded border-primary-200 text-primary-600 focus:ring-primary-500"
              />
              Insumos repuestos (jabón, gel, servilletas)
            </label>
          </div>
        </div>
      )}
      <textarea
        value={hygieneNotes}
        onChange={(event) => setHygieneNotes(event.target.value)}
        placeholder="Notas opcionales para el checklist"
        className="w-full rounded-3xl border border-primary-100/70 bg-white/70 px-4 py-3 text-sm text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
      />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" className="brand-button" onClick={() => void handleSubmitHygiene()}>
          Registrar checklist
        </button>
        <button type="button" className="brand-button--ghost" onClick={() => void handleDownloadPdf()}>
          PDF mensual COFEPRIS
        </button>
        {hygieneStatus.type !== 'idle' && (
          <span
            className={`rounded-full px-3 py-1 ${hygieneStatus.type === 'error'
              ? 'bg-danger-50 text-danger-700'
              : hygieneStatus.type === 'success'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-primary-50 text-primary-700'
              }`}
          >
            {hygieneStatus.message ?? 'Trabajando...'}
          </span>
        )}
      </div>
    </div>
  );

  const renderPestTab = () => (
    <div className="space-y-4 rounded-3xl border border-amber-100/70 bg-amber-50/60 p-4 text-sm text-amber-900 dark:border-amber-300/40 dark:bg-amber-900/20 dark:text-amber-50">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em]">Control de plagas</p>
          <p className="text-lg font-semibold">Seguridad sanitaria</p>
        </div>
        {pestStatus?.alertMessage && (
          <span className="rounded-full bg-danger-600/90 px-3 py-1 text-xs font-semibold text-white">
            {pestStatus.alertMessage}
          </span>
        )}
      </div>
      <div className="rounded-2xl bg-white/60 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-50">
        <p className="text-xs text-amber-600/70 dark:text-amber-200">Último servicio</p>
        {pestStatus?.latest ? (
          <>
            <p className="font-semibold">
              {new Date(pestStatus.latest.serviceDate).toLocaleDateString('es-MX')}
            </p>
            {pestStatus.latest.providerName && <p className="text-xs">Proveedor {pestStatus.latest.providerName}</p>}
            {pestStatus.latest.certificateNumber && (
              <p className="text-xs">Certificado #{pestStatus.latest.certificateNumber}</p>
            )}
            {pestStatus.latest.nextServiceDate && (
              <p className="text-xs">
                Próximo servicio: {new Date(pestStatus.latest.nextServiceDate).toLocaleDateString('es-MX')}
              </p>
            )}
            {pestStatus.latest.observations && (
              <p className="text-xs text-amber-700 dark:text-amber-200">Observaciones: {pestStatus.latest.observations}</p>
            )}
          </>
        ) : (
          <p>Sin registros. Carga el certificado de fumigación actualizado.</p>
        )}
      </div>
      <div className="space-y-2">
        <label className="block text-xs">
          Proveedor
          <input
            type="text"
            value={pestForm.providerName}
            onChange={(event) => setPestForm((prev) => ({ ...prev, providerName: event.target.value }))}
            className="mt-1 w-full rounded-2xl border border-amber-200 bg-white/90 px-3 py-2 text-amber-900 focus:border-amber-400 focus:outline-none"
          />
        </label>
        <label className="block text-xs">
          Certificado
          <input
            type="text"
            value={pestForm.certificateNumber}
            onChange={(event) => setPestForm((prev) => ({ ...prev, certificateNumber: event.target.value }))}
            className="mt-1 w-full rounded-2xl border border-amber-200 bg-white/90 px-3 py-2 text-amber-900 focus:border-amber-400 focus:outline-none"
          />
        </label>
        <label className="block text-xs">
          Fecha del servicio
          <input
            type="date"
            value={pestForm.serviceDate}
            onChange={(event) => setPestForm((prev) => ({ ...prev, serviceDate: event.target.value }))}
            className="mt-1 w-full rounded-2xl border border-amber-200 bg-white/90 px-3 py-2 text-amber-900 focus:border-amber-400 focus:outline-none"
          />
        </label>
        <label className="block text-xs">
          Próximo servicio
          <input
            type="date"
            value={pestForm.nextServiceDate}
            onChange={(event) => setPestForm((prev) => ({ ...prev, nextServiceDate: event.target.value }))}
            className="mt-1 w-full rounded-2xl border border-amber-200 bg-white/90 px-3 py-2 text-amber-900 focus:border-amber-400 focus:outline-none"
          />
        </label>
        <label className="block text-xs">
          Observaciones / enlace al certificado
          <textarea
            value={pestForm.observations}
            onChange={(event) => setPestForm((prev) => ({ ...prev, observations: event.target.value }))}
            className="mt-1 w-full rounded-2xl border border-amber-200 bg-white/90 px-3 py-2 text-amber-900 focus:border-amber-400 focus:outline-none"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="brand-button" onClick={() => void handleSavePestControl()}>
          Guardar certificado
        </button>
        {pestStatusState.type !== 'idle' && (
          <span
            className={`text-xs ${pestStatusState.type === 'error'
              ? 'text-danger-700'
              : pestStatusState.type === 'success'
                ? 'text-emerald-700'
                : 'text-amber-700'
              }`}
          >
            {pestStatusState.message ?? 'Trabajando...'}
          </span>
        )}
      </div>
    </div>
  );

  const renderInventoryTab = () => (
    <div className="space-y-4 rounded-3xl border border-emerald-100/70 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-300/40 dark:bg-emerald-900/20 dark:text-emerald-50">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em]">Smart Inventory</p>
          <p className="text-lg font-semibold">Fraccionamiento & PEPS</p>
        </div>
        {inventoryStatusState.type === 'loading' && <span className="text-xs">Actualizando…</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-white/70 p-3 dark:bg-emerald-900/30">
          <p className="text-xs text-emerald-600/70 dark:text-emerald-200">Ingreso de insumo</p>
          <label className="mt-2 block text-xs">
            ID / SKU
            <input
              value={ingressForm.itemId}
              onChange={(event) => setIngressForm((prev) => ({ ...prev, itemId: event.target.value }))}
              className="mt-1 w-full rounded-2xl border border-emerald-200 bg-white/90 px-3 py-2 text-emerald-900 focus:border-emerald-400 focus:outline-none"
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <label>
              Piezas
              <input
                type="number"
                value={ingressForm.quantity}
                onChange={(event) => setIngressForm((prev) => ({ ...prev, quantity: event.target.value }))}
                className="mt-1 w-full rounded-2xl border border-emerald-200 bg-white/90 px-2 py-1 text-emerald-900 focus:border-emerald-400 focus:outline-none"
              />
            </label>
            <label>
              Unidad base
              <input
                type="number"
                value={ingressForm.unitSize}
                onChange={(event) => setIngressForm((prev) => ({ ...prev, unitSize: event.target.value }))}
                className="mt-1 w-full rounded-2xl border border-emerald-200 bg-white/90 px-2 py-1 text-emerald-900 focus:border-emerald-400 focus:outline-none"
              />
            </label>
          </div>
          <label className="mt-2 block text-xs">
            Caducidad
            <input
              type="date"
              value={ingressForm.expiresAt}
              onChange={(event) => setIngressForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
              className="mt-1 w-full rounded-2xl border border-emerald-200 bg-white/90 px-3 py-2 text-emerald-900 focus:border-emerald-400 focus:outline-none"
            />
          </label>
          <label className="mt-2 block text-xs">
            Lote o referencia
            <input
              value={ingressForm.reference}
              onChange={(event) => setIngressForm((prev) => ({ ...prev, reference: event.target.value }))}
              className="mt-1 w-full rounded-2xl border border-emerald-200 bg-white/90 px-3 py-2 text-emerald-900 focus:border-emerald-400 focus:outline-none"
            />
          </label>
          <button type="button" className="brand-button mt-3 text-xs" onClick={() => void handleIngressSubmit()}>
            Convertir a base (g, ml, unidades)
          </button>
        </div>
        <div className="rounded-2xl bg-white/70 p-3 dark:bg-emerald-900/30">
          <p className="text-xs text-emerald-600/70 dark:text-emerald-200">Descuento por venta</p>
          <label className="mt-2 block text-xs">
            Producto vendido
            <input
              value={saleForm.productId}
              onChange={(event) => setSaleForm((prev) => ({ ...prev, productId: event.target.value }))}
              className="mt-1 w-full rounded-2xl border border-emerald-200 bg-white/90 px-3 py-2 text-emerald-900 focus:border-emerald-400 focus:outline-none"
            />
          </label>
          <label className="mt-2 block text-xs">
            Cantidad vendida
            <input
              type="number"
              value={saleForm.quantity}
              onChange={(event) => setSaleForm((prev) => ({ ...prev, quantity: event.target.value }))}
              className="mt-1 w-full rounded-2xl border border-emerald-200 bg-white/90 px-3 py-2 text-emerald-900 focus:border-emerald-400 focus:outline-none"
            />
          </label>
          <button type="button" className="brand-button mt-3 text-xs" onClick={() => void handleSaleSubmit()}>
            Aplicar receta y PEPS
          </button>
        </div>
      </div>
      <div className="rounded-2xl bg-white/70 p-3 dark:bg-emerald-900/30">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">Alertas críticas</p>
        {lowStockEntries.length === 0 ? (
          <p className="text-sm text-emerald-900 dark:text-emerald-50">Sin insumos críticos por debajo del 20%.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {lowStockEntries.map((entry: SmartInventoryEntry) => (
              <div
                key={`${entry.branchId}-${entry.itemId}`}
                className="rounded-2xl border border-emerald-100/70 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-300/30 dark:text-emerald-50"
              >
                <p className="font-semibold">{entry.name}</p>
                <p>
                  Stock {entry.quantity.toFixed(1)} {entry.unit} · mínimo {entry.minStock.toFixed(1)} (
                  {Math.round(entry.percentAvailable * 100)}%)
                </p>
                <p className="text-[var(--brand-muted)]">Derivado de recetas activas.</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderWasteTab = () => (
    <div className="space-y-4 rounded-3xl border border-slate-200 bg-white/90 p-4 text-sm text-[var(--brand-text)] dark:border-white/10 dark:bg-white/5 dark:text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Cierre sanitario</p>
          <p className="text-lg font-semibold">Gestión de residuos por turno</p>
        </div>
        {wasteStatus.type === 'loading' && <p className="text-xs text-[var(--brand-muted)]">Guardando…</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs">
          Orgánico bebidas / café (kg)
          <input
            type="number"
            value={wasteForm.organicBeverages}
            onChange={(event) => setWasteForm((prev) => ({ ...prev, organicBeverages: event.target.value }))}
            className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <label className="text-xs">
          Orgánico alimentos (kg)
          <input
            type="number"
            value={wasteForm.organicFoods}
            onChange={(event) => setWasteForm((prev) => ({ ...prev, organicFoods: event.target.value }))}
            className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
        <label className="text-xs">
          Inorgánico (kg)
          <input
            type="number"
            value={wasteForm.inorganic}
            onChange={(event) => setWasteForm((prev) => ({ ...prev, inorganic: event.target.value }))}
            className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/5"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 text-sm font-semibold text-[var(--brand-text)] dark:border-white/10 dark:bg-white/5">
          <input
            type="checkbox"
            checked={wasteForm.trashRemoved}
            onChange={(event) => setWasteForm((prev) => ({ ...prev, trashRemoved: event.target.checked }))}
            className="h-4 w-4 rounded border-primary-200 text-primary-600 focus:ring-primary-500"
          />
          ¿Se retiró la basura al contenedor exterior?
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 text-sm font-semibold text-[var(--brand-text)] dark:border-white/10 dark:bg-white/5">
          <input
            type="checkbox"
            checked={wasteForm.binsWashed}
            onChange={(event) => setWasteForm((prev) => ({ ...prev, binsWashed: event.target.checked }))}
            className="h-4 w-4 rounded border-primary-200 text-primary-600 focus:ring-primary-500"
          />
          ¿Se lavaron los botes?
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="brand-button" onClick={() => void handleWasteSubmit()}>
          Registrar cierre
        </button>
        {wasteStatus.type !== 'idle' && (
          <span
            className={`text-xs ${wasteStatus.type === 'error'
              ? 'text-danger-700'
              : wasteStatus.type === 'success'
                ? 'text-emerald-700'
                : 'text-[var(--brand-muted)]'
              }`}
          >
            {wasteStatus.message ?? 'Trabajando...'}
          </span>
        )}
      </div>
      <div className="space-y-2 text-xs">
        <p className="uppercase tracking-[0.3em] text-[var(--brand-muted)]">Historial reciente</p>
        {wasteLogs.length === 0 ? (
          <p className="text-[var(--brand-muted)]">Completa el cierre sanitario antes del corte de caja.</p>
        ) : (
          wasteLogs.slice(0, 4).map((log: WasteLogEntry) => (
            <div key={log.id} className="rounded-2xl border border-slate-100 px-3 py-2 text-[var(--brand-text)] dark:border-white/10">
              <p className="text-sm font-semibold">
                {new Date(log.createdAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
              <p>
                Orgánico bebida {log.organicBeveragesKg}kg · Alimentos {log.organicFoodsKg}kg · Inorgánico {log.inorganicKg}kg
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderSummaryTab = () => (
    <div className="space-y-4 rounded-3xl border border-primary-100/60 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <p className="badge">Resumen sanitario del mes</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {summaryCards.map((card) => (
          <div
            key={card.title}
            className={`rounded-3xl border px-4 py-3 ${card.tone === 'danger'
              ? 'border-danger-200 bg-danger-50/70 text-danger-900 dark:border-danger-500/40 dark:bg-danger-900/20 dark:text-danger-100'
              : card.tone === 'amber'
                ? 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-50'
                : card.tone === 'emerald'
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-900/20 dark:text-emerald-50'
                  : card.tone === 'primary'
                    ? 'border-primary-100 bg-primary-50/70 text-primary-900 dark:border-primary-300/40 dark:bg-primary-900/20 dark:text-primary-50'
                    : 'border-slate-100 bg-white/90 text-[var(--brand-text)] dark:border-white/10 dark:bg-white/10 dark:text-white'
              }`}
          >
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">{card.title}</p>
            <p className="text-2xl font-semibold">{card.value}</p>
            <p className="text-xs text-[var(--brand-muted)]">{card.detail}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Historial higiene</p>
          <div className="mt-2 space-y-2">
            {hygieneHistory.length === 0 ? (
              <p className="text-sm text-[var(--brand-muted)]">Aún no hay registros este mes.</p>
            ) : (
              hygieneHistory.map((entry: HygieneLogEntry) => (
                <div key={entry.id} className="rounded-2xl border border-primary-50/70 px-3 py-2 text-sm">
                  <p className="font-semibold">{HYGIENE_AREAS[entry.area].label}</p>
                  <p className="text-xs text-[var(--brand-muted)]">
                    {new Date(entry.createdAt).toLocaleString('es-MX')}
                  </p>
                  {entry.observations && (
                    <p className="text-xs text-[var(--brand-muted)]">Notas: {entry.observations}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--brand-muted)]">Alertas de inventario</p>
          <div className="mt-2 space-y-2">
            {lowStockEntries.length === 0 ? (
              <p className="text-sm text-[var(--brand-muted)]">Sin insumos por debajo del mínimo.</p>
            ) : (
              lowStockEntries.slice(0, 4).map((entry: SmartInventoryEntry) => (
                <div key={`${entry.branchId}-${entry.itemId}`} className="rounded-2xl border border-emerald-100 px-3 py-2 text-xs">
                  <p className="font-semibold">{entry.name}</p>
                  <p>
                    {entry.quantity.toFixed(1)} {entry.unit} · mínimo {entry.minStock.toFixed(1)} (
                    {Math.round(entry.percentAvailable * 100)}%)
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'hygiene':
        return renderHygieneTab();
      case 'pest':
        return renderPestTab();
      case 'inventory':
        return renderInventoryTab();
      case 'waste':
        return renderWasteTab();
      default:
        return renderSummaryTab();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-primary-100/60 bg-white/80 px-4 py-3 dark:border-white/10 dark:bg-white/5">
        <div>
          <p className="badge">COFEPRIS · NOM-251</p>
          <p className="text-sm text-[var(--brand-muted)]">
            Higiene, control de plagas, manejo de alimentos y bitácoras de residuos por sucursal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="text-[var(--brand-muted)]">
            Mes
            <input
              type="month"
              value={hygieneMonth}
              onChange={(event) => setHygieneMonth(event.target.value)}
              className="ml-2 rounded-xl border border-primary-100/70 bg-white px-2 py-1 text-[var(--brand-text)] focus:border-primary-400 focus:outline-none dark:border-white/10 dark:bg-white/10"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { value: 'csv', label: 'CSV', variant: 'solid' },
              { value: 'xlsx', label: 'Excel', variant: 'ghost' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                className={item.variant === 'solid' ? 'brand-button text-xs' : 'brand-button--ghost text-xs'}
                onClick={() => void handleExportReport(item.value as 'csv' | 'xlsx')}
              >
                Exportar {item.label}
              </button>
            ))}
            <ChartButton
              key={activeTab}
              title={currentChartPresentation.title}
              data={chartData}
              yAxisLabel={currentChartPresentation.yLabel}
            />
          </div>
          {exportStatus.type !== 'idle' && (
            <span
              className={`rounded-full px-3 py-1 ${exportStatus.type === 'error'
                ? 'bg-danger-50 text-danger-700'
                : exportStatus.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-primary-50 text-primary-700'
                }`}
            >
              {exportStatus.message ?? 'Preparando…'}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {COFEPRIS_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              className={`rounded-full border px-4 py-1 text-xs font-semibold transition ${isActive
                ? 'border-primary-500 bg-primary-100 text-primary-700'
                : 'border-primary-100 text-[var(--brand-muted)] hover:border-primary-200'
                }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {renderActiveTab()}
    </div>
  );
};

export const CofeprisPanel = SanitaryCompliancePanel;
