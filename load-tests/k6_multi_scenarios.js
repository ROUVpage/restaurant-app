import http from 'k6/http';
import { check, sleep } from 'k6';

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

export function browse() {
  // Load home and products
  const res = http.get(`${BASE}/`);
  check(res, { 'home 200': (r) => r.status === 200 });
  sleep(0.5);

  const prod = http.get(`${BASE}/api/products`);
  check(prod, { 'products 200': (r) => r.status === 200 });
  sleep(1);
}

export function reserve() {
  // View reservas page then create a reservation (non-destructive payload)
  let r = http.get(`${BASE}/reservas`);
  check(r, { 'reservas page 200': (r) => r.status === 200 });
  sleep(0.5);

  const payload = JSON.stringify({
    name: `TestUser-${Math.floor(Math.random() * 10000)}`,
    phone: '600000000',
    persons: Math.floor(Math.random() * 6) + 1,
    date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  });
  const headers = { 'Content-Type': 'application/json' };
  if (!READ_ONLY) {
    const post = http.post(`${BASE}/api/reservations`, payload, { headers });
    check(post, { 'reserve 201|200': (r) => r.status === 201 || r.status === 200 });
  } else {
    // Read-only mode: skip creating reservations
    check({ ok: true }, { 'reserve skipped (read-only)': () => true });
  }
  sleep(1);
}

export function checkout() {
  // Simulate placing a minimal order via API
  const productsRes = http.get(`${BASE}/api/products`);
  if (productsRes.status !== 200) {
    check(productsRes, { 'products ok': (r) => r.status === 200 });
    return;
  }
  let prods = [];
  try {
    prods = productsRes.json();
  } catch (e) {
    prods = [];
  }
  const item = prods && prods.length ? prods[0] : null;
  const orderPayload = JSON.stringify({
    table: Math.floor(Math.random() * 20) + 1,
    items: item ? [{ productId: item.id || item._id || item.name, qty: 1 }] : [{ name: 'sample', qty: 1 }],
  });
  const headers = { 'Content-Type': 'application/json' };
  if (!READ_ONLY) {
    const res = http.post(`${BASE}/api/orders`, orderPayload, { headers });
    check(res, { 'order created 200|201': (r) => r.status === 200 || r.status === 201 });
  } else {
    // Read-only mode: skip creating orders
    check({ ok: true }, { 'order skipped (read-only)': () => true });
  }
  sleep(1);
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
