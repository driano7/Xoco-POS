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

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase-server';
import { sqlite } from '@/lib/sqlite';

const PENDING_QUEUE_TABLE = 'pos_pending_queue';
const NETWORK_ERROR_HINTS = [
  'fetch failed',
  'failed to fetch',
  'network',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
];
const SUPABASE_RETRY_DELAY_MS = Number(process.env.SUPABASE_RETRY_DELAY_MS ?? 30_000);
const MAX_SYNC_BATCH = Number(process.env.POS_PENDING_SYNC_BATCH ?? 20);

type PendingOperation =
  | {
      type: 'upsert' | 'insert';
      table: string;
      payload: Record<string, unknown> | Record<string, unknown>[];
      options?: { onConflict?: string };
    }
  | {
      type: 'delete';
      table: string;
      match?: Record<string, unknown>;
    };

type PendingPayload = {
  operations: PendingOperation[];
  context?: Record<string, unknown>;
};

type PendingQueueRow = {
  id: string;
  scope: string;
  payload: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  retryCount: number;
  lastError?: string | null;
};

const state = {
  supabaseHealthy: true,
  lastFailureAt: 0,
  queueInitialized: false,
  syncPromise: null as Promise<void> | null,
};

const ensureQueueTable = async () => {
  if (state.queueInitialized) {
    return;
  }
  await sqlite.run(
    `
    CREATE TABLE IF NOT EXISTS ${PENDING_QUEUE_TABLE} (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retryCount INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await sqlite.run(
    `CREATE INDEX IF NOT EXISTS ${PENDING_QUEUE_TABLE}_status_idx ON ${PENDING_QUEUE_TABLE}(status, updatedAt)`
  );
  state.queueInitialized = true;
};

const normalizeErrorMessage = (error: unknown) => {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const isLikelyNetworkError = (error: unknown) => {
  const message = normalizeErrorMessage(error).toLowerCase();
  return NETWORK_ERROR_HINTS.some((hint) => message.includes(hint.toLowerCase()));
};

export const markSupabaseHealthy = () => {
  state.supabaseHealthy = true;
};

export const markSupabaseFailure = (error: unknown) => {
  state.supabaseHealthy = false;
  state.lastFailureAt = Date.now();
  console.warn('[offline-sync] Supabase connection marked as offline:', normalizeErrorMessage(error));
};

export const shouldPreferSupabase = () => {
  if (state.supabaseHealthy) {
    return true;
  }
  const elapsed = Date.now() - state.lastFailureAt;
  return elapsed >= SUPABASE_RETRY_DELAY_MS;
};

export const enqueuePendingOperations = async (
  scope: string,
  operations: PendingOperation[],
  context?: Record<string, unknown>
) => {
  if (!operations.length) {
    return null;
  }
  await ensureQueueTable();
  const id = randomUUID();
  const payload: PendingPayload = {
    operations,
    context,
  };
  await sqlite.run(
    `
    INSERT INTO ${PENDING_QUEUE_TABLE} (id, scope, payload, status)
    VALUES (:id, :scope, :payload, 'pending')
  `,
    {
      ':id': id,
      ':scope': scope,
      ':payload': JSON.stringify(payload),
    }
  );
  return id;
};

const applyOperation = async (operation: PendingOperation) => {
  if (operation.type === 'delete') {
    let query = supabaseAdmin.from(operation.table).delete();
    if (operation.match && Object.keys(operation.match).length) {
      query = query.match(operation.match);
    }
    const { error } = await query;
    if (error) {
      throw error;
    }
    return;
  }
  const query = supabaseAdmin.from(operation.table);
  const options = operation.options ?? undefined;
  if (operation.type === 'upsert') {
    const { error } = await query.upsert(operation.payload, options);
    if (error) {
      throw error;
    }
    return;
  }
  if (operation.type === 'insert') {
    const { error } = await query.insert(operation.payload);
    if (error) {
      throw error;
    }
  }
};

const loadPendingQueue = async (): Promise<PendingQueueRow[]> => {
  await ensureQueueTable();
  const rows = await sqlite.all<PendingQueueRow>(
    `
    SELECT id, scope, payload, status, retryCount, lastError
    FROM ${PENDING_QUEUE_TABLE}
    WHERE status IN ('pending','syncing')
    ORDER BY updatedAt ASC
    LIMIT :limit
  `,
    {
      ':limit': MAX_SYNC_BATCH,
    }
  );
  return rows;
};

const updateQueueRow = async (params: {
  id: string;
  status: PendingQueueRow['status'];
  lastError?: string | null;
  incrementRetry?: boolean;
}) => {
  const fragments = ['status = :status', 'updatedAt = CURRENT_TIMESTAMP'];
  const bindings: Record<string, string | number | null> = {
    ':id': params.id,
    ':status': params.status,
    ':lastError': params.lastError ?? null,
  };
  if (params.incrementRetry) {
    fragments.push('retryCount = retryCount + 1');
  }
  fragments.push('lastError = :lastError');
  await sqlite.run(
    `
    UPDATE ${PENDING_QUEUE_TABLE}
    SET ${fragments.join(', ')}
    WHERE id = :id
  `,
    bindings
  );
};

export const flushPendingOperations = async () => {
  if (!shouldPreferSupabase()) {
    return;
  }
  if (state.syncPromise) {
    return state.syncPromise;
  }

  state.syncPromise = (async () => {
    const rows = await loadPendingQueue();
    if (!rows.length) {
      markSupabaseHealthy();
      return;
    }
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as PendingPayload;
      try {
        await updateQueueRow({ id: row.id, status: 'syncing', lastError: null });
        for (const operation of payload.operations) {
          await applyOperation(operation);
        }
        await updateQueueRow({ id: row.id, status: 'synced', lastError: null });
        markSupabaseHealthy();
      } catch (error) {
        const message = normalizeErrorMessage(error);
        const isNetwork = isLikelyNetworkError(error);
        await updateQueueRow({
          id: row.id,
          status: isNetwork ? 'pending' : 'failed',
          lastError: message,
          incrementRetry: true,
        });
        if (isNetwork) {
          markSupabaseFailure(error);
          break;
        } else {
          console.warn('[offline-sync] Failed to replay pending record:', message);
        }
      }
    }
  })()
    .catch((error) => {
      const message = normalizeErrorMessage(error);
      if (isLikelyNetworkError(error)) {
        markSupabaseFailure(error);
      } else {
        console.error('[offline-sync] Unexpected error while flushing queue:', message);
      }
    })
    .finally(() => {
      state.syncPromise = null;
    });

  return state.syncPromise;
};

export const resetSupabaseHealth = () => {
  state.supabaseHealthy = true;
  state.lastFailureAt = 0;
};

export type { PendingOperation, PendingPayload };
