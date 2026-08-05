const fetch = globalThis.fetch;
const BASE = 'http://127.0.0.1:3000';
async function post(body){
  const res = await fetch(BASE + '/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}
(async () => {
  let fails = 0;
  for (let i = 1; i <= 20; i++) {
    const table = i;
    const payload = {
      table,
      items: [{ productId: 'tap1', productName: 'Patatas Bravas', productPrice: 4.5, quantity: 1 }],
    };
    const r = await post(payload);
    console.log('table', table, 'status', r.status, 'body', r.text);
    if (r.status !== 200) fails++;
  }
  console.log('fails', fails);
})();
