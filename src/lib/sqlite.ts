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

import path from 'node:path';
import sqlite3 from 'sqlite3';

type SqliteValue = string | number | null | Buffer;

interface SqliteClient {
  run(sql: string, params?: Record<string, SqliteValue> | SqliteValue[]): Promise<void>;
  all<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, SqliteValue> | SqliteValue[]
  ): Promise<T[]>;
  get<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, SqliteValue> | SqliteValue[]
  ): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
}

const SQLITE_PATH =
  process.env.LOCAL_SQLITE_PATH ?? path.join(process.cwd(), process.env.LOCAL_SQLITE_FILE ?? 'local.db');

let sqliteDb: sqlite3.Database | null = null;

const resolveDatabase = () => {
  if (!sqliteDb) {
    sqlite3.verbose();
    sqliteDb = new sqlite3.Database(SQLITE_PATH);
    sqliteDb.run('PRAGMA foreign_keys = ON;');
  }
  return sqliteDb;
};

const promisify =
  <TResult = unknown>(method: (cb: (err: Error | null, result?: TResult) => void) => void) =>
  () =>
    new Promise<TResult>((resolve, reject) => {
      method((err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result as TResult);
        }
      });
    });

const run = (
  sql: string,
  params?: Record<string, SqliteValue> | SqliteValue[]
): Promise<void> =>
  new Promise((resolve, reject) => {
    const db = resolveDatabase();
    const callback = (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };
    if (Array.isArray(params) || !params) {
      db.run(sql, params ?? [], callback);
      return;
    }
    db.run(sql, params, callback);
  });

const all = <T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, SqliteValue> | SqliteValue[]
): Promise<T[]> =>
  new Promise((resolve, reject) => {
    const db = resolveDatabase();
    const callback = (err: Error | null, rows?: T[]) => {
      if (err) {
        reject(err);
      } else {
        resolve((rows as T[]) ?? []);
      }
    };
    if (Array.isArray(params) || !params) {
      db.all(sql, params ?? [], callback);
      return;
    }
    db.all(sql, params, callback);
  });

const get = <T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, SqliteValue> | SqliteValue[]
): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const db = resolveDatabase();
    const callback = (err: Error | null, row?: T) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    };
    if (Array.isArray(params) || !params) {
      db.get(sql, params ?? [], callback);
      return;
    }
    db.get(sql, params, callback);
  });

const exec = (sql: string) => {
  const db = resolveDatabase();
  return promisify<void>((cb) => db.exec(sql, cb))();
};

export const sqlite: SqliteClient = {
  run,
  all,
  get,
  exec,
};

export const getSqliteFilePath = () => SQLITE_PATH;
