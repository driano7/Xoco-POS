'use client';

interface CustomerLoyaltyCoffeesProps {
  count?: number | null;
  customerName?: string | null;
  statusLabel?: string;
  subtitle?: string;
}

const MAX_COFFEES = 7;

export function CustomerLoyaltyCoffees({
  count = 0,
  customerName,
  statusLabel = 'Programa activo',
  subtitle = 'Cada sello representa un consumo durante la semana',
}: CustomerLoyaltyCoffeesProps) {
  const normalized = Math.max(0, Math.min(MAX_COFFEES, Math.floor(count ?? 0)));
  const rewardEarned = normalized >= MAX_COFFEES;
  const displayName = customerName?.trim() || 'Cliente';

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#5c3025] via-[#7d4a30] to-[#b46f3c] p-6 text-sm text-white shadow-xl">
      {rewardEarned && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="rounded-2xl bg-white/90 px-6 py-4 text-center text-[#5c3025] shadow-2xl">
            <p className="text-2xl">🎉</p>
            <p className="mt-2 font-semibold">Americano gratis disponible</p>
            <p className="text-xs text-[#7d4a30]">Registra el canje en caja para reiniciar la semana.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.35em] text-white/80">{statusLabel}</p>
          <h3 className="text-2xl font-semibold">{displayName}</h3>
          <p className="text-xs text-white/75">{subtitle}</p>
        </div>
        <div className="rounded-full bg-white/15 px-3 py-1 text-[11px] uppercase tracking-[0.35em] text-white">
          {normalized}/7
        </div>
      </div>

      <div className="mt-6 grid grid-cols-7 gap-3 text-base font-semibold">
        {Array.from({ length: MAX_COFFEES }, (_, index) => {
          const isFilled = index < normalized;
          return (
            <div
              key={index}
              className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/70 ${
                isFilled ? 'bg-white text-[#5c3025] shadow-lg' : 'bg-white/10 text-white/80'
              }`}
            >
              {isFilled ? '☕' : index + 1}
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-2xl border border-white/20 bg-black/10 px-4 py-3 text-center text-xs">
        {rewardEarned
          ? '¡Llevan los 7 sellos! Confirma el beneficio antes de reiniciar su conteo semanal.'
          : `Faltan ${MAX_COFFEES - normalized} sellos para el Americano en cortesía.`}
      </div>
    </div>
  );
}

