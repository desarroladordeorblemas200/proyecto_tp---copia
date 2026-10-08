// ============================================
// app.js - Lógica del sistema biométrico
// ============================================

const API = '';
let modelosCargados = false;
let camaraActiva = { login: false, register: false };
let descriptorActual = { login: null, register: null };
let streamActual = { login: null, register: null };
let animationFrame = { login: null, register: null };

// Detectar si es localhost o IP para la API
const API_BASE = window.location.origin;

// ============================================
// INICIALIZACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  verificarServidor();
  await cargarModelos();
  setTimeout(() => iniciarCamara('login'), 500);
});

// ============================================
// CAMBIO DE PESTAÑAS
// ============================================
function cambiarTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');

  const otras = tab === 'login' ? 'register' : 'login';
  detenerCamara(otras);
  if (modelosCargados) {
    setTimeout(() => iniciarCamara(tab), 300);
  }
}

// ============================================
// CARGA DE MODELOS FACE-API
// ============================================
async function cargarModelos() {
  actualizarEstado('dot-modelos', 'loading', 'Cargando...');
  try {
    const MODEL_URL = '/models';
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    modelosCargados = true;
    actualizarEstado('dot-modelos', 'online', 'Cargados ✓');
    habilitarBotonesCamara(true);
  } catch (err) {
    actualizarEstado('dot-modelos', 'offline', `Error: ${err.message}`);
    mostrarResultado('resultado-login', `Error cargando modelos: ${err.message}`, 'error');
  }
}

function habilitarBotonesCamara(enabled) {
  document.getElementById('btn-capture-login').disabled = !enabled;
  document.getElementById('btn-capture-register').disabled = !enabled;
}

// ============================================
// CÁMARA WEB
// ============================================
async function iniciarCamara(tipo) {
  if (camaraActiva[tipo]) return;
  const video = document.getElementById(`video-${tipo}`);
  const placeholder = document.getElementById(`placeholder-${tipo}`);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }
    });
    video.srcObject = stream;
    streamActual[tipo] = stream;
    camaraActiva[tipo] = true;
    video.style.display = 'block';
    placeholder.style.display = 'none';
    actualizarEstado('dot-camara', 'online', 'Activa');
    document.getElementById(`txt-camara`).textContent = 'Activa';

    video.addEventListener('loadedmetadata', () => {
      iniciarDeteccion(tipo);
    }, { once: true });
  } catch (err) {
    placeholder.innerHTML = `<span class="placeholder-icon">⚠️</span><p>Error: ${err.message}</p>`;
    actualizarEstado('dot-camara', 'offline', 'Error');
  }
}

function detenerCamara(tipo) {
  if (animationFrame[tipo]) {
    cancelAnimationFrame(animationFrame[tipo]);
    animationFrame[tipo] = null;
  }
  if (streamActual[tipo]) {
    streamActual[tipo].getTracks().forEach(t => t.stop());
    streamActual[tipo] = null;
  }
  const video = document.getElementById(`video-${tipo}`);
  if (video) {
    video.srcObject = null;
    video.style.display = 'none';
  }
  const placeholder = document.getElementById(`placeholder-${tipo}`);
  if (placeholder) placeholder.style.display = 'flex';
  camaraActiva[tipo] = false;
  document.getElementById(`status-${tipo}`).textContent = 'Cámara detenida';
  document.getElementById(`status-${tipo}`).className = 'status';
}

// ============================================
// DETECCIÓN FACIAL EN TIEMPO REAL
// ============================================
function iniciarDeteccion(tipo) {
  const video = document.getElementById(`video-${tipo}`);
  const canvas = document.getElementById(`overlay-${tipo}`);
  const ctx = canvas.getContext('2d');

  async function detectar() {
    if (!camaraActiva[tipo] || video.paused || video.ended) return;

    const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
    canvas.width = displaySize.width;
    canvas.height = displaySize.height;

    const detecciones = await faceapi.detectAllFaces(video)
      .withFaceLandmarks()
      .withFaceDescriptors();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detecciones.length > 0) {
      const resized = faceapi.resizeResults(detecciones, displaySize);
      faceapi.draw.drawDetections(canvas, resized);
      faceapi.draw.drawFaceLandmarks(canvas, resized);

      document.getElementById(`status-${tipo}`).textContent = `✓ Rostro detectado (${detecciones.length})`;
      document.getElementById(`status-${tipo}`).className = 'status success';
      document.getElementById(`btn-capture-${tipo}`).disabled = false;
    } else {
      document.getElementById(`status-${tipo}`).textContent = 'Sin rostro detectado';
      document.getElementById(`status-${tipo}`).className = 'status';
      document.getElementById(`btn-capture-${tipo}`).disabled = true;
    }

    animationFrame[tipo] = requestAnimationFrame(detectar);
  }

  detectar();
}

// ============================================
// CAPTURA DE ROSTRO (extraer descriptor)
// ============================================
async function capturarRostro(tipo) {
  const status = document.getElementById(`status-${tipo}`);
  const video = document.getElementById(`video-${tipo}`);

  status.textContent = '⏳ Capturando rostro...';
  status.className = 'status capturing';
  document.getElementById(`btn-capture-${tipo}`).disabled = true;

  try {
    const deteccion = await faceapi.detectSingleFace(video)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!deteccion) {
      status.textContent = '✗ No se detectó ningún rostro. Intenta de nuevo.';
      status.className = 'status error';
      document.getElementById(`btn-capture-${tipo}`).disabled = false;
      return;
    }

    descriptorActual[tipo] = Array.from(deteccion.descriptor);

    status.textContent = '✓ Rostro capturado correctamente';
    status.className = 'status success';

    const overlay = document.getElementById(`overlay-${tipo}`);
    const ctx = overlay.getContext('2d');
    const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
    overlay.width = displaySize.width;
    overlay.height = displaySize.height;

    const resized = faceapi.resizeResults(deteccion, displaySize);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.strokeStyle = '#64ffda';
    ctx.lineWidth = 3;
    ctx.strokeRect(resized.detection.box.x, resized.detection.box.y,
                   resized.detection.box.width, resized.detection.box.height);

    ctx.fillStyle = '#64ffda';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('✓ ROSTRO CAPTURADO', resized.detection.box.x, resized.detection.box.y - 10);

    if (tipo === 'register') {
      document.getElementById('btn-register').disabled = false;
    }
    if (tipo === 'login') {
      document.getElementById('btn-verify').disabled = false;
    }

  } catch (err) {
    status.textContent = `✗ Error: ${err.message}`;
    status.className = 'status error';
  }
  document.getElementById(`btn-capture-${tipo}`).disabled = false;
}

// ============================================
// REGISTRO DE ESTUDIANTE
// ============================================
async function registrarEstudiante() {
  const matricula = document.getElementById('matricula-register').value.trim();
  const nombre = document.getElementById('nombre-register').value.trim();
  const email = document.getElementById('email-register').value.trim();
  const pin = document.getElementById('pin-register').value;
  const terms = document.getElementById('terms-register').checked;
  const resultBox = document.getElementById('resultado-register');

  if (!matricula || !nombre || !pin) {
    mostrarResultado('resultado-register', 'Completa todos los campos obligatorios (*)', 'error');
    return;
  }
  if (!terms) {
    mostrarResultado('resultado-register', 'Debes aceptar los términos de uso de datos biométricos', 'error');
    return;
  }
  if (pin.length < 4) {
    mostrarResultado('resultado-register', 'El PIN debe tener al menos 4 dígitos', 'error');
    return;
  }
  if (!descriptorActual.register) {
    mostrarResultado('resultado-register', 'Debes capturar tu rostro primero', 'error');
    return;
  }

  abrirModal('Registrando estudiante...');

  try {
    const payload = {
      matricula,
      nombre_completo: nombre,
      email: email || undefined,
      pin,
      descriptor_rostro: descriptorActual.register
    };

    const res = await fetch(`${API_BASE}/api/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    cerrarModal();

    if (res.ok) {
      mostrarResultado('resultado-register', `✓ ${data.mensaje}`, 'success');
      document.getElementById('btn-register').disabled = true;
      document.getElementById('matricula-register').value = '';
      document.getElementById('nombre-register').value = '';
      document.getElementById('email-register').value = '';
      document.getElementById('pin-register').value = '';
      document.getElementById('terms-register').checked = false;
      descriptorActual.register = null;
    } else {
      mostrarResultado('resultado-register', `✗ ${data.error}`, 'error');
    }
  } catch (err) {
    cerrarModal();
    mostrarResultado('resultado-register', `✗ Error de conexión: ${err.message}`, 'error');
  }
}

// ============================================
// VERIFICACIÓN DE IDENTIDAD (Login)
// ============================================
async function verificarIdentidad() {
  const matricula = document.getElementById('matricula-login').value.trim();
  const pin = document.getElementById('pin-login').value;
  const resultBox = document.getElementById('resultado-login');

  if (!matricula) {
    mostrarResultado('resultado-login', 'Ingresa tu matrícula', 'error');
    return;
  }

  abrirModal('Verificando identidad...');

  const payload = { matricula };

  // Simular escaneo de huella si hay PIN
  if (pin) {
    document.getElementById('fingerprint-login').classList.add('scanning');
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('fingerprint-login').classList.remove('scanning');
    payload.pin = pin;
  }

  if (descriptorActual.login) {
    payload.descriptor_rostro = descriptorActual.login;
  }

  try {
    const res = await fetch(`${API_BASE}/api/verificar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    cerrarModal();

    if (res.ok) {
      const met = { rostro: 'solo rostro', pin: 'solo huella (PIN)', ambos: 'rostro + huella' };
      mostrarResultado('resultado-login',
        `✓ ¡Bienvenido, ${data.estudiante.nombre_completo}!
         Matrícula: ${data.estudiante.matricula}
         Método: ${met[data.metodo] || data.metodo}
         Distancia facial: ${data.distancia ? data.distancia.toFixed(4) : 'N/A'}`,
        'success');
      document.getElementById('btn-verify').disabled = true;
    } else {
      let msg = `✗ ${data.error}`;
      if (data.distancia) msg += ` (distancia: ${data.distancia.toFixed(4)})`;
      mostrarResultado('resultado-login', msg, 'error');
    }
  } catch (err) {
    cerrarModal();
    mostrarResultado('resultado-login', `✗ Error de conexión: ${err.message}`, 'error');
  }
}

// ============================================
// VERIFICACIÓN DE SERVIDOR
// ============================================
async function verificarServidor() {
  actualizarEstado('dot-servidor', 'loading', 'Verificando...');
  try {
    const res = await fetch(`${API_BASE}/api/estudiantes`);
    if (res.ok) {
      actualizarEstado('dot-servidor', 'online', 'Conectado ✓');
    } else {
      actualizarEstado('dot-servidor', 'offline', `Error ${res.status}`);
    }
  } catch (err) {
    actualizarEstado('dot-servidor', 'offline', 'Desconectado');
  }
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================
function mostrarResultado(id, mensaje, tipo) {
  const box = document.getElementById(id);
  box.className = `result-box ${tipo}`;
  box.innerHTML = mensaje.replace(/\n/g, '<br>');
  box.style.display = 'block';
}

function actualizarEstado(dotId, estado, texto) {
  const dot = document.getElementById(dotId);
  const txtId = dotId.replace('dot-', 'txt-');
  const txt = document.getElementById(txtId);

  dot.className = `status-dot ${estado}`;
  if (txt) txt.textContent = texto;
}

function abrirModal(texto) {
  document.getElementById('modal-text').textContent = texto || 'Procesando...';
  document.getElementById('modal-loading').style.display = 'flex';
}

function cerrarModal() {
  document.getElementById('modal-loading').style.display = 'none';
}

// ============================================
// VALIDACIONES EN TIEMPO REAL (habilitar registro)
// ============================================
document.getElementById('matricula-register').addEventListener('input', verificarFormularioRegistro);
document.getElementById('nombre-register').addEventListener('input', verificarFormularioRegistro);
document.getElementById('pin-register').addEventListener('input', verificarFormularioRegistro);
document.getElementById('terms-register').addEventListener('change', verificarFormularioRegistro);

function verificarFormularioRegistro() {
  const matricula = document.getElementById('matricula-register').value.trim();
  const nombre = document.getElementById('nombre-register').value.trim();
  const pin = document.getElementById('pin-register').value;
  const terms = document.getElementById('terms-register').checked;

  document.getElementById('btn-register').disabled =
    !(matricula && nombre && pin && pin.length >= 4 && terms && descriptorActual.register);
}

document.getElementById('matricula-login').addEventListener('input', verificarFormularioLogin);
document.getElementById('pin-login').addEventListener('input', verificarFormularioLogin);

function verificarFormularioLogin() {
  const matricula = document.getElementById('matricula-login').value.trim();
  document.getElementById('btn-verify').disabled = !(matricula && descriptorActual.login);
}

// ============================================
// ANIMACIÓN DE HUELLA (fingerprint scan)
// ============================================
document.getElementById('fingerprint-login').addEventListener('click', async function() {
  this.classList.add('scanning');
  await new Promise(r => setTimeout(r, 800));
  this.classList.remove('scanning');
  document.getElementById('pin-login').focus();
});
document.getElementById('fingerprint-register').addEventListener('click', async function() {
  this.classList.add('scanning');
  await new Promise(r => setTimeout(r, 800));
  this.classList.remove('scanning');
  document.getElementById('pin-register').focus();
});
