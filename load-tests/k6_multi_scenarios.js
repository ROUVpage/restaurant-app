import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Base scenario distribution (used to scale to TOTAL_VUS)
const BASE_COUNTS = { browse: 20, reservas: 10, checkout: 10, admin: 5 };
const TOTAL_BASE = Object.values(BASE_COUNTS).reduce((a, b) => a + b, 0);
const TOTAL_VUS = Number(__ENV.TOTAL_VUS) || TOTAL_BASE; // if not set, use default total (45)
const scale = TOTAL_VUS / TOTAL_BASE;
const computedVus = {};
for (const k in BASE_COUNTS) {
  computedVus[k] = Math.max(1, Math.round(BASE_COUNTS[k] * scale));
}

export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', exec: 'browse', vus: computedVus.browse, duration: '30s' },
    reservas: { executor: 'constant-vus', exec: 'reserve', vus: computedVus.reservas, duration: '30s' },
    checkout: { executor: 'constant-vus', exec: 'checkout', vus: computedVus.checkout, duration: '30s' },
    admin: { executor: 'constant-vus', exec: 'adminFlow', vus: computedVus.admin, duration: '30s' },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    checks: ['rate>0.99'],
  },
};

const BASE = __ENV.BASE_URL || 'https://restaurant-app-6678.onrender.com';
const READ_ONLY = (__ENV.READ_ONLY === '1' || __ENV.READ_ONLY === 'true');
const FAILED_CAPTURE_CAP = Number(__ENV.FAILED_CAPTURE_CAP) || 200;
const FAILED_BODY_LIMIT = Number(__ENV.FAILED_BODY_LIMIT) || 2000;
const failedResponses = [];

function captureResponse(res, meta = {}) {
  try {
    if (!res) return;
    const status = res.status || 0;
    if (status >= 400) {
      if (failedResponses.length >= FAILED_CAPTURE_CAP) return;
      let body = '';
      try {
        if (typeof res.body === 'string') body = res.body.slice(0, FAILED_BODY_LIMIT);
        else if (res.body) body = JSON.stringify(res.body).slice(0, FAILED_BODY_LIMIT);
      } catch (e) {
        body = '[unreadable body]';
      }
        const entry = {
          ts: Date.now(),
          vu: __VU,
          iter: __ITER,
          url: res.url || meta.url || '',
          method: meta.method || 'GET',
          status,
          body
        };
        failedResponses.push(entry);
        try { console.log('FAILED_RESPONSE:' + JSON.stringify(entry)); } catch (e) {}
    }
  } catch (_) {}
}

function safeRequest(method, url, body = null, params = {}) {
  try {
    let res = null;
    if (method === 'GET') res = http.get(url, params);
    else if (method === 'POST') res = http.post(url, body, params);
    else if (method === 'PATCH') res = http.request('PATCH', url, body, params);
    else res = http.request(method, url, body, params);

    if (!res) {
      // network-level failure
      if (failedResponses.length < FAILED_CAPTURE_CAP) {
          const entry = { ts: Date.now(), vu: __VU, iter: __ITER, url, method, status: 0, body: '[no response]' };
          failedResponses.push(entry);
          try { console.log('FAILED_RESPONSE:' + JSON.stringify(entry)); } catch (e) {}
      }
      return null;
    }

    // capture 4xx/5xx
    captureResponse(res, { url, method });
    return res;
  } catch (e) {
    if (failedResponses.length < FAILED_CAPTURE_CAP) {
        const entry = { ts: Date.now(), vu: __VU, iter: __ITER, url, method, status: 0, body: String(e) };
        failedResponses.push(entry);
        try { console.log('FAILED_RESPONSE:' + JSON.stringify(entry)); } catch (e2) {}
    }
    return null;
  }
}

export function browse() {
  // Load home and products
  const res = safeRequest('GET', `${BASE}/`);
  if (res) check(res, { 'home 200': (r) => r.status === 200 });
  sleep(0.5);

  const prod = safeRequest('GET', `${BASE}/api/products`);
  if (prod) check(prod, { 'products 200': (r) => r.status === 200 });
  sleep(1);
}

export function reserve() {
  // View reservas page then create a reservation (non-destructive payload)
  let r = safeRequest('GET', `${BASE}/reservas`);
  if (r) check(r, { 'reservas page 200': (r) => r.status === 200 });
  sleep(0.5);

  const payload = JSON.stringify({
    name: `TestUser-${Math.floor(Math.random() * 10000)}`,
    phone: '600000000',
    persons: Math.floor(Math.random() * 6) + 1,
    date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
  const headers = { 'Content-Type': 'application/json' };
  if (!READ_ONLY) {
    const post = safeRequest('POST', `${BASE}/api/reservations`, payload, { headers });
    if (post) check(post, { 'reserve 201|200': (r) => r.status === 201 || r.status === 200 });
  } else {
    // Read-only mode: skip creating reservations
    check({ ok: true }, { 'reserve skipped (read-only)': () => true });
  }
  sleep(1);
}

export function checkout() {
  // Simulate placing a minimal order via API
  const productsRes = safeRequest('GET', `${BASE}/api/products`);
  if (!productsRes || productsRes.status !== 200) {
    if (productsRes) check(productsRes, { 'products ok': (r) => r.status === 200 });
    return;
  }
  let prods = [];
  try {
    prods = productsRes.json();
  } catch (e) {
    prods = [];
  }
  const flatProducts = Array.isArray(prods)
    ? prods
    : Object.values(prods).flatMap((category) => Array.isArray(category) ? category : []);
  const item = flatProducts.length ? flatProducts[Math.floor(Math.random() * flatProducts.length)] : null;
  const orderPayload = JSON.stringify({
    table: Math.floor(Math.random() * 20) + 1,
    items: item ? [{ productId: item.id, productName: item.name, productPrice: item.price, quantity: 1 }] : [{ productName: 'sample', quantity: 1 }],
  });
  const headers = { 'Content-Type': 'application/json' };
  if (!READ_ONLY) {
    const res = safeRequest('POST', `${BASE}/api/orders`, orderPayload, { headers });
    if (res) check(res, { 'order created 200|201': (r) => r.status === 200 || r.status === 201 });
  } else {
    // Read-only mode: skip creating orders
    check({ ok: true }, { 'order skipped (read-only)': () => true });
  }
  sleep(1);
}

export function handleSummary(data) {
  // write summary and failed responses to files
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'load-tests/summary.json': JSON.stringify(data, null, 2),
    'load-tests/failed-responses.json': JSON.stringify(failedResponses, null, 2)
  };
}

export function adminFlow() {
  // Access admin page; if an admin login endpoint exists, attempt login using default creds (caution)
  const a = http.get(`${BASE}/admin`);
  check(a, { 'admin page 200': (r) => r.status === 200 });
  sleep(0.5);

  // Optional: attempt login (uncomment and adjust if your API supports it)
  // const credentials = JSON.stringify({ user: 'admin', pass: 'admin' });
  // const login = http.post(`${BASE}/api/admin/login`, credentials, { headers: {'Content-Type':'application/json'}});
  // check(login, { 'admin login ok': (r) => r.status === 200 });
  sleep(1);
}

// NOTE: running reservation/order POSTs will create real data on the target app.
// If you want purely read-only load tests, remove POST requests or point to a staging environment.
