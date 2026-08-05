// Diagnostic POST script for reservations and orders
// Usage: `node load-tests/diag_post.js` (optionally set BASE_URL env var)
const BASE = process.env.BASE_URL || 'https://restaurant-app-6678.onrender.com';

function toIsoDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function post(path, payload) {
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log(`\n=== POST ${path} ===`);
    console.log('Status:', res.status);
    console.log('Headers:', Object.fromEntries(res.headers.entries()));
    console.log('Body:', text);
  } catch (err) {
    console.error(`\n=== POST ${path} ERROR ===`);
    console.error(err && err.stack ? err.stack : String(err));
  }
}

(async () => {
  const now = new Date();
  const reservation = {
    name: `Diag User`,
    phone: '600000000',
    persons: 2,
    date: toIsoDate(new Date(now.getTime() + 24 * 3600 * 1000)), // YYYY-MM-DD
    slot: 'lunch'
  };

  // Create a temporary table to get a valid tableToken for orders
  const tableNumber = Math.floor(Math.random() * 9000) + 100;
  const tablePayload = { number: tableNumber, persons: 2 };
  try {
    const tRes = await fetch(BASE + '/api/tables', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tablePayload)
    });
    const tJson = await tRes.json().catch(() => null);
    console.log('\n=== POST /api/tables ===');
    console.log('Status:', tRes.status);
    console.log('Body:', JSON.stringify(tJson));
    const token = tJson && tJson.token ? tJson.token : null;

    const order = token ? { tableToken: token, items: [{ productId: 'tap1', productName: 'Patatas Bravas', productPrice: 4.5, quantity: 1 }] } : null;

    await post('/api/reservations', reservation);
    if (order) {
      await post('/api/orders', order);
    } else {
      console.log('\nSkipping order POST because no table token was obtained');
    }
  } catch (e) {
    console.error('Error creating table or posting:', e && e.stack ? e.stack : String(e));
  }
})();
