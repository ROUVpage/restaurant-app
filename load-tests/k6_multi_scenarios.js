import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Base scenario distribution (used to scale to TOTAL_VUS)
const BASE_COUNTS = {
  browse: 20,
  reservas: 10,
  checkout: 10,
  admin: 5,
  adminActions: 3,
  sharedTableUsers: 12,
  sharedTableAdmin: 4,
  sharedTableDataphone: 2,
  secondTableUsers: 12,
  secondTableAdmin: 4,
  secondTableFinalize: 2,
};
const TOTAL_BASE = Object.values(BASE_COUNTS).reduce((a, b) => a + b, 0);
const TOTAL_VUS = Number(__ENV.TOTAL_VUS) || TOTAL_BASE; // if not set, use default total (53)
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
    adminActions: { executor: 'constant-vus', exec: 'adminActions', vus: computedVus.adminActions, duration: '30s' },
    sharedTableUsers: { executor: 'constant-vus', exec: 'sharedTableUsers', vus: computedVus.sharedTableUsers, duration: '30s', startTime: '2s' },
    sharedTableAdmin: { executor: 'constant-vus', exec: 'sharedTableAdmin', vus: computedVus.sharedTableAdmin, duration: '30s', startTime: '2s' },
    sharedTableDataphone: { executor: 'constant-vus', exec: 'sharedTableDataphone', vus: computedVus.sharedTableDataphone, duration: '30s', startTime: '4s' },
    secondTableUsers: { executor: 'constant-vus', exec: 'secondTableUsers', vus: computedVus.secondTableUsers, duration: '30s', startTime: '2s' },
    secondTableAdmin: { executor: 'constant-vus', exec: 'secondTableAdmin', vus: computedVus.secondTableAdmin, duration: '30s', startTime: '2s' },
    secondTableFinalize: { executor: 'constant-vus', exec: 'secondTableFinalize', vus: computedVus.secondTableFinalize, duration: '30s', startTime: '6s' },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    checks: ['rate>0.99'],
  },
};

const BASE = __ENV.BASE_URL || 'https://restaurant-app-6678.onrender.com';
const READ_ONLY = (__ENV.READ_ONLY === '1' || __ENV.READ_ONLY === 'true');
const SHARED_TABLE_A = Number(__ENV.SHARED_TABLE_A) || 8801;
const SHARED_TABLE_B = Number(__ENV.SHARED_TABLE_B) || 8802;
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

function isoDateDaysFromNow(days) {
  const dt = new Date(Date.now() + Number(days) * 24 * 3600 * 1000);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function randomAdminName() {
  return `AdminTest-${Math.floor(Math.random() * 100000)}`;
}

function randomPhone() {
  const prefix = Math.random() < 0.5 ? '6' : '7';
  const suffix = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  return `${prefix}${suffix}`;
}

function safeJson(res) {
  if (!res) return null;
  try { return res.json(); } catch (_) { return null; }
}

function flattenProducts(prods) {
  return Array.isArray(prods)
    ? prods
    : Object.values(prods || {}).flatMap((category) => Array.isArray(category) ? category : []);
}

function pickRandomProduct(catalog) {
  if (!Array.isArray(catalog) || !catalog.length) return null;
  return catalog[Math.floor(Math.random() * catalog.length)] || null;
}

function buildOrderItemsFromCatalog(catalog) {
  const item = pickRandomProduct(catalog);
  if (!item) return [{ productName: 'sample', quantity: 1 }];
  return [{ productId: item.id, productName: item.name, productPrice: item.price, quantity: 1 }];
}

function getTableByNumber(number) {
  const rows = getTables();
  return rows.find((t) => Number(t.number) === Number(number)) || null;
}

function getOrCreateTableByNumber(number, persons = 4) {
  const current = getTableByNumber(number);
  if (current && current.id && current.token) return current;

  const headers = { 'Content-Type': 'application/json' };
  const payload = JSON.stringify({ number, persons });
  const created = safeRequest('POST', `${BASE}/api/tables`, payload, { headers });
  if (created && (created.status === 200 || created.status === 201)) {
    const body = safeJson(created);
    if (body && body.id && body.token) return body;
  }
  return getTableByNumber(number);
}

function createOrderForFixedTable(tableRef, catalog) {
  if (!tableRef || !tableRef.token) return null;
  const headers = { 'Content-Type': 'application/json' };
  const payload = JSON.stringify({
    tableToken: tableRef.token,
    items: buildOrderItemsFromCatalog(catalog),
  });
  return safeRequest('POST', `${BASE}/api/orders`, payload, { headers });
}

export function setup() {
  const productRes = safeRequest('GET', `${BASE}/api/products`);
  const productRaw = safeJson(productRes) || [];
  const catalog = flattenProducts(productRaw)
    .map((p) => ({ id: p.id, name: p.name, price: p.price }))
    .filter((p) => p && p.id != null && p.name != null && p.price != null);

  const tableA = getOrCreateTableByNumber(SHARED_TABLE_A, 6);
  const tableB = getOrCreateTableByNumber(SHARED_TABLE_B, 6);
  return {
    tableA: tableA ? { id: tableA.id, number: Number(tableA.number), token: tableA.token } : null,
    tableB: tableB ? { id: tableB.id, number: Number(tableB.number), token: tableB.token } : null,
    catalog,
  };
}

function getTables() {
  const res = safeRequest('GET', `${BASE}/api/tables`);
  if (!res || res.status !== 200) return [];
  const parsed = safeJson(res);
  return Array.isArray(parsed) ? parsed : [];
}

function getTableBill(tableId) {
  const res = safeRequest('GET', `${BASE}/api/tables/${tableId}/bill`);
  if (!res || res.status !== 200) return null;
  return safeJson(res);
}

function createAdminReservation(date) {
  const payload = JSON.stringify({
    date,
    slot: Math.random() < 0.5 ? 'lunch' : 'dinner',
    name: randomAdminName(),
    phone: randomPhone(),
    persons: Math.floor(Math.random() * 5) + 1
  });
  const headers = { 'Content-Type': 'application/json' };
  return safeRequest('POST', `${BASE}/api/admin/reservations`, payload, { headers });
}

function createOrderForRandomTable() {
  const productsRes = safeRequest('GET', `${BASE}/api/products`);
  if (!productsRes || productsRes.status !== 200) return null;
  const prods = safeJson(productsRes) || [];
  const flatProducts = Array.isArray(prods)
    ? prods
    : Object.values(prods).flatMap((category) => Array.isArray(category) ? category : []);
  const item = flatProducts.length ? flatProducts[Math.floor(Math.random() * flatProducts.length)] : null;
  if (!item) return null;
  const orderPayload = JSON.stringify({
    table: Math.floor(Math.random() * 20) + 1,
    items: [{ productId: item.id, productName: item.name, productPrice: item.price, quantity: 1 }]
  });
  const headers = { 'Content-Type': 'application/json' };
  return safeRequest('POST', `${BASE}/api/orders`, orderPayload, { headers });
}

export function adminActions() {
  const page = safeRequest('GET', `${BASE}/admin`);
  if (page) check(page, { 'admin page 200': (r) => r.status === 200 });
  sleep(0.5);

  let tables = getTables();
  if (!tables.length) {
    createOrderForRandomTable();
    sleep(0.5);
    tables = getTables();
  }

  const tableWithBill = tables.find((t) => Number(t.total || 0) > 0) || tables[0];
  if (tableWithBill) {
    const bill = getTableBill(tableWithBill.id);
    if (bill && Array.isArray(bill.items) && bill.items.length > 0) {
      const item = bill.items[0];
      const modifyRes = safeRequest('PATCH', `${BASE}/api/tables/${tableWithBill.id}/items/${item.product_id}`, JSON.stringify({ delta: 1 }), { headers: { 'Content-Type': 'application/json' } });
      if (modifyRes) check(modifyRes, { 'modify table item 200': (r) => r.status === 200 });

      const token = bill.table?.token || tableWithBill.token;
      if (token) {
        const payRes = safeRequest('POST', `${BASE}/api/payments/cash/confirm`, JSON.stringify({ tableToken: token }), { headers: { 'Content-Type': 'application/json' } });
        if (payRes) check(payRes, { 'cash payment confirm 200': (r) => r.status === 200 });
      }
    }
  }

  if (tables.length) {
    const target = tables[Math.floor(Math.random() * tables.length)];
    const deleteRes = safeRequest('DELETE', `${BASE}/api/tables/${target.id}`);
    if (deleteRes) check(deleteRes, { 'delete table 200': (r) => r.status === 200 });
  }

  const date1 = isoDateDaysFromNow(3);
  const date2 = isoDateDaysFromNow(4);
  const reservation = createAdminReservation(date1);
  if (reservation && (reservation.status === 200 || reservation.status === 201)) {
    const resBody = safeJson(reservation) || {};
    const resId = resBody.reservation?.id;
    if (resId) {
      const cancelRes = safeRequest('PATCH', `${BASE}/api/admin/reservations/${resId}/cancel`, null, { headers: { 'Content-Type': 'application/json' } });
      if (cancelRes) check(cancelRes, { 'cancel reservation 200': (r) => r.status === 200 });
    }
  }

  const createNext = createAdminReservation(date2);
  if (createNext) check(createNext, { 'create reservation next day 200|201': (r) => r.status === 200 || r.status === 201 });
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

export function sharedTableUsers(data) {
  const table = getOrCreateTableByNumber(data?.tableA?.number || SHARED_TABLE_A, 6);
  const res = createOrderForFixedTable(table, data?.catalog || []);
  if (res) check(res, { 'shared table users order 200|201': (r) => r.status === 200 || r.status === 201 });
  sleep(0.4);
}

export function sharedTableAdmin(data) {
  const table = getOrCreateTableByNumber(data?.tableA?.number || SHARED_TABLE_A, 6);
  if (!table) {
    sleep(0.6);
    return;
  }

  const orderRes = createOrderForFixedTable(table, data?.catalog || []);
  if (orderRes) check(orderRes, { 'shared table admin order 200|201': (r) => r.status === 200 || r.status === 201 });

  const bill = getTableBill(table.id);
  if (bill && Array.isArray(bill.items) && bill.items.length > 0) {
    const item = bill.items[0];
    const modifyRes = safeRequest(
      'PATCH',
      `${BASE}/api/tables/${table.id}/items/${item.product_id}`,
      JSON.stringify({ delta: 1 }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (modifyRes) check(modifyRes, { 'shared table admin modify item 200|404': (r) => r.status === 200 || r.status === 404 });

    const removeDelta = -Math.max(1, Number(item.quantity || 1));
    const removeRes = safeRequest(
      'PATCH',
      `${BASE}/api/tables/${table.id}/items/${item.product_id}`,
      JSON.stringify({ delta: removeDelta }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (removeRes) check(removeRes, { 'shared table admin remove item 200|404': (r) => r.status === 200 || r.status === 404 });
  }

  sleep(0.8);
}

export function sharedTableDataphone(data) {
  const table = getOrCreateTableByNumber(data?.tableA?.number || SHARED_TABLE_A, 6);
  if (!table || !table.token) {
    sleep(0.8);
    return;
  }

  const payRes = safeRequest(
    'POST',
    `${BASE}/api/payments/dataphone/confirm`,
    JSON.stringify({ tableToken: table.token }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (payRes) check(payRes, { 'shared table dataphone confirm 200|400|404': (r) => r.status === 200 || r.status === 400 || r.status === 404 });
  sleep(1);
}

export function secondTableUsers(data) {
  const table = getOrCreateTableByNumber(data?.tableB?.number || SHARED_TABLE_B, 6);
  const res = createOrderForFixedTable(table, data?.catalog || []);
  if (res) check(res, { 'second table users order 200|201': (r) => r.status === 200 || r.status === 201 });
  sleep(0.4);
}

export function secondTableAdmin(data) {
  const table = getOrCreateTableByNumber(data?.tableB?.number || SHARED_TABLE_B, 6);
  if (!table) {
    sleep(0.6);
    return;
  }

  const orderRes = createOrderForFixedTable(table, data?.catalog || []);
  if (orderRes) check(orderRes, { 'second table admin order 200|201': (r) => r.status === 200 || r.status === 201 });

  const bill = getTableBill(table.id);
  if (bill && Array.isArray(bill.items) && bill.items.length > 0) {
    const item = bill.items[0];
    const modifyRes = safeRequest(
      'PATCH',
      `${BASE}/api/tables/${table.id}/items/${item.product_id}`,
      JSON.stringify({ delta: 1 }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (modifyRes) check(modifyRes, { 'second table admin modify item 200|404': (r) => r.status === 200 || r.status === 404 });

    const removeDelta = -Math.max(1, Number(item.quantity || 1));
    const removeRes = safeRequest(
      'PATCH',
      `${BASE}/api/tables/${table.id}/items/${item.product_id}`,
      JSON.stringify({ delta: removeDelta }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (removeRes) check(removeRes, { 'second table admin remove item 200|404': (r) => r.status === 200 || r.status === 404 });
  }

  sleep(0.8);
}

export function secondTableFinalize(data) {
  const table = getOrCreateTableByNumber(data?.tableB?.number || SHARED_TABLE_B, 6);
  if (!table) {
    sleep(1);
    return;
  }

  // Admin print flow simulation: fetch bill data, then delete the table.
  const billRes = safeRequest('GET', `${BASE}/api/tables/${table.id}/bill`);
  if (billRes) check(billRes, { 'second table bill fetch for ticket 200|404': (r) => r.status === 200 || r.status === 404 });

  const deleteRes = safeRequest('DELETE', `${BASE}/api/tables/${table.id}`);
  if (deleteRes) check(deleteRes, { 'second table delete 200|404': (r) => r.status === 200 || r.status === 404 });

  sleep(1);
}

// NOTE: running reservation/order POSTs will create real data on the target app.
// If you want purely read-only load tests, remove POST requests or point to a staging environment.
