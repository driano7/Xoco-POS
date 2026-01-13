#!/usr/bin/env node
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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const envFiles = ['.env.local', '.env'];
const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || line.startsWith('#')) {
        return;
      }
      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) {
        return;
      }
      const key = line.slice(0, eqIndex).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
        return;
      }
      let value = line.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
};

envFiles.forEach((file) => loadEnvFile(path.join(projectRoot, file)));

const sqliteFile = process.env.LOCAL_SQLITE_PATH ?? path.join(projectRoot, 'local.db');
if (!fs.existsSync(sqliteFile)) {
  console.error(`No encontramos la base local en: ${sqliteFile}`);
  process.exit(1);
}

const db = new sqlite3.Database(sqliteFile);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function handleRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this?.changes ?? 0);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows ?? []);
    });
  });

async function tableExists(name) {
  const rows = await all(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) = lower(?) LIMIT 1`,
    [name]
  );
  return rows.length > 0;
}

function formatRow(row) {
  const { id, scope, status, retryCount, lastError, createdAt, updatedAt } = row;
  const displayCreated = createdAt ?? '—';
  const displayUpdated = updatedAt ?? '—';
  return `${id} | ${scope} | ${status} | retries=${retryCount} | created=${displayCreated} | updated=${displayUpdated}` + (lastError ? ` | lastError=${lastError}` : '');
}

async function listEntries() {
  if (!(await tableExists('pos_pending_queue'))) {
    console.log('No existe la tabla pos_pending_queue. No hay operaciones pendientes.');
    return;
  }
  const rows = await all(
    `SELECT id, scope, status, retryCount, lastError, createdAt, updatedAt
     FROM pos_pending_queue
     ORDER BY updatedAt DESC`
  );
  if (!rows.length) {
    console.log('Sin operaciones pendientes.');
    return;
  }
  rows.forEach((row) => {
    console.log(formatRow(row));
  });
}

async function showEntry(id) {
  if (!(await tableExists('pos_pending_queue'))) {
    console.log('No existe la tabla pos_pending_queue.');
    return;
  }
  const rows = await all(`SELECT id, scope, status, retryCount, lastError, payload FROM pos_pending_queue WHERE id = ?`, [id]);
  if (!rows.length) {
    console.log(`No encontramos el registro ${id}.`);
    return;
  }
  const row = rows[0];
  console.log(formatRow(row));
  try {
    const parsed = JSON.parse(row.payload);
    console.log(JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.log('Payload sin formato JSON:');
    console.log(row.payload);
  }
}

async function clearEntries(target, force = false) {
  if (!(await tableExists('pos_pending_queue'))) {
    console.log('No existe la tabla pos_pending_queue. Nada por limpiar.');
    return;
  }
  if (target === 'all') {
    if (!force) {
      console.error('Usa --force para limpiar todos los registros.');
      process.exit(1);
    }
    const removed = await run(`DELETE FROM pos_pending_queue`);
    console.log(`Eliminamos ${removed} registros pendientes.`);
    return;
  }
  const removed = await run(`DELETE FROM pos_pending_queue WHERE id = ?`, [target]);
  if (!removed) {
    console.log('No había registros con ese ID.');
    return;
  }
  console.log(`Eliminamos el registro ${target}.`);
}

async function main() {
  const [command = 'list', arg, maybeFlag] = process.argv.slice(2);
  switch (command) {
    case 'list':
      await listEntries();
      break;
    case 'show':
      if (!arg) {
        console.error('Uso: node scripts/pending-queue.mjs show <id>');
        process.exit(1);
      }
      await showEntry(arg);
      break;
    case 'clear':
      if (!arg) {
        console.error('Uso: node scripts/pending-queue.mjs clear <id|all> [--force]');
        process.exit(1);
      }
      await clearEntries(arg === 'all' ? 'all' : arg, maybeFlag === '--force');
      break;
    default:
      console.log(`Comandos disponibles:
  list                         Lista las operaciones pendientes (default).
  show <id>                    Imprime el payload de una operación.
  clear <id>                   Borra una operación específica.
  clear all --force            Borra toda la cola (requiere --force).`);
      process.exit(0);
  }
}

main()
  .catch((err) => {
    console.error('Error operando la cola pendiente:', err.message);
    process.exit(1);
  })
  .finally(() => {
    db.close();
  });
