// ============================================
// admin.js - Panel de Administración
// ============================================

const API = window.location.origin;
let estudiantesCache = [];
let logsCache = [];
let estudianteAEliminar = null;

// ============================================
// INICIALIZACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  const sesion = await verificarSesion();
  if (sesion) {
    document.getElementById('admin-welcome').textContent = `Bienvenido, ${sesion.nombre}`;
    mostrarDashboard();
    await cargarStats();
    await cargarEstudiantes();
    await cargarLogs();
  }
});

// ============================================
// VERIFICAR SESIÓN ACTIVA
// ============================================
async function verificarSesion() {
  try {
    const res = await fetch(`${API}/api/admin/sesion`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (e) {}
  return null;
}

// ============================================
// LOGIN / LOGOUT
// ============================================
async function adminLogin() {
  const usuario = document.getElementById('admin-user').value.trim();
  const password = document.getElementById('admin-pass').value;
  const errorBox = document.getElementById('admin-login-error');

  if (!usuario || !password) {
    errorBox.textContent = 'Completá ambos campos';
    errorBox.style.display = 'block';
    return;
  }

  abrirModal('Iniciando sesión...');

  try {
    const res = await fetch(`${API}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ usuario, password })
    });
    const data = await res.json();
    cerrarModal();

    if (res.ok) {
      document.getElementById('admin-welcome').textContent = `Bienvenido, ${data.nombre}`;
      mostrarDashboard();
      await cargarStats();
      await cargarEstudiantes();
      await cargarLogs();
    } else {
      errorBox.textContent = data.error;
      errorBox.style.display = 'block';
    }
  } catch (err) {
    cerrarModal();
    errorBox.textContent = `Error de conexión: ${err.message}`;
    errorBox.style.display = 'block';
  }
}

function adminLogout() {
  fetch(`${API}/api/admin/logout`, { method: 'POST', credentials: 'include' })
    .then(() => location.reload());
  document.getElementById('admin-pass').value = '';
}

function mostrarDashboard() {
  document.getElementById('admin-login').style.display = 'none';
  document.getElementById('admin-dashboard').style.display = 'block';
}

// ============================================
// ESTADÍSTICAS
// ============================================
async function cargarStats() {
  try {
    const res = await fetch(`${API}/api/admin/stats`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('stat-estudiantes').textContent = data.total_estudiantes;
    document.getElementById('stat-rostro').textContent = data.con_rostro;
    document.getElementById('stat-hoy').textContent = data.accesos_hoy;
    document.getElementById('stat-total').textContent = data.total_logs;
    document.getElementById('stat-exitosos').textContent = data.exitosos;
    document.getElementById('stat-fallidos').textContent = data.fallidos;
  } catch (e) {}
}

// ============================================
// PESTAÑAS INTERNAS
// ============================================
function cambiarTabAdmin(tabId) {
  document.querySelectorAll('.admin-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-container .tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.admin-tabs .tab-btn[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

// ============================================
// CRUD ESTUDIANTES
// ============================================
async function cargarEstudiantes() {
  try {
    const res = await fetch(`${API}/api/admin/estudiantes`, { credentials: 'include' });
    if (!res.ok) return;
    estudiantesCache = await res.json();
    renderizarEstudiantes(estudiantesCache);
  } catch (e) {}
}

function renderizarEstudiantes(lista) {
  const tbody = document.getElementById('tbody-estudiantes');
  const empty = document.getElementById('empty-estudiantes');
  const count = document.getElementById('est-count');

  count.textContent = `${lista.length} registros`;

  if (lista.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = lista.map(e => `
    <tr>
      <td>${e.id}</td>
      <td><strong>${escHtml(e.matricula)}</strong></td>
      <td>${escHtml(e.nombre_completo)}</td>
      <td>${e.email ? escHtml(e.email) : '—'}</td>
      <td>${formatearFecha(e.created_at)}</td>
      <td class="actions-cell">
        <button class="btn btn-sm btn-primary" onclick="abrirEditar(${e.id})">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="confirmarEliminar(${e.id}, '${escHtml(e.matricula)}')">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function filtrarEstudiantes() {
  const q = document.getElementById('search-estudiantes').value.toLowerCase();
  const filtrados = estudiantesCache.filter(e =>
    e.matricula.toLowerCase().includes(q) || e.nombre_completo.toLowerCase().includes(q)
  );
  renderizarEstudiantes(filtrados);
}

// ============================================
// ELIMINAR ESTUDIANTE
// ============================================
function confirmarEliminar(id, matricula) {
  estudianteAEliminar = id;
  document.getElementById('modal-confirm-msg').textContent =
    `¿Eliminar al estudiante "${matricula}"? También se borrarán sus logs de acceso.`;
  document.getElementById('btn-confirmar-si').onclick = ejecutarEliminar;
  document.getElementById('modal-confirmar').style.display = 'flex';
}

function cerrarModalConfirmar() {
  document.getElementById('modal-confirmar').style.display = 'none';
  estudianteAEliminar = null;
}

async function ejecutarEliminar() {
  const id = estudianteAEliminar;
  cerrarModalConfirmar();
  if (!id) return;
  abrirModal('Eliminando estudiante...');
  try {
    const res = await fetch(`${API}/api/admin/estudiantes/${id}`, {
      method: 'DELETE', credentials: 'include'
    });
    const data = await res.json();
    cerrarModal();
    if (res.ok) {
      await cargarEstudiantes();
      await cargarStats();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (e) {
    cerrarModal();
    alert('Error de conexión');
  }
  estudianteAEliminar = null;
}

// ============================================
// EDITAR ESTUDIANTE (modal inline)
// ============================================
async function abrirEditar(id) {
  try {
    const res = await fetch(`${API}/api/admin/estudiantes/${id}`, { credentials: 'include' });
    if (!res.ok) return;
    const e = await res.json();

    const nuevoNombre = prompt('Nombre completo:', e.nombre_completo);
    if (nuevoNombre === null) return;

    const nuevoEmail = prompt('Email:', e.email || '');
    if (nuevoEmail === null) return;

    const nuevoPin = prompt('Nuevo PIN (dejar vacío para mantener el actual):', '');
    if (nuevoPin === null) return;

    abrirModal('Actualizando...');
    const body = { nombre_completo: nuevoNombre, email: nuevoEmail };
    if (nuevoPin) body.pin = nuevoPin;

    const res2 = await fetch(`${API}/api/admin/estudiantes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    const data = await res2.json();
    cerrarModal();

    if (res2.ok) {
      await cargarEstudiantes();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (e) {
    cerrarModal();
    alert('Error de conexión');
  }
}

// ============================================
// REGISTRO MANUAL (admin)
// ============================================
async function registroManual() {
  const matricula = document.getElementById('admin-matricula').value.trim();
  const nombre = document.getElementById('admin-nombre').value.trim();
  const email = document.getElementById('admin-email').value.trim();
  const pin = document.getElementById('admin-pin').value;
  const resultBox = document.getElementById('result-registro-manual');

  if (!matricula || !nombre || !pin) {
    resultBox.className = 'result-box error';
    resultBox.textContent = 'Completá matrícula, nombre y PIN';
    resultBox.style.display = 'block';
    return;
  }

  abrirModal('Registrando estudiante...');

  try {
    const res = await fetch(`${API}/api/admin/estudiantes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ matricula, nombre_completo: nombre, email: email || undefined, pin })
    });
    const data = await res.json();
    cerrarModal();

    resultBox.style.display = 'block';
    if (res.ok) {
      resultBox.className = 'result-box success';
      resultBox.textContent = `✓ ${data.mensaje}`;
      document.getElementById('admin-matricula').value = '';
      document.getElementById('admin-nombre').value = '';
      document.getElementById('admin-email').value = '';
      document.getElementById('admin-pin').value = '';
      await cargarEstudiantes();
      await cargarStats();
    } else {
      resultBox.className = 'result-box error';
      resultBox.textContent = `✗ ${data.error}`;
    }
  } catch (e) {
    cerrarModal();
    resultBox.className = 'result-box error';
    resultBox.textContent = `✗ Error de conexión: ${e.message}`;
    resultBox.style.display = 'block';
  }
}

// ============================================
// LOGS DE ACCESO
// ============================================
async function cargarLogs() {
  try {
    const res = await fetch(`${API}/api/admin/logs?limite=200`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    logsCache = data.logs;
    renderizarLogs(logsCache);
    document.getElementById('log-count').textContent = `${data.total} registros`;
  } catch (e) {}
}

function renderizarLogs(logs) {
  const tbody = document.getElementById('tbody-logs');
  const empty = document.getElementById('empty-logs');

  if (logs.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = logs.map(l => {
    const metodoBadge = {
      rostro: '<span class="badge badge-rostro">🫱 Rostro</span>',
      pin: '<span class="badge badge-pin">🔢 PIN</span>',
      ambos: '<span class="badge badge-ambos">🔐 Ambos</span>',
      fallido: '<span class="badge badge-fallido">✗ Fallido</span>'
    }[l.metodo] || l.metodo;

    const resultadoBadge = l.exito
      ? '<span class="badge badge-exito">✓ Éxito</span>'
      : '<span class="badge badge-fallo">✗ Fallo</span>';

    return `<tr class="${l.exito ? '' : 'row-fallo'}">
      <td>${l.id}</td>
      <td>${l.matricula || '—'}</td>
      <td>${l.nombre_completo ? escHtml(l.nombre_completo) : '—'}</td>
      <td>${metodoBadge}</td>
      <td>${resultadoBadge}</td>
      <td>${l.distancia_rostro ? l.distancia_rostro.toFixed(4) : '—'}</td>
      <td>${l.ip || '—'}</td>
      <td>${formatearFecha(l.created_at)}</td>
    </tr>`;
  }).join('');
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatearFecha(fechaStr) {
  if (!fechaStr) return '—';
  const d = new Date(fechaStr + 'Z');
  if (isNaN(d.getTime())) return fechaStr;
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function abrirModal(texto) {
  document.getElementById('modal-text').textContent = texto || 'Procesando...';
  document.getElementById('modal-loading').style.display = 'flex';
}

function cerrarModal() {
  document.getElementById('modal-loading').style.display = 'none';
}
