# =====================================================
# SISTEMA DE VALIDACIÓN DE IDENTIDAD ESTUDIANTIL
# Servidor en Python (Flask) - reemplaza al backend Node
# Tecnologías: HTML + CSS + JS (frontend) | SQLite (BD) | Python
# Uso: pip install -r requirements.txt  →  python app.py
# =====================================================

import json
import os
import sqlite3
from functools import wraps
from math import inf, sqrt
from pathlib import Path

import bcrypt
from flask import Flask, abort, jsonify, request, send_from_directory, session

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "estudiantes.db"
PUBLIC_DIR = BASE_DIR / "public"

THRESHOLD_ROSTRO = 0.6

app = Flask(__name__, static_folder=None)
app.secret_key = "secreto-biometrico-2026"
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024


# -----------------------------------------------------
# BASE DE DATOS (SQLite)
# -----------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS estudiantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matricula TEXT UNIQUE NOT NULL,
  nombre_completo TEXT NOT NULL,
  email TEXT,
  pin_hash TEXT NOT NULL,
  descriptor_rostro TEXT,
  foto TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logs_acceso (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estudiante_id INTEGER,
  matricula TEXT,
  metodo TEXT CHECK(metodo IN ('rostro','pin','ambos','fallido')),
  exito INTEGER DEFAULT 0,
  distancia_rostro REAL,
  ip TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id)
);

CREATE TABLE IF NOT EXISTS administradores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_estudiantes_matricula ON estudiantes(matricula);
CREATE INDEX IF NOT EXISTS idx_logs_matricula ON logs_acceso(matricula);
CREATE INDEX IF NOT EXISTS idx_logs_fecha ON logs_acceso(created_at);
"""


def init_db():
    with get_db() as conn:
        conn.executescript(DB_SCHEMA)
        default_hash = bcrypt.hashpw(b'12367845', bcrypt.gensalt()).decode('utf-8')
        conn.execute(
            'INSERT OR IGNORE INTO administradores (usuario, nombre, password_hash) VALUES (?, ?, ?)',
            ('admin', 'Administrador', default_hash)
        )


init_db()


# -----------------------------------------------------
# FUNCIONES AUXILIARES
# -----------------------------------------------------
def calcular_distancia(desc1, desc2):
    """Distancia euclidiana entre dos descriptores faciales (128 floats)."""
    if not desc1 or not desc2 or len(desc1) != len(desc2):
        return inf
    return sqrt(sum((float(a) - float(b)) ** 2 for a, b in zip(desc1, desc2)))


def requiere_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get('adminId'):
            return jsonify({'error': 'No autorizado. Inicia sesión como administrador.'}), 401
        return fn(*args, **kwargs)
    return wrapper


# =====================================================
# ENDPOINTS PÚBLICOS (estudiantes)
# =====================================================

# Registro de estudiante
@app.route('/api/registro', methods=['POST'])
def api_registro():
    data = request.get_json(silent=True) or {}
    matricula = (data.get('matricula') or '').strip()
    nombre_completo = (data.get('nombre_completo') or '').strip()
    email = (data.get('email') or '').strip() or None
    pin = data.get('pin') or ''
    descriptor_rostro = data.get('descriptor_rostro')
    foto = data.get('foto')

    if not matricula or not nombre_completo or not pin:
        return jsonify({'error': 'matricula, nombre_completo y pin son requeridos'}), 400
    if len(str(pin)) < 4:
        return jsonify({'error': 'El PIN debe tener al menos 4 caracteres'}), 400

    pin_hash = bcrypt.hashpw(str(pin).encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    descriptor_json = json.dumps(descriptor_rostro) if descriptor_rostro is not None else None

    try:
        with get_db() as conn:
            cur = conn.execute(
                'INSERT INTO estudiantes (matricula, nombre_completo, email, pin_hash, descriptor_rostro, foto) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                (matricula, nombre_completo, email, pin_hash, descriptor_json, foto)
            )
            return jsonify({'success': True, 'id': cur.lastrowid,
                            'mensaje': 'Estudiante registrado correctamente'})
    except sqlite3.IntegrityError:
        return jsonify({'error': 'La matrícula o email ya existe'}), 409
    except sqlite3.Error as e:
        return jsonify({'error': str(e)}), 500


# Verificación completa (rostro + PIN)
@app.route('/api/verificar', methods=['POST'])
def api_verificar():
    data = request.get_json(silent=True) or {}
    matricula = data.get('matricula')
    pin = data.get('pin')
    descriptor_rostro = data.get('descriptor_rostro')

    if not matricula:
        return jsonify({'error': 'matricula es requerida'}), 400

    with get_db() as conn:
        estudiante = conn.execute(
            'SELECT * FROM estudiantes WHERE matricula = ?', (matricula,)
        ).fetchone()

    if estudiante is None:
        return jsonify({'error': 'Estudiante no encontrado'}), 404

    pin_valido = False
    rostro_valido = False
    distancia = None

    if pin and estudiante['pin_hash']:
        try:
            pin_valido = bcrypt.checkpw(str(pin).encode('utf-8'), estudiante['pin_hash'].encode('utf-8'))
        except ValueError:
            pin_valido = False

    if descriptor_rostro and estudiante['descriptor_rostro']:
        try:
            almacenado = json.loads(estudiante['descriptor_rostro'])
            distancia = calcular_distancia(descriptor_rostro, almacenado)
            rostro_valido = distancia <= THRESHOLD_ROSTRO
        except Exception:
            distancia = None

    if pin and descriptor_rostro:
        metodo, exito = 'ambos', pin_valido and rostro_valido
    elif pin:
        metodo, exito = 'pin', pin_valido
    elif descriptor_rostro:
        metodo, exito = 'rostro', rostro_valido
    else:
        metodo, exito = 'fallido', False

    registrar_log(estudiante['id'], matricula, metodo, exito, distancia)

    if not exito:
        errores = []
        if pin and not pin_valido:
            errores.append('PIN incorrecto')
        if descriptor_rostro and not rostro_valido:
            errores.append('Rostro no coincide')
        return jsonify({'error': ' y '.join(errores) or 'Verificación fallida',
                        'exito': False, 'distancia': distancia}), 401

    return jsonify({
        'success': True, 'exito': True, 'metodo': metodo, 'distancia': distancia,
        'estudiante': {
            'id': estudiante['id'],
            'matricula': estudiante['matricula'],
            'nombre_completo': estudiante['nombre_completo'],
            'email': estudiante['email'],
        }
    })


# Verificación solo con rostro
@app.route('/api/verificar-rostro', methods=['POST'])
def api_verificar_rostro():
    data = request.get_json(silent=True) or {}
    descriptor_rostro = data.get('descriptor_rostro')
    if not descriptor_rostro:
        return jsonify({'error': 'Descriptor de rostro requerido'}), 400

    with get_db() as conn:
        estudiantes = conn.execute(
            'SELECT * FROM estudiantes WHERE descriptor_rostro IS NOT NULL'
        ).fetchall()

    mejor_match = None
    menor_distancia = inf
    for est in estudiantes:
        try:
            almacenado = json.loads(est['descriptor_rostro'])
            dist = calcular_distancia(descriptor_rostro, almacenado)
            if dist < menor_distancia:
                menor_distancia = dist
                mejor_match = est
        except Exception:
            continue

    if mejor_match is None or menor_distancia > THRESHOLD_ROSTRO:
        return jsonify({'error': 'Rostro no reconocido', 'exito': False,
                        'distancia': None if menor_distancia == inf else menor_distancia}), 401

    registrar_log(mejor_match['id'], mejor_match['matricula'], 'rostro', True, menor_distancia)

    return jsonify({
        'success': True, 'exito': True, 'metodo': 'rostro', 'distancia': menor_distancia,
        'estudiante': {
            'id': mejor_match['id'],
            'matricula': mejor_match['matricula'],
            'nombre_completo': mejor_match['nombre_completo'],
            'email': mejor_match['email'],
        }
    })


# Obtener estudiante por matrícula
@app.route('/api/estudiantes/<matricula>', methods=['GET'])
def api_estudiante(matricula):
    with get_db() as conn:
        estudiante = conn.execute(
            'SELECT id, matricula, nombre_completo, email, created_at '
            'FROM estudiantes WHERE matricula = ?', (matricula,)
        ).fetchone()
    if estudiante is None:
        return jsonify({'error': 'Estudiante no encontrado'}), 404
    return jsonify(dict(estudiante))


# Estado del servidor (úsado por el frontend para el indicador "Conectado")
@app.route('/api/estudiantes', methods=['GET'])
def api_estudiantes_lista():
    with get_db() as conn:
        total = conn.execute('SELECT COUNT(*) AS total FROM estudiantes').fetchone()['total']
    return jsonify({'status': 'ok', 'total': total})


def registrar_log(estudiante_id, matricula, metodo, exito, distancia):
    try:
        with get_db() as conn:
            conn.execute(
                'INSERT INTO logs_acceso (estudiante_id, matricula, metodo, exito, distancia_rostro, ip) '
                'VALUES (?, ?, ?, ?, ?, ?)',
                (estudiante_id, matricula, metodo, 1 if exito else 0, distancia, request.remote_addr)
            )
    except sqlite3.Error:
        pass


# =====================================================
# ENDPOINTS DE ADMINISTRACIÓN
# =====================================================

# Login de administrador
@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json(silent=True) or {}
    usuario = data.get('usuario')
    password = data.get('password')
    if not usuario or not password:
        return jsonify({'error': 'Usuario y contraseña requeridos'}), 400

    with get_db() as conn:
        admin = conn.execute(
            'SELECT * FROM administradores WHERE usuario = ?', (usuario,)
        ).fetchone()

    if admin is None:
        return jsonify({'error': 'Credenciales inválidas'}), 401

    try:
        valido = bcrypt.checkpw(str(password).encode('utf-8'), admin['password_hash'].encode('utf-8'))
    except ValueError:
        valido = False
    if not valido:
        return jsonify({'error': 'Credenciales inválidas'}), 401

    session['adminId'] = admin['id']
    session['adminUsuario'] = admin['usuario']
    session['adminNombre'] = admin['nombre']

    return jsonify({'success': True, 'nombre': admin['nombre'], 'mensaje': 'Inicio de sesión exitoso'})


# Cerrar sesión admin
@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    session.clear()
    return jsonify({'success': True, 'mensaje': 'Sesión cerrada'})


# Verificar sesión actual
@app.route('/api/admin/sesion', methods=['GET'])
def admin_sesion():
    if not session.get('adminId'):
        return jsonify({'error': 'No hay sesión activa'}), 401
    return jsonify({'success': True, 'nombre': session.get('adminNombre'),
                    'usuario': session.get('adminUsuario')})


# ---- CRUD Estudiantes (admin) ----

@app.route('/api/admin/estudiantes', methods=['GET'])
@requiere_admin
def admin_listar_estudiantes():
    with get_db() as conn:
        filas = conn.execute(
            'SELECT id, matricula, nombre_completo, email, created_at '
            'FROM estudiantes ORDER BY created_at DESC'
        ).fetchall()
    return jsonify([dict(f) for f in filas])


@app.route('/api/admin/estudiantes/<int:estudiante_id>', methods=['GET'])
@requiere_admin
def admin_obtener_estudiante(estudiante_id):
    with get_db() as conn:
        fila = conn.execute('SELECT * FROM estudiantes WHERE id = ?', (estudiante_id,)).fetchone()
    if fila is None:
        return jsonify({'error': 'Estudiante no encontrado'}), 404
    return jsonify(dict(fila))


@app.route('/api/admin/estudiantes', methods=['POST'])
@requiere_admin
def admin_crear_estudiante():
    data = request.get_json(silent=True) or {}
    matricula = (data.get('matricula') or '').strip()
    nombre_completo = (data.get('nombre_completo') or '').strip()
    email = (data.get('email') or '').strip() or None
    pin = data.get('pin') or ''

    if not matricula or not nombre_completo or not pin:
        return jsonify({'error': 'matricula, nombre_completo y pin son requeridos'}), 400

    pin_hash = bcrypt.hashpw(str(pin).encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    try:
        with get_db() as conn:
            cur = conn.execute(
                'INSERT INTO estudiantes (matricula, nombre_completo, email, pin_hash) '
                'VALUES (?, ?, ?, ?)',
                (matricula, nombre_completo, email, pin_hash)
            )
            return jsonify({'success': True, 'id': cur.lastrowid,
                            'mensaje': 'Estudiante creado correctamente'})
    except sqlite3.IntegrityError:
        return jsonify({'error': 'La matrícula o email ya existe'}), 409
    except sqlite3.Error as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/estudiantes/<int:estudiante_id>', methods=['PUT'])
@requiere_admin
def admin_actualizar_estudiante(estudiante_id):
    data = request.get_json(silent=True) or {}
    with get_db() as conn:
        estudiante = conn.execute(
            'SELECT * FROM estudiantes WHERE id = ?', (estudiante_id,)
        ).fetchone()
        if estudiante is None:
            return jsonify({'error': 'Estudiante no encontrado'}), 404

        nueva_matricula = (data.get('matricula') if data.get('matricula') is not None else estudiante['matricula']) or estudiante['matricula']
        nuevo_nombre = data.get('nombre_completo') if data.get('nombre_completo') is not None else estudiante['nombre_completo']
        if 'email' in data:
            nuevo_email = (data.get('email') or '').strip() or None
        else:
            nuevo_email = estudiante['email']
        pin_hash = estudiante['pin_hash']
        if data.get('pin'):
            pin_hash = bcrypt.hashpw(str(data['pin']).encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        try:
            conn.execute(
                'UPDATE estudiantes SET matricula = ?, nombre_completo = ?, email = ?, pin_hash = ?, '
                'updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                (nueva_matricula, nuevo_nombre, nuevo_email, pin_hash, estudiante_id)
            )
            return jsonify({'success': True, 'mensaje': 'Estudiante actualizado correctamente'})
        except sqlite3.IntegrityError:
            return jsonify({'error': 'La matrícula o email ya existe'}), 409
        except sqlite3.Error as e:
            return jsonify({'error': str(e)}), 500


@app.route('/api/admin/estudiantes/<int:estudiante_id>', methods=['DELETE'])
@requiere_admin
def admin_eliminar_estudiante(estudiante_id):
    with get_db() as conn:
        conn.execute('DELETE FROM logs_acceso WHERE estudiante_id = ?', (estudiante_id,))
        cur = conn.execute('DELETE FROM estudiantes WHERE id = ?', (estudiante_id,))
        if cur.rowcount == 0:
            return jsonify({'error': 'Estudiante no encontrado'}), 404
    return jsonify({'success': True, 'mensaje': 'Estudiante eliminado correctamente'})


# ---- Logs ----

@app.route('/api/admin/logs', methods=['GET'])
@requiere_admin
def admin_logs():
    limite = request.args.get('limite', default=100, type=int)
    offset = request.args.get('offset', default=0, type=int)
    with get_db() as conn:
        logs = conn.execute(
            'SELECT l.*, e.nombre_completo FROM logs_acceso l '
            'LEFT JOIN estudiantes e ON l.estudiante_id = e.id '
            'ORDER BY l.created_at DESC LIMIT ? OFFSET ?',
            (limite, offset)
        ).fetchall()
        total = conn.execute('SELECT COUNT(*) AS total FROM logs_acceso').fetchone()['total']
    return jsonify({'logs': [dict(l) for l in logs], 'total': total})


# ---- Estadísticas ----

@app.route('/api/admin/stats', methods=['GET'])
@requiere_admin
def admin_stats():
    with get_db() as conn:
        total_estudiantes = conn.execute('SELECT COUNT(*) AS t FROM estudiantes').fetchone()['t']
        total_logs = conn.execute('SELECT COUNT(*) AS t FROM logs_acceso').fetchone()['t']
        exitosos = conn.execute('SELECT COUNT(*) AS t FROM logs_acceso WHERE exito = 1').fetchone()['t']
        fallidos = conn.execute('SELECT COUNT(*) AS t FROM logs_acceso WHERE exito = 0').fetchone()['t']
        con_rostro = conn.execute(
            'SELECT COUNT(*) AS t FROM estudiantes WHERE descriptor_rostro IS NOT NULL'
        ).fetchone()['t']
        accesos_hoy = conn.execute(
            "SELECT COUNT(*) AS t FROM logs_acceso WHERE DATE(created_at) = DATE('now')"
        ).fetchone()['t']
    return jsonify({
        'total_estudiantes': total_estudiantes,
        'total_logs': total_logs,
        'exitosos': exitosos,
        'fallidos': fallidos,
        'con_rostro': con_rostro,
        'accesos_hoy': accesos_hoy,
    })


# =====================================================
# ARCHIVOS ESTÁTICOS (HTML + CSS + JS + modelos)
# =====================================================

@app.route('/', methods=['GET'])
def servir_index():
    return send_from_directory(PUBLIC_DIR, 'index.html')


@app.route('/<path:filename>', methods=['GET'])
def servir_estaticos(filename):
    if filename.startswith('api/'):
        abort(404)
    return send_from_directory(PUBLIC_DIR, filename)


# =====================================================
# INICIO
# =====================================================
if __name__ == '__main__':
    PORT = int(os.environ.get('PORT', 3000))
    print('====================================================')
    print('  SISTEMA DE VALIDACIÓN BIOMÉTRICA - Python/Flask')
    print('  Estudiantes con Rostro + Huella (PIN)')
    print(f'  Servidor: http://localhost:{PORT}')
    print(f'  Panel Admin: http://localhost:{PORT}/admin.html')
    print('  Usuario: admin | Password: admin123')
    print(f'  BD: {DB_PATH}')
    print('====================================================')
    app.run(host='0.0.0.0', port=PORT, debug=False)