# Guía técnica — Sincronizar nuevas tablas del POS

Esta guía describe cómo habilitar la sincronización de tablas adicionales del POS (p. ej. `staff_users`, `prep_queue`, `inventory_items`) entre Supabase y la base SQLite usada por los servicios offline. Los pasos se realizan principalmente en el repositorio `XocoCafe` (fuente de datos) y se consumen desde `Xoco-POS` (endpoints).

## 1. Extender el esquema local (SQLite)

Archivo a modificar: `../XocoCafe/schema.sqlite.sql`.

1. Busca la sección correspondiente al dominio (staff, inventario, cola, etc.) y agrega las columnas relevantes manteniendo los tipos de SQLite (`TEXT`, `INTEGER`, `REAL`, `NUMERIC`, `BOOLEAN` simuladas como `INTEGER`).
2. Mantén los nombres exactamente como en Supabase. El script de sync compara los nombres para mapear registros y evita sincronizar columnas inexistentes.
3. Define llaves primarias y columnas de marcas de tiempo (`createdAt`, `updatedAt`) en el orden real de Supabase. Ejemplo mínimo:

```sql
CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  branchId TEXT,
  firstNameEncrypted TEXT,
  lastNameEncrypted TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

4. Cuando agregues tablas nuevas (p. ej. `inventory_movements`), crea los índices necesarios si los endpoints los requieren (`CREATE INDEX ...`). SQLite soporta los índices simples usados para filtrados locales.

## 2. Registrar la tabla en el script de sincronización

Archivo: `../XocoCafe/scripts/sync-supabase-sqlite.mjs`.

1. Ubica el arreglo `SYNC_TABLES`. Cada entrada debe exponer:
   ```js
   {
     name: 'staff_users',
     pk: 'id',
     updatedColumn: 'updatedAt'
   }
   ```
2. `name` debe coincidir con el nombre real de la tabla en Supabase.
3. `pk` es la columna utilizada para la `ON CONFLICT` local; agrega `id` o el identificador correspondiente.
4. `updatedColumn` debe existir tanto en Supabase como en SQLite y representar la última actualización (`updatedAt` o `createdAt` cuando no exista `updatedAt`). Esta columna permite al script hacer sincronizaciones incrementales.
5. Para tablas con dependencias (ej. `prep_queue` depende de `order_items`), registra primero la tabla base para evitar referencias huérfanas durante la primera corrida.

## 3. Ejecutar la sincronización

1. En el repositorio `XocoCafe`, instala dependencias (`npm install`) si es la primera vez.
2. Exporta las variables requeridas (`SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `SQLITE_PATH`, etc.). Normalmente ya están definidas en `.env.local`.
3. Corre `npm run sync:sqlite`. El script:
   - Lee `schema.sqlite.sql` y recrea el archivo `app.db` (si cambió el esquema).
   - Itera por `SYNC_TABLES`, descarga datos de Supabase en bloques y los inserta en SQLite.
   - Reporta columnas faltantes y las ignora automáticamente para evitar fallas.
4. Repite la ejecución cada vez que agregues columnas nuevas para validar que no existan errores.

## 4. Consumir los datos desde `Xoco-POS`

1. Importa el cliente local en endpoints o servicios: `import { sqlite } from '@/lib/sqlite';`.
2. Para lecturas, usa helpers genéricos: `const staff = await sqlite.all<StaffUser>('SELECT * FROM staff_users WHERE role = ?', ['barista']);`.
3. Para escrituras u operaciones offline-first usa `sqlite.run` o `sqlite.exec`. Si el endpoint necesita seguir funcionando offline, aplica la estrategia write-through: escribe primero en Supabase y, tras el éxito, replica el cambio en SQLite (o al revés si el flujo es offline → online con reintentos).
4. Mantén Supabase como fuente de verdad. Las mutaciones locales deben reconciliarse con Supabase en el mismo endpoint para evitar divergencias.

## 5. Manejo y resolución de conflictos

1. Actualmente el script deja que Supabase gane cuando hay conflictos sobre la `pk`. SQLite se sobrescribe con los datos remotos.
2. Si se necesita lógica especial (inventario, conteos críticos), encapsula la regla antes de `supabase.from(...).upsert` en el servicio correspondiente. Ejemplo: validar que `inventory_items.stock` no sea negativo y ajustar la cantidad antes de confirmar el upsert remoto.
3. Sólo agrega flags o columnas de conflicto si existen en ambos lados; de lo contrario, la columna quedará siempre vacía en SQLite.

## 6. Checklist por tabla

1. [ ] ¿La tabla existe en `schema.sqlite.sql` con todas sus columnas y tipos compatibles?
2. [ ] ¿Tiene `PRIMARY KEY` y las marcas `createdAt`/`updatedAt` (o `created_at` si aplica)?
3. [ ] ¿Registraste la entrada correspondiente en `SYNC_TABLES`?
4. [ ] ¿Ejecutaste `npm run sync:sqlite` y verificaste que no se reportan columnas faltantes?
5. [ ] ¿Actualizaste los endpoints/servicios para leer desde SQLite (`sqlite.all`/`sqlite.run`)?
6. [ ] ¿La lógica write-through mantiene a Supabase como autoridad y replica los cambios locales?

Sigue estos pasos para cada tabla faltante (`staff_users`, `prep_queue`, `inventory_items`, `inventory_movements`, etc.) y repite el proceso cada que se agreguen columnas nuevas para mantener los datos del POS sincronizados.

## 7. Cola offline y reintentos automáticos

Cuando no haya conexión con Supabase, las mutaciones se persisten en SQLite dentro de `pos_pending_queue`. No sincronices esta tabla con Supabase: es exclusiva de la app local y guarda la serie de operaciones (`upsert`, `insert`, `delete`) que deben reintentarse.

- El job se dispara al inicio de cada request crítico (por ejemplo `/api/orders`) mediante `flushPendingOperations`. Se procesan hasta `POS_PENDING_SYNC_BATCH` registros por corrida (por defecto `20`).
- Si un reintento vuelve a fallar por red, el estado se marca como offline y se respeta un intervalo (`SUPABASE_RETRY_DELAY_MS`, 30s por defecto) antes de volver a intentarlo.
- Una vez que todas las operaciones pendientes terminan sin errores, `markSupabaseHealthy` restaura la prioridad de Supabase y las nuevas escrituras se hacen directo en la nube (los pendientes se limpian automáticamente).

Esto garantiza que los pedidos creados offline no se pierdan y que Supabase retome el control apenas la red vuelva sin intervención manual.
