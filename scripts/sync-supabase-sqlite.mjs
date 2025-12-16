#!/usr/bin/env node
/**
 * Incremental synchronization between Supabase (source of truth) and local SQLite.
 * Priority: Supabase -> SQLite. Local changes are pushed only when Supabase
 * doesn't have a newer version of the same record.
 */
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { promisify } from 'node:util';
import fs from 'node:fs';

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const sqliteDb = new sqlite3.Database(sqliteFile);
const all = promisify(sqliteDb.all.bind(sqliteDb));
const run = promisify(sqliteDb.run.bind(sqliteDb));

const tableColumnsCache = new Map();

const SYNC_TABLES = [
  { name: 'users', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'addresses', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'orders', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'order_items', pk: 'id', updatedColumn: 'createdAt' },
  { name: 'tickets', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'payments', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'reservations', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'loyalty_points', pk: 'id', updatedColumn: 'createdAt' },
  { name: 'customer_consumption', pk: 'id', updatedColumn: 'createdAt' },
  { name: 'branches', pk: 'id', updatedColumn: 'updatedAt', pushChanges: false },
  { name: 'order_codes', pk: 'id', updatedColumn: 'createdAt', pushChanges: false },
  { name: 'staff_users', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'staff_sessions', pk: 'id', updatedColumn: 'updatedAt', pushChanges: false },
  { name: 'prep_queue', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'inventory_categories', pk: 'id', fullRefresh: true, pushChanges: false },
  { name: 'inventory_items', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'inventory_stock', pk: 'id', updatedColumn: 'lastUpdatedAt' },
  { name: 'inventory_movements', pk: 'id', updatedColumn: 'createdAt' },
  { name: 'pos_action_logs', pk: 'id', updatedColumn: 'createdAt', pushChanges: false },
  { name: 'report_requests', pk: 'id', updatedColumn: 'updatedAt', pushChanges: false },
  { name: 'reservation_failures', pk: 'id', updatedColumn: 'cleanupAt', pushChanges: false },
  { name: 'pos_queue_entries', pk: 'id', updatedColumn: 'updatedAt' },
  { name: 'inventory_stock_ledger', pk: 'id', updatedColumn: 'createdAt', pushChanges: false },
  { name: 'inventory_stock_entries', pk: 'id', updatedColumn: 'createdAt' },
  { name: 'inventory_stock_entry_items', pk: 'id', fullRefresh: true, pushChanges: false },
];

async function ensureSyncStateTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      tableName TEXT PRIMARY KEY,
      lastSupabasePull TEXT,
      lastSqlitePush TEXT
    )
  `);
}

async function getSyncState(tableName) {
  const row = await all(`SELECT * FROM sync_state WHERE tableName = ?`, [tableName]);
  return row[0] ?? { tableName, lastSupabasePull: null, lastSqlitePush: null };
}

async function updateSyncState(tableName, updates) {
  await run(
    `
    INSERT INTO sync_state (tableName, lastSupabasePull, lastSqlitePush)
    VALUES ($tableName, $lastSupabasePull, $lastSqlitePush)
    ON CONFLICT(tableName) DO UPDATE SET
      lastSupabasePull = COALESCE(EXCLUDED.lastSupabasePull, sync_state.lastSupabasePull),
      lastSqlitePush = COALESCE(EXCLUDED.lastSqlitePush, sync_state.lastSqlitePush)
  `,
    {
      $tableName: tableName,
      $lastSupabasePull: updates.lastSupabasePull ?? null,
      $lastSqlitePush: updates.lastSqlitePush ?? null,
    }
  );
}

async function getColumnSet(tableName) {
  if (tableColumnsCache.has(tableName)) {
    return tableColumnsCache.get(tableName);
  }
  const rows = await all(`PRAGMA table_info(${tableName})`);
  const columnSet = new Set(rows.map((row) => row.name));
  tableColumnsCache.set(tableName, columnSet);
  return columnSet;
}

function filterRowForTable(row, columnSet) {
  if (!columnSet) return row;
  const filtered = {};
  for (const [key, value] of Object.entries(row)) {
    if (columnSet.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function buildUpsertStatement(table, row) {
  const columns = Object.keys(row);
  if (!columns.length) return null;
  const placeholders = columns.map((c) => `:${c}`).join(',');
  const updateAssignments = columns
    .filter((col) => col !== table.pk)
    .map((col) => `${col}=excluded.${col}`)
    .join(',');

  return {
    sql: `INSERT INTO ${table.name} (${columns.join(',')})
          VALUES (${placeholders})
          ON CONFLICT(${table.pk}) DO UPDATE SET ${updateAssignments}`,
    params: columns.reduce((acc, col) => ({ ...acc, [`:${col}`]: row[col] ?? null }), {}),
  };
}

async function pullFromSupabase(table, since) {
  const orderColumn = table.updatedColumn ?? table.pk;
  let query = supabase.from(table.name).select('*').order(orderColumn, { ascending: true });
  if (!table.fullRefresh && table.updatedColumn && since) {
    query = query.gt(table.updatedColumn, since);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`Supabase pull (${table.name}) failed: ${error.message}`);
  }
  return data ?? [];
}

async function upsertRows(rows, table) {
  for (const row of rows) {
    const filteredRow = filterRowForTable(row, table.columnSet);
    const statement = buildUpsertStatement(table, filteredRow);
    if (!statement) continue;
    await run(statement.sql, statement.params);
  }
}

async function pushSqliteChanges(table, since) {
  if (table.pushChanges === false || !table.updatedColumn) {
    return since;
  }
  const updatedColumn = table.updatedColumn;
  const rows = await all(
    `SELECT * FROM ${table.name} WHERE ${updatedColumn} IS NOT NULL AND ${updatedColumn} > ?`,
    [since ?? '1970-01-01']
  );

  for (const row of rows) {
    const { data: remoteRow } = await supabase
      .from(table.name)
      .select(`${updatedColumn}`)
      .eq(table.pk, row[table.pk])
      .maybeSingle();

    if (remoteRow && remoteRow[updatedColumn] && remoteRow[updatedColumn] >= row[updatedColumn]) {
      continue; // Supabase has newer data; skip.
    }

    const { error } = await supabase.from(table.name).upsert(row, { onConflict: table.pk });
    if (error) {
      console.warn(`Failed to push ${table.name} row ${row[table.pk]}: ${error.message}`);
    }
  }
  return rows.length ? rows[rows.length - 1][updatedColumn] : since;
}

async function main() {
  await ensureSyncStateTable();
  for (const table of SYNC_TABLES) {
    table.columnSet = await getColumnSet(table.name);
    const state = await getSyncState(table.name);
    console.log(`\n⏳ Syncing ${table.name}...`);

    const pulledRows = await pullFromSupabase(table, state.lastSupabasePull);
    await upsertRows(pulledRows, table);
    const lastSupabasePull =
      table.fullRefresh || !table.updatedColumn || pulledRows.length === 0
        ? state.lastSupabasePull
        : pulledRows[pulledRows.length - 1][table.updatedColumn];

    const lastSqlitePush = await pushSqliteChanges(table, state.lastSqlitePush);

    await updateSyncState(table.name, { lastSupabasePull, lastSqlitePush });
    console.log(
      `✅ ${table.name} - pulled ${pulledRows.length} rows, pushed ${
        lastSqlitePush === state.lastSqlitePush ? 0 : 'changes'
      }`
    );
  }
  sqliteDb.close();
}

main().catch((err) => {
  console.error(err);
  sqliteDb.close();
  process.exit(1);
});
