-- Script de migración seguro - Verifica estado actual antes de modificar

-- 1. Verificar si la columna availabilityStatus ya existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'product_availability' 
        AND column_name = 'availabilitystatus'
    ) THEN
        -- Agregar nueva columna availabilityStatus
        ALTER TABLE product_availability ADD COLUMN availabilityStatus TEXT NOT NULL DEFAULT 'available';
        
        -- Migrar datos de isAvailable a availabilityStatus
        UPDATE product_availability SET availabilityStatus = CASE 
            WHEN isAvailable = 1 THEN 'available'
            WHEN isAvailable = 0 THEN 'unavailable'
            ELSE 'available'
        END;
        
        -- Agregar constraint para availabilityStatus
        ALTER TABLE product_availability ADD CONSTRAINT product_availability_availabilitystatus_check 
            CHECK (availabilityStatus IN ('available', 'low_stock', 'unavailable'));
            
        RAISE NOTICE 'Columna availabilityStatus agregada y datos migrados';
    ELSE
        RAISE NOTICE 'Columna availabilityStatus ya existe';
    END IF;
END $$;

-- 2. Eliminar columna antigua isAvailable si aún existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'product_availability' 
        AND column_name = 'isavailable'
    ) THEN
        ALTER TABLE product_availability DROP COLUMN isAvailable;
        RAISE NOTICE 'Columna isAvailable eliminada';
    ELSE
        RAISE NOTICE 'Columna isAvailable ya no existe';
    END IF;
END $$;

-- 3. Actualizar índices
DROP INDEX IF EXISTS product_availability_available_idx;
CREATE INDEX IF NOT EXISTS product_availability_status_idx ON product_availability(availabilityStatus);

-- 4. Migrar availability_history de forma segura
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'availability_history' 
        AND column_name = 'previousstatus'
    ) THEN
        -- Si las columnas antiguas existen, crear nuevas
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'availability_history' 
            AND column_name = 'previousstatus'
        ) THEN
            -- Renombrar columnas antiguas
            ALTER TABLE availability_history RENAME COLUMN previousStatus TO previousStatus_old;
            ALTER TABLE availability_history RENAME COLUMN newStatus TO newStatus_old;
        END IF;
        
        -- Agregar nuevas columnas
        ALTER TABLE availability_history ADD COLUMN IF NOT EXISTS previousStatus TEXT;
        ALTER TABLE availability_history ADD COLUMN IF NOT EXISTS newStatus TEXT;
        
        -- Migrar datos si existen columnas antiguas
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'availability_history' 
            AND column_name = 'previousstatus_old'
        ) THEN
            UPDATE availability_history SET 
                previousStatus = CASE 
                    WHEN previousStatus_old = 1 THEN 'available'
                    WHEN previousStatus_old = 0 THEN 'unavailable'
                    ELSE 'available'
                END,
                newStatus = CASE 
                    WHEN newStatus_old = 1 THEN 'available'
                    WHEN newStatus_old = 0 THEN 'unavailable'
                    ELSE 'available'
                END;
        END IF;
        
        RAISE NOTICE 'Tabla availability_history migrada';
    ELSE
        RAISE NOTICE 'Tabla availability_history ya está migrada';
    END IF;
END $$;
