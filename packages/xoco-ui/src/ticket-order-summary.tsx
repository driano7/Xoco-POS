/*
 * --------------------------------------------------------------------
 *  Xoco Café — Software Property
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
 *  Copyright (c) 2025 Xoco Café.
 *  Desarrollador Principal: Donovan Riaño.
 *
 *  Este archivo está licenciado bajo la Apache License 2.0.
 *  Consulta el archivo LICENSE en la raíz del proyecto para más detalles.
 * --------------------------------------------------------------------
 */

'use client';

interface TicketOrderSummaryProps {
  stats: {
    beverages: number;
    foods: number;
    packages: number;
    other: number;
    total: number;
  };
  packages: Array<{ name: string; quantity: number; contents: string[] }>;
}

const formatStat = (label: string, value: number) => {
  const isFoodsLabel = label.toLowerCase() === 'alimentos';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-center text-xs text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
      <p
        className={`uppercase tracking-[0.25em] text-gray-900 dark:text-gray-100 ${
          isFoodsLabel ? 'text-[9px]' : 'text-[10px]'
        }`}
      >
        {label}
      </p>
      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
};

export default function TicketOrderSummary({ stats, packages }: TicketOrderSummaryProps) {
  const blocks = [
    { label: 'Total', value: stats.total },
    { label: 'Bebidas', value: stats.beverages },
    { label: 'Alimentos', value: stats.foods },
  ];

  if (stats.packages > 0) {
    blocks.push({ label: 'Paquetes', value: stats.packages });
  }
  if (stats.other > 0) {
    blocks.push({ label: 'Otros', value: stats.other });
  }

  return (
    <>
      <div className="my-3 border-t border-dashed border-gray-200" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {blocks.map((block) => (
          <div key={block.label}>{formatStat(block.label, block.value)}</div>
        ))}
      </div>
      {packages.length > 0 && (
        <div className="mt-3 rounded-2xl border border-primary-100 bg-primary-50/60 p-3 text-xs text-primary-900 shadow-inner dark:border-primary-700/40 dark:bg-primary-950/40 dark:text-primary-100">
          <p className="font-semibold uppercase tracking-[0.35em] text-[10px] text-primary-600 dark:text-primary-200">
            Paquetes
          </p>
          <ul className="mt-2 space-y-1">
            {packages.map((pkg, index) => (
              <li key={`${pkg.name}-${index}`}>
                <span className="font-semibold">
                  {pkg.quantity} × {pkg.name}
                </span>
                {pkg.contents.length > 0 && (
                  <span className="block text-[11px] text-primary-800 dark:text-primary-200">
                    Incluye: {pkg.contents.join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-primary-700 dark:text-primary-200">
            *Los cafés dentro de paquetes no suman sellos en el programa de lealtad.*
          </p>
        </div>
      )}
    </>
  );
}
