-- Tablas para gestionar disponibilidad de productos
-- Versión corregida para compatibilidad con el código actual

-- Tabla de disponibilidad de productos
CREATE TABLE product_availability (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL,
    productType TEXT NOT NULL CHECK (productType IN ('beverage', 'food', 'package')),
    availabilityStatus TEXT NOT NULL DEFAULT 'available' CHECK (availabilityStatus IN ('available', 'low_stock', 'unavailable')),
    reason TEXT NULL,
    staffId TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejor rendimiento
CREATE INDEX product_availability_product_idx ON product_availability(productId);
CREATE INDEX product_availability_type_idx ON product_availability(productType);
CREATE INDEX product_availability_status_idx ON product_availability(availabilityStatus);
CREATE INDEX product_availability_staff_idx ON product_availability(staffId);

-- Tabla de historial de cambios de disponibilidad
CREATE TABLE availability_history (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL,
    productType TEXT NOT NULL CHECK (productType IN ('beverage', 'food', 'package')),
    previousStatus TEXT NOT NULL CHECK (previousStatus IN ('available', 'low_stock', 'unavailable')),
    newStatus TEXT NOT NULL CHECK (newStatus IN ('available', 'low_stock', 'unavailable')),
    reason TEXT NULL,
    staffId TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índices para historial
CREATE INDEX availability_history_product_idx ON availability_history(productId);
CREATE INDEX availability_history_staff_idx ON availability_history(staffId);
CREATE INDEX availability_history_created_idx ON availability_history(createdAt);

-- NOTA: Este SQL es compatible con el código actualizado que usa:
-- - availabilityStatus (TEXT) en lugar de isAvailable (INTEGER)
-- - 3 estados: 'available', 'low_stock', 'unavailable'
-- - Soporte completo para el panel de disponibilidad
