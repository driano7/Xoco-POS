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

type RawBeverageDefinition = {
  label: string;
  category: string;
  subcategory: 'hot' | 'cold';
  sizes: Array<{ label: string; price: number }>;
};

type BeverageDefinition = RawBeverageDefinition & {
  productId: string;
  sizes: Array<{ id: string; label: string; price: number }>;
};

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const buildProductId = (label: string) => `beverage-${slugify(label)}`;

const RAW_BEVERAGES: RawBeverageDefinition[] = [
  {
    label: 'Café mexicano',
    category: 'Bebidas Calientes',
    subcategory: 'hot',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Café expreso',
    category: 'Bebidas Calientes',
    subcategory: 'hot',
    sizes: [{ label: 'Único', price: 55 }],
  },
  {
    label: 'Café capuccino',
    category: 'Bebidas Calientes',
    subcategory: 'hot',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Café moka',
    category: 'Bebidas Calientes',
    subcategory: 'hot',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Chocolate de agua',
    category: 'Bebidas Calientes',
    subcategory: 'hot',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Chocolate de leche',
    category: 'Bebidas Calientes',
    subcategory: 'hot',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Té chai',
    category: 'Bebidas Calientes',
    subcategory: 'hot',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Chai latte',
    category: 'Bebidas Calientes',
    subcategory: 'hot',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Chocolate frío',
    category: 'Bebidas Frías',
    subcategory: 'cold',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Matcha',
    category: 'Bebidas Frías',
    subcategory: 'cold',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Frappé',
    category: 'Bebidas Frías',
    subcategory: 'cold',
    sizes: [
      { label: 'Mediano', price: 55 },
      { label: 'Grande', price: 60 },
    ],
  },
  {
    label: 'Refresco',
    category: 'Bebidas Frías',
    subcategory: 'cold',
    sizes: [
      { label: 'Único', price: 55 },
      { label: 'Grande', price: 55 },
    ],
  },
  {
    label: 'Agua embotellada',
    category: 'Bebidas Frías',
    subcategory: 'cold',
    sizes: [{ label: 'Único', price: 20 }],
  },
  {
    label: 'Agua mineral',
    category: 'Bebidas Frías',
    subcategory: 'cold',
    sizes: [{ label: 'Único', price: 20 }],
  },
];

const toDefinition = (entry: RawBeverageDefinition): BeverageDefinition => {
  const productId = buildProductId(entry.label);
  return {
    ...entry,
    productId,
    sizes: entry.sizes.map((size, index) => ({
      id: slugify(size.label) || `size-${index}`,
      label: size.label,
      price: size.price,
    })),
  };
};

export const FALLBACK_BEVERAGES: BeverageDefinition[] = RAW_BEVERAGES.map(toDefinition);
