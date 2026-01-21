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

import { supabaseAdmin } from '@/lib/supabase-server';
import { sqlite } from '@/lib/sqlite';
import {
  enqueuePendingOperations,
  flushPendingOperations,
  isLikelyNetworkError,
  markSupabaseFailure,
  markSupabaseHealthy,
  shouldPreferSupabase,
  type PendingOperation,
} from '@/lib/offline-sync';

export type DatabaseResult<T> = {
  data: T | null;
  error: Error | null;
  source: 'supabase' | 'sqlite';
  fallbackUsed: boolean;
};

export type DatabaseQuery<T = any> = {
  execute: () => Promise<DatabaseResult<T>>;
};

export class DatabaseManager {
  private static instance: DatabaseManager;
  
  private constructor() {}
  
  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  async select<T>(
    table: string,
    options: {
      columns?: string[];
      filters?: Record<string, any>;
      orderBy?: { column: string; ascending?: boolean };
      limit?: number;
      single?: boolean;
    } = {}
  ): Promise<DatabaseResult<T | T[]>> {
    const { columns = ['*'], filters = {}, orderBy, limit, single = false } = options;
    
    // Try Supabase first
    if (shouldPreferSupabase()) {
      try {
        let query = supabaseAdmin.from(table).select(columns.join(','));
        
        // Apply filters
        Object.entries(filters).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            query = query.in(key, value);
          } else {
            query = query.eq(key, value);
          }
        });
        
        // Apply ordering
        if (orderBy) {
          query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
        }
        
        // Apply limit
        if (limit) {
          query = query.limit(limit);
        }
        
        // Execute query
        const result = single ? await query.maybeSingle() : await query;
        
        if (result.error) {
          throw result.error;
        }
        
        markSupabaseHealthy();
        return {
          data: result.data as T | T[],
          error: null,
          source: 'supabase',
          fallbackUsed: false,
        };
      } catch (error) {
        if (!isLikelyNetworkError(error)) {
          return {
            data: null,
            error: error as Error,
            source: 'supabase',
            fallbackUsed: false,
          };
        }
        markSupabaseFailure(error);
        // Fall back to SQLite
        return this.selectFromSQLite<T>(table, options, true);
      }
    }
    
    // Use SQLite directly
    return this.selectFromSQLite<T>(table, options, false);
  }

  private async selectFromSQLite<T>(
    table: string,
    options: {
      columns?: string[];
      filters?: Record<string, any>;
      orderBy?: { column: string; ascending?: boolean };
      limit?: number;
      single?: boolean;
    },
    fallbackUsed: boolean
  ): Promise<DatabaseResult<T | T[]>> {
    const { columns = ['*'], filters = {}, orderBy, limit, single = false } = options;
    
    try {
      // Build SQL query
      let sql = `SELECT ${columns.join(', ')} FROM ${table}`;
      const bindings: Record<string, any> = {};
      const whereConditions: string[] = [];
      
      // Add WHERE conditions
      Object.entries(filters).forEach(([key, value], index) => {
        const paramKey = `:param_${index}`;
        if (Array.isArray(value)) {
          whereConditions.push(`${key} IN (${paramKey})`);
          bindings[paramKey] = value;
        } else {
          whereConditions.push(`${key} = ${paramKey}`);
          bindings[paramKey] = value;
        }
      });
      
      if (whereConditions.length > 0) {
        sql += ` WHERE ${whereConditions.join(' AND ')}`;
      }
      
      // Add ORDER BY
      if (orderBy) {
        sql += ` ORDER BY ${orderBy.column} ${orderBy.ascending ? 'ASC' : 'DESC'}`;
      }
      
      // Add LIMIT
      if (limit) {
        sql += ` LIMIT ${limit}`;
      }
      
      // Execute query
      const result = single 
        ? await sqlite.get<T>(sql, bindings)
        : await sqlite.all<T>(sql, bindings);
      
      return {
        data: result as T | T[],
        error: null,
        source: 'sqlite',
        fallbackUsed,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
        source: 'sqlite',
        fallbackUsed,
      };
    }
  }

  async insert(
    table: string,
    data: Record<string, any> | Record<string, any>[]
  ): Promise<DatabaseResult<any>> {
    const dataArray = Array.isArray(data) ? data : [data];
    
    // Try Supabase first
    if (shouldPreferSupabase()) {
      try {
        const { data: result, error } = await supabaseAdmin
          .from(table)
          .insert(dataArray);
          
        if (error) {
          throw error;
        }
        
        markSupabaseHealthy();
        return {
          data: result,
          error: null,
          source: 'supabase',
          fallbackUsed: false,
        };
      } catch (error) {
        if (!isLikelyNetworkError(error)) {
          return {
            data: null,
            error: error as Error,
            source: 'supabase',
            fallbackUsed: false,
          };
        }
        markSupabaseFailure(error);
        
        // Queue for later sync and insert into SQLite
        await this.queueOperation('insert', table, dataArray);
        return this.insertIntoSQLite(table, dataArray, true);
      }
    }
    
    // Queue for later sync and insert into SQLite
    await this.queueOperation('insert', table, dataArray);
    return this.insertIntoSQLite(table, dataArray, false);
  }

  async upsert(
    table: string,
    data: Record<string, any> | Record<string, any>[],
    options?: { onConflict?: string }
  ): Promise<DatabaseResult<any>> {
    const dataArray = Array.isArray(data) ? data : [data];
    
    // Try Supabase first
    if (shouldPreferSupabase()) {
      try {
        const { data: result, error } = await supabaseAdmin
          .from(table)
          .upsert(dataArray, options);
          
        if (error) {
          throw error;
        }
        
        markSupabaseHealthy();
        return {
          data: result,
          error: null,
          source: 'supabase',
          fallbackUsed: false,
        };
      } catch (error) {
        if (!isLikelyNetworkError(error)) {
          return {
            data: null,
            error: error as Error,
            source: 'supabase',
            fallbackUsed: false,
          };
        }
        markSupabaseFailure(error);
        
        // Queue for later sync and insert into SQLite
        await this.queueOperation('upsert', table, dataArray, options);
        return this.upsertIntoSQLite(table, dataArray, options, true);
      }
    }
    
    // Queue for later sync and insert into SQLite
    await this.queueOperation('upsert', table, dataArray, options);
    return this.upsertIntoSQLite(table, dataArray, options, false);
  }

  async update(
    table: string,
    data: Record<string, any>,
    filters: Record<string, any>
  ): Promise<DatabaseResult<any>> {
    // Try Supabase first
    if (shouldPreferSupabase()) {
      try {
        let query = supabaseAdmin.from(table).update(data);
        
        // Apply filters
        Object.entries(filters).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            query = query.in(key, value);
          } else {
            query = query.eq(key, value);
          }
        });
        
        const { data: result, error } = await query;
        
        if (error) {
          throw error;
        }
        
        markSupabaseHealthy();
        return {
          data: result,
          error: null,
          source: 'supabase',
          fallbackUsed: false,
        };
      } catch (error) {
        if (!isLikelyNetworkError(error)) {
          return {
            data: null,
            error: error as Error,
            source: 'supabase',
            fallbackUsed: false,
          };
        }
        markSupabaseFailure(error);
        
        // Queue for later sync and update SQLite
        await this.queueOperation('update', table, data, filters);
        return this.updateIntoSQLite(table, data, filters, true);
      }
    }
    
    // Queue for later sync and update SQLite
    await this.queueOperation('update', table, data, filters);
    return this.updateIntoSQLite(table, data, filters, false);
  }

  async delete(
    table: string,
    filters: Record<string, any>
  ): Promise<DatabaseResult<any>> {
    // Try Supabase first
    if (shouldPreferSupabase()) {
      try {
        let query = supabaseAdmin.from(table).delete();
        
        // Apply filters
        Object.entries(filters).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            query = query.in(key, value);
          } else {
            query = query.eq(key, value);
          }
        });
        
        const { data: result, error } = await query;
        
        if (error) {
          throw error;
        }
        
        markSupabaseHealthy();
        return {
          data: result,
          error: null,
          source: 'supabase',
          fallbackUsed: false,
        };
      } catch (error) {
        if (!isLikelyNetworkError(error)) {
          return {
            data: null,
            error: error as Error,
            source: 'supabase',
            fallbackUsed: false,
          };
        }
        markSupabaseFailure(error);
        
        // Queue for later sync and delete from SQLite
        await this.queueOperation('delete', table, undefined, filters);
        return this.deleteFromSQLite(table, filters, true);
      }
    }
    
    // Queue for later sync and delete from SQLite
    await this.queueOperation('delete', table, undefined, filters);
    return this.deleteFromSQLite(table, filters, false);
  }

  private async insertIntoSQLite(
    table: string,
    dataArray: Record<string, any>[],
    fallbackUsed: boolean
  ): Promise<DatabaseResult<any>> {
    try {
      for (const data of dataArray) {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = values.map((_, index) => `:value_${index}`);
        
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
        const bindings: Record<string, any> = {};
        
        values.forEach((value, index) => {
          bindings[`:value_${index}`] = value;
        });
        
        await sqlite.run(sql, bindings);
      }
      
      return {
        data: dataArray,
        error: null,
        source: 'sqlite',
        fallbackUsed,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
        source: 'sqlite',
        fallbackUsed,
      };
    }
  }

  private async upsertIntoSQLite(
    table: string,
    dataArray: Record<string, any>[],
    options: { onConflict?: string } | undefined,
    fallbackUsed: boolean
  ): Promise<DatabaseResult<any>> {
    try {
      for (const data of dataArray) {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = values.map((_, index) => `:value_${index}`);
        
        // Simple upsert implementation for SQLite
        // First try to update, if no rows affected then insert
        const idColumn = options?.onConflict || 'id';
        if (data[idColumn]) {
          const updateColumns = columns.filter(col => col !== idColumn);
          const updateSet = updateColumns.map(col => `${col} = :${col}`).join(', ');
          
          const updateSql = `UPDATE ${table} SET ${updateSet} WHERE ${idColumn} = :${idColumn}`;
          const updateBindings = { ...data };
          
          await sqlite.run(updateSql, updateBindings);
          
          // Check if update affected any rows
          const updated = await sqlite.get(
            `SELECT changes() as affected_rows`,
            {}
          );
          
          if (!updated || (updated as any).affected_rows === 0) {
            // Insert new record
            const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
            const insertBindings: Record<string, any> = {};
            
            values.forEach((value, index) => {
              insertBindings[`:value_${index}`] = value;
            });
            
            await sqlite.run(insertSql, insertBindings);
          }
        } else {
          // Just insert if no ID provided
          const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
          const bindings: Record<string, any> = {};
          
          values.forEach((value, index) => {
            bindings[`:value_${index}`] = value;
          });
          
          await sqlite.run(sql, bindings);
        }
      }
      
      return {
        data: dataArray,
        error: null,
        source: 'sqlite',
        fallbackUsed,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
        source: 'sqlite',
        fallbackUsed,
      };
    }
  }

  private async updateIntoSQLite(
    table: string,
    data: Record<string, any>,
    filters: Record<string, any>,
    fallbackUsed: boolean
  ): Promise<DatabaseResult<any>> {
    try {
      const setClause = Object.keys(data).map(key => `${key} = :${key}`).join(', ');
      const whereConditions: string[] = [];
      const bindings: Record<string, any> = { ...data };
      
      Object.entries(filters).forEach(([key, value], index) => {
        const paramKey = `:filter_${index}`;
        whereConditions.push(`${key} = ${paramKey}`);
        bindings[paramKey] = value;
      });
      
      const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereConditions.join(' AND ')}`;
      await sqlite.run(sql, bindings);
      
      return {
        data: null,
        error: null,
        source: 'sqlite',
        fallbackUsed,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
        source: 'sqlite',
        fallbackUsed,
      };
    }
  }

  private async deleteFromSQLite(
    table: string,
    filters: Record<string, any>,
    fallbackUsed: boolean
  ): Promise<DatabaseResult<any>> {
    try {
      const whereConditions: string[] = [];
      const bindings: Record<string, any> = {};
      
      Object.entries(filters).forEach(([key, value], index) => {
        const paramKey = `:filter_${index}`;
        whereConditions.push(`${key} = ${paramKey}`);
        bindings[paramKey] = value;
      });
      
      const sql = `DELETE FROM ${table} WHERE ${whereConditions.join(' AND ')}`;
      await sqlite.run(sql, bindings);
      
      return {
        data: null,
        error: null,
        source: 'sqlite',
        fallbackUsed,
      };
    } catch (error) {
      return {
        data: null,
        error: error as Error,
        source: 'sqlite',
        fallbackUsed,
      };
    }
  }

  private async queueOperation(
    type: 'insert' | 'upsert' | 'update' | 'delete',
    table: string,
    data?: Record<string, any> | Record<string, any>[],
    filters?: Record<string, any>,
    options?: { onConflict?: string }
  ): Promise<void> {
    const operations: PendingOperation[] = [];
    
    const dataArray = Array.isArray(data) ? data : (data ? [data] : []);
    
    if (type === 'delete') {
      operations.push({
        type: 'delete',
        table,
        match: filters,
      });
    } else {
      dataArray.forEach(item => {
        operations.push({
          type: type as 'insert' | 'upsert',
          table,
          payload: item,
          options: type === 'upsert' ? options : undefined,
        });
      });
    }
    
    await enqueuePendingOperations(`db:${table}`, operations);
  }

  async syncPending(): Promise<void> {
    await flushPendingOperations();
  }

  isHealthy(): boolean {
    return shouldPreferSupabase();
  }
}

// Export singleton instance and types
export const db = DatabaseManager.getInstance();
