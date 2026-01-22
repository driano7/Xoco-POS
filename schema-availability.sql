-- Tablas para gestionar disponibilidad de productos
-- Creadas para soportar activación/desactivación de productos del menú

-- Tabla de disponibilidad de productos
CREATE TABLE IF NOT EXISTS product_availability (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL,
    productType TEXT NOT NULL CHECK (productType IN ('beverage', 'food', 'package')),
    isAvailable INTEGER NOT NULL DEFAULT 1 CHECK (isAvailable IN (0, 1)),
    reason TEXT NULL,
    staffId TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS product_availability_product_idx ON product_availability(productId);
CREATE INDEX IF NOT EXISTS product_availability_type_idx ON product_availability(productType);
CREATE INDEX IF NOT EXISTS product_availability_available_idx ON product_availability(isAvailable);
CREATE INDEX IF NOT EXISTS product_availability_staff_idx ON product_availability(staffId);

-- Tabla de historial de cambios de disponibilidad
CREATE TABLE IF NOT EXISTS availability_history (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL,
    productType TEXT NOT NULL CHECK (productType IN ('beverage', 'food', 'package')),
    previousStatus INTEGER NOT NULL CHECK (previousStatus IN (0, 1)),
    newStatus INTEGER NOT NULL CHECK (newStatus IN (0, 1)),
    reason TEXT NULL,
    staffId TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Índices para historial
CREATE INDEX IF NOT EXISTS availability_history_product_idx ON availability_history(productId);
CREATE INDEX IF NOT EXISTS availability_history_staff_idx ON availability_history(staffId);
CREATE INDEX IF NOT EXISTS availability_history_created_idx ON availability_history(createdAt);

-- Trigger para actualizar updatedAt automáticamente
CREATE TRIGGER update_product_availability_updated_at
    AFTER UPDATE ON product_availability
    FOR EACH ROW
BEGIN
    UPDATE product_availability SET updatedAt = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
