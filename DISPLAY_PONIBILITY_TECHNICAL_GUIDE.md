# 📋 Documentación Técnica - Panel de Disponibilidad de Productos

## 🎯 **Objetivo**
Implementar un panel de disponibilidad de productos que permita gestionar 3 estados (disponible, poca disponibilidad, sin disponibilidad) y se sincronice con la app de clientes.

---

## 🔗 **Endpoints API**

### 1. **GET /api/availability** - Obtener disponibilidad de productos
```typescript
// Método: GET
// URL: https://xoco-pos.vercel.app/api/availability
// Response: 200 OK | 500 Internal Server Error

// Response Structure:
{
  "success": true,
  "data": {
    "beverage": {
      "type": "beverage",
      "title": "Bebidas",
      "icon": "☕",
      "items": [
        {
          "id": "avail_product123",
          "productId": "product123",
          "productType": "beverage",
          "label": "Café Americano",
          "category": "bebidas",
          "subcategory": "calientes",
          "availabilityStatus": "available", // "available" | "low_stock" | "unavailable"
          "reason": null,
          "lastModified": "2026-01-22T14:30:00.000Z",
          "modifiedBy": "staff"
        }
      ],
      "stats": {
        "total": 15,
        "available": 12,
        "unavailable": 3
      }
    },
    "food": { /* similar structure */ },
    "package": { /* similar structure */ }
  }
}
```

### 2. **POST /api/availability** - Actualizar disponibilidad de producto
```typescript
// Método: POST
// URL: https://xoco-pos.vercel.app/api/availability
// Request Body:
{
  "productId": "product123",
  "productType": "beverage", // "beverage" | "food" | "package"
  "availabilityStatus": "low_stock", // "available" | "low_stock" | "unavailable"
  "reason": "Poca disponibilidad" // opcional
}

// Response: 200 OK | 400 Bad Request | 500 Internal Server Error
{
  "success": true
}
```

---

## 🗄️ **Base de Datos - Tabla `products`**

### **Campos Clave para Disponibilidad:**
```sql
-- Tabla: products
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT, -- 'bebidas', 'alimentos', 'paquetes'
  subcategory TEXT,
  
  -- Banderas de stock (usadas por el panel)
  is_low_stock BOOLEAN DEFAULT FALSE,
  out_of_stock_reason TEXT,
  manualStockStatus TEXT DEFAULT 'normal', -- 'normal' | 'low' | 'out'
  manualStockReason TEXT,
  manualStatusUpdatedAt TEXT,
  
  -- Otros campos del producto...
  price REAL,
  description TEXT,
  createdAt TEXT,
  updatedAt TEXT
);
```

### **Mapeo de Estados:**
| Switch Frontend | `manualStockStatus` | `is_low_stock` | `out_of_stock_reason` | `manualStockReason` |
|----------------|---------------------|------------------|----------------------|---------------------|
| ✓ Disponible | `'normal'` | `false` | `null` | `null` |
| ⚠ Poca disponibilidad | `'low'` | `true` | `null` | `'Poca disponibilidad'` |
| ✗ Sin disponibilidad | `'out'` | `false` | `'Sin disponibilidad'` | `'Sin disponibilidad'` |

---

## 🎨 **Frontend - Componente AvailabilityPanel**

### **Ubicación:** `/src/components/availability-panel.tsx`

### **Estados Visuales:**
- **✅ Disponible**: Texto normal (blanco/oscuro)
- **⚠️ Poca disponibilidad**: Texto amarillo (`text-yellow-600 dark:text-yellow-400`)
- **❌ Sin disponibilidad**: Texto rojo (`text-red-600 dark:text-red-400`)

### **Funciones Principales:**
```typescript
// Obtener disponibilidad
const fetchAvailability = useCallback(async () => {
  const response = await fetch('/api/availability');
  const data = await response.json();
  setAvailabilityData(data.data || data);
}, [user]);

// Actualizar disponibilidad
const handleUpdateAvailability = async (
  productId: string,
  productType: ProductType,
  availabilityStatus: AvailabilityStatus,
  reason: string
) => {
  const response = await fetch('/api/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId,
      productType,
      availabilityStatus,
      reason
    })
  });
  await fetchAvailability(); // Recargar datos
};
```

---

## 📱 **Implementación en App de Clientes**

### **1. Obtener disponibilidad actual:**
```javascript
// En la app de clientes
async function getProductAvailability() {
  try {
    const response = await fetch('https://xoco-pos.vercel.app/api/availability');
    const result = await response.json();
    
    if (result.success) {
      const availability = result.data;
      
      // Procesar disponibilidad por producto
      availability.beverage.items.forEach(item => {
        console.log(`${item.label}: ${item.availabilityStatus}`);
      });
      
      availability.food.items.forEach(item => {
        console.log(`${item.label}: ${item.availabilityStatus}`);
      });
      
      availability.package.items.forEach(item => {
        console.log(`${item.label}: ${item.availabilityStatus}`);
      });
    }
  } catch (error) {
    console.error('Error obteniendo disponibilidad:', error);
  }
}
```

### **2. Filtrar productos disponibles:**
```javascript
function getAvailableProducts(allProducts, availabilityData) {
  const availabilityMap = {};
  
  // Crear mapa de disponibilidad
  [...availabilityData.beverage.items, 
   ...availabilityData.food.items, 
   ...availabilityData.package.items].forEach(item => {
    availabilityMap[item.productId] = item.availabilityStatus;
  });
  
  // Filtrar productos disponibles
  return allProducts.filter(product => {
    const status = availabilityMap[product.id];
    return status !== 'unavailable'; // Mostrar disponibles y con poca disponibilidad
  });
}
```

### **3. Mostrar indicadores visuales:**
```javascript
function getProductStatusIndicator(productId, availabilityData) {
  const allItems = [
    ...availabilityData.beverage.items,
    ...availabilityData.food.items,
    ...availabilityData.package.items
  ];
  
  const productItem = allItems.find(item => item.productId === productId);
  
  if (!productItem) return null;
  
  switch (productItem.availabilityStatus) {
    case 'available':
      return { color: 'green', text: 'Disponible', icon: '✓' };
    case 'low_stock':
      return { color: 'yellow', text: 'Poca disponibilidad', icon: '⚠' };
    case 'unavailable':
      return { color: 'red', text: 'No disponible', icon: '✗' };
    default:
      return null;
  }
}
```

---

## 🔧 **Arquitectura del Sistema**

### **Flujo de Datos:**
```
Panel Admin (POS) → /api/availability → Tabla products
     ↓
Banderas: is_low_stock, out_of_stock_reason, manualStockStatus
     ↓
App Clientes → /api/availability → Estados en tiempo real
```

### **Sincronización:**
- **Real-time**: Los cambios se reflejan inmediatamente
- **Sin caché**: El endpoint consulta directamente la BD
- **Consistente**: Mismos productos que en el dropdown del POS

---

## 🚀 **Despliegue y Configuración**

### **Variables de Entorno:**
```env
# Database (automático por Vercel)
DATABASE_URL=postgresql://...

# Supabase (opcional)
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### **Dependencias Clave:**
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "next": "^14.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## 📊 **Estadísticas y Monitoreo**

### **Métricas del Panel:**
- Total de productos por categoría
- Productos disponibles vs no disponibles
- Última modificación por producto
- Historial de cambios (si se implementa)

### **Errores Comunes:**
- **500**: Error en conexión a BD
- **400**: Campos faltantes en POST
- **404**: Producto no encontrado

---

## 🎯 **Resumen de Implementación**

1. **Backend**: Endpoint `/api/availability` que lee/actualiza tabla `products`
2. **Frontend**: Panel con 3 switches y colores dinámicos
3. **Clientes**: Consumen el mismo endpoint para mostrar disponibilidad
4. **BD**: Usa banderas de stock existentes en `products`
5. **Sincronización**: Real-time sin tablas intermedias

**¡Listo para producción!** 🚀
