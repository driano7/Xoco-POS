#!/bin/bash

# Script para crear tablas de disponibilidad
# Detecta si es SQLite o Supabase y ejecuta el SQL correspondiente

echo "🔍 Detectando tipo de base de datos..."

# Verificar si es SQLite (archivo local.db)
if [ -f "local.db" ]; then
    echo "📦 Detectado: SQLite local"
    echo "🚀 Ejecutando schema-availability.sql..."
    sqlite3 local.db < schema-availability.sql
    if [ $? -eq 0 ]; then
        echo "✅ Tablas de disponibilidad creadas exitosamente en SQLite"
    else
        echo "❌ Error al crear tablas en SQLite"
        exit 1
    fi
else
    echo "☁️ Detectado: Supabase (nube)"
    echo "🚀 Ejecutando schema-availability-supabase.sql..."
    echo "⚠️  NOTA: Debes ejecutar este SQL manualmente en el panel de Supabase"
    echo "📋 SQL para ejecutar en Supabase:"
    echo "----------------------------------------"
    cat schema-availability-supabase.sql
    echo "----------------------------------------"
    echo "📌 Copia y pega este SQL en el panel SQL de Supabase"
fi

echo "🎯 Proceso completado"
