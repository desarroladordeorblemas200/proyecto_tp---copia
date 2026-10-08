-- =====================================================
-- SISTEMA DE VALIDACIÓN DE IDENTIDAD ESTUDIANTIL
-- Base de datos: SQLite (estudiantes.db)
-- =====================================================

-- Tabla principal de estudiantes
CREATE TABLE IF NOT EXISTS estudiantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    matricula TEXT UNIQUE NOT NULL,           -- ID único del estudiante
    nombre_completo TEXT NOT NULL,            -- Nombre completo
    email TEXT UNIQUE,                        -- Correo electrónico
    pin_hash TEXT NOT NULL,                   -- Hash del PIN (simula huella)
    descriptor_rostro TEXT,                   -- Vector facial (JSON array 128 floats)
    foto TEXT,                                -- Foto en base64 (opcional)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de logs de acceso biométrico
CREATE TABLE IF NOT EXISTS logs_acceso (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estudiante_id INTEGER,                    -- FK -> estudiantes.id
    matricula TEXT,                           -- Matrícula para lookup rápido
    metodo TEXT CHECK(metodo IN ('rostro','pin','ambos','fallido')),  -- Método usado
    exito INTEGER DEFAULT 0,                  -- 1 = éxito, 0 = fallo
    distancia_rostro REAL,                    -- Distancia euclidiana del rostro
    ip TEXT,                                  -- Dirección IP
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id)
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_estudiantes_matricula ON estudiantes(matricula);
CREATE INDEX IF NOT EXISTS idx_logs_matricula ON logs_acceso(matricula);
CREATE INDEX IF NOT EXISTS idx_logs_fecha ON logs_acceso(created_at);

-- =====================================================
-- PARA MIGRAR A MySQL/PostgreSQL, cambiar:
--   INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL / BIGSERIAL
--   TEXT -> VARCHAR(255)
--   DATETIME -> TIMESTAMP
-- =====================================================
