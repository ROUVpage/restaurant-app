// ── UTILS ─────────────────────────────────────────────────────────────────

const DEVICE_KEY = 'restaurant_device_id';
const API_GET_CACHE = new Map();
const API_INFLIGHT = new Map();
const DEFAULT_API_TIMEOUT_MS = 12000;

function getDeviceId() {
  return localStorage.getItem(DEVICE_KEY);
}
function setDeviceId(id) {
  localStorage.setItem(DEVICE_KEY, id);
}
function clearDeviceId() {
  localStorage.removeItem(DEVICE_KEY);
}

function fmt(n) {
  return Number(n).toFixed(2).replace('.', ',') + ' €';
}

function getTableToken() {
  // Extract from URL /mesa/:token/...
  const parts = location.pathname.split('/');
  const mesaIdx = parts.indexOf('mesa');
  return mesaIdx !== -1 ? parts[mesaIdx + 1] : null;
}

async function api(method, path, body, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_API_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  if (controller) opts.signal = controller.signal;

  try {
    const res = await fetch(path, opts);
    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { error: res.ok ? 'Respuesta inválida del servidor' : `Error del servidor (${res.status})` };
      }
    }
    if (!res.ok) {
      return { ...data, error: data.error || `Error HTTP ${res.status}` };
    }
    return data;
  } catch (_) {
    return { error: 'No se pudo conectar con el servidor' };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function apiCached(path, options = {}) {
  const ttlMs = Number(options.ttlMs) >= 0 ? Number(options.ttlMs) : 30000;
  const force = Boolean(options.force);
  const key = `GET:${path}`;
  const now = Date.now();

  if (!force) {
    const cached = API_GET_CACHE.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const pending = API_INFLIGHT.get(key);
    if (pending) return pending;
  }

  const request = api('GET', path, null, { timeoutMs: options.timeoutMs })
    .then((data) => {
      if (!data?.error && ttlMs > 0) {
        API_GET_CACHE.set(key, {
          data,
          expiresAt: Date.now() + ttlMs
        });
      }
      return data;
    })
    .finally(() => {
      API_INFLIGHT.delete(key);
    });

  API_INFLIGHT.set(key, request);
  return request;
}

function showToast(id, ms = 2800) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), ms);
}

function timeSince(ts) {
  const diff = Math.floor((Date.now() / 1000) - ts);
  if (diff < 60) return 'ahora';
  if (diff < 3600) return Math.floor(diff / 60) + ' min';
  return Math.floor(diff / 3600) + ' h';
}
