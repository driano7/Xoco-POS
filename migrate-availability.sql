-- Script para migrar la tabla existente al nuevo esquema
-- Ejecutar en orden para evitar pérdida de datos

-- 1. Agregar nueva columna availabilityStatus
ALTER TABLE product_availability ADD COLUMN IF NOT EXISTS availabilityStatus TEXT NOT NULL DEFAULT 'available';

-- 2. Migrar datos de isAvailable a availabilityStatus
UPDATE product_availability SET availabilityStatus = CASE 
    WHEN isAvailable = 1 THEN 'available'
    WHEN isAvailable = 0 THEN 'unavailable'
    ELSE 'available'
END;

-- 3. Agregar constraint para availabilityStatus
ALTER TABLE product_availability ADD CONSTRAINT product_availability_availabilitystatus_check 
    CHECK (availabilityStatus IN ('available', 'low_stock', 'unavailable'));

-- 4. Eliminar columna antigua isAvailable
ALTER TABLE product_availability DROP COLUMN IF EXISTS isAvailable;

-- 5. Actualizar índices
DROP INDEX IF EXISTS product_availability_available_idx;
CREATE INDEX IF NOT EXISTS product_availability_status_idx ON product_availability(availabilityStatus);

-- 6. Migrar tabla availability_history
ALTER TABLE availability_history ADD COLUMN IF NOT EXISTS previousStatus TEXT;
ALTER TABLE availability_history ADD COLUMN IF NOT EXISTS newStatus TEXT;

-- 7. Migrar datos de availability_history
UPDATE availability_history SET 
    previousStatus = CASE 
        WHEN previousStatus = 1 THEN 'available'
        WHEN previousStatus = 0 THEN 'unavailable'
        ELSE 'available'
    END,
    newStatus = CASE 
        WHEN newStatus = 1 THEN 'available'
        WHEN newStatus = 0 THEN 'unavailable'
        ELSE 'available'
    END;

-- 8. Agregar constraints a availability_history
ALTER TABLE availability_history ADD CONSTRAINT availability_history_previousstatus_check 
    CHECK (previousStatus IN ('available', 'low_stock', 'unavailable'));
ALTER TABLE availability_history ADD CONSTRAINT availability_history_newstatus_check 
    CHECK (newStatus IN ('available', 'low_stock', 'unavailable'));

-- 9. Eliminar columnas antiguas (si existen)
ALTER TABLE availability_history DROP COLUMN IF EXISTS previousStatus_old;
ALTER TABLE availability_history DROP COLUMN IF EXISTS newStatus_old;
