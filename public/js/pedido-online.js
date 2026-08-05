const urlParams = new URLSearchParams(location.search);
const contextFromQuery = {
  mode: normalizeOnlineMode(urlParams.get('mode')),
  address: String(urlParams.get('address') || '').trim()
};

if (contextFromQuery.address) {
  setOnlineOrderContext(contextFromQuery);
} else if (urlParams.get('mode')) {
  setOnlineOrderContext({ mode: contextFromQuery.mode });
}

const context = getOnlineOrderContext();
const modePill = document.getElementById('modePill');
const onlineContextLine = document.getElementById('onlineContextLine');
const cartByProduct = new Map();
const productsById = new Map();

hydrateCart();

(async function initOnlineOrderMenu() {
  renderContext();
  setupNav();

  const products = await apiCached('/api/products', { ttlMs: 120000 });
  if (products?.error) {
    alert(products.error);
    return;
  }

  renderProducts(products);
  wireProductQtyEvents();
  syncAllQuantities();
  updateFooterState();
})();

function hydrateCart() {
  const stored = getOnlineOrderCart();
  stored.forEach((item) => {
    cartByProduct.set(String(item.productId), {
      productId: String(item.productId),
      productName: String(item.productName),
      productPrice: Number(item.productPrice),
      quantity: Number(item.quantity)
    });
  });
}

function persistCart() {
  setOnlineOrderCart(Array.from(cartByProduct.values()));
}

function renderContext() {
  const isPickup = context.mode === 'pickup';
  modePill.textContent = isPickup ? 'Recoger' : 'A domicilio';

  if (isPickup) {
    onlineContextLine.textContent = 'Recogida en local. Tu pedido estara listo en aproximadamente 25 minutos.';
    return;
  }

  onlineContextLine.textContent = context.address
    ? `Entrega en: ${context.address}`
    : 'Entrega a domicilio';
}

function renderProducts(products) {
  for (const categoryItems of Object.values(products)) {
    if (!Array.isArray(categoryItems)) continue;
    categoryItems.forEach((product) => {
      productsById.set(String(product.id), product);
    });
  }

  for (const [cat, items] of Object.entries(products)) {
    const grid = document.getElementById(`grid-${cat}`);
    if (!grid) continue;
    grid.innerHTML = items.map((p) => `
      <div class="product-card" data-product-id="${p.id}">
        <div class="product-name">${p.name}</div>
        <div class="product-price">${fmt(p.price)}</div>
        <div class="product-desc">${p.description}</div>
        <div class="product-qty-row">
          <div class="qty-controls">
            <button class="qty-btn" data-action="minus" data-id="${p.id}">-</button>
            <span class="qty-num" id="qty-${p.id}">0</span>
            <button class="qty-btn" data-action="plus" data-id="${p.id}">+</button>
          </div>
        </div>
      </div>
    `).join('');
  }
}

function setupNav() {
  const area = document.getElementById('productsArea');
  const btns = document.querySelectorAll('.cat-btn');
  const sections = document.querySelectorAll('.products-section');

  area?.classList.add('section-paged');

  const activateSection = (cat) => {
    btns.forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
    sections.forEach((s) => s.classList.toggle('active', s.id === cat));
  };

  btns.forEach((btn) => {
    btn.addEventListener('click', () => activateSection(btn.dataset.cat));
  });

  const initial = document.querySelector('.cat-btn.active')?.dataset.cat || sections[0]?.id;
  if (initial) activateSection(initial);
}

function wireProductQtyEvents() {
  const productsArea = document.getElementById('productsArea');
  if (!productsArea) return;

  productsArea.addEventListener('click', (event) => {
    const btn = event.target.closest('.qty-btn');
    if (!btn) return;

    const id = String(btn.dataset.id || '').trim();
    const action = String(btn.dataset.action || '').trim();
    if (!id || !action) return;

    if (action === 'plus') {
      const product = productsById.get(id);
      if (!product) return;
      changeQuantity(id, 1, product);
      return;
    }

    changeQuantity(id, -1);
  });
}

function changeQuantity(productId, delta, productData) {
  const current = cartByProduct.get(productId);

  if (delta > 0 && !current) {
    if (!productData) return;
    cartByProduct.set(productId, {
      productId,
      productName: String(productData.name),
      productPrice: Number(productData.price),
      quantity: 0
    });
  }

  const next = cartByProduct.get(productId);
  if (!next) return;

  next.quantity += delta;
  if (next.quantity <= 0) {
    cartByProduct.delete(productId);
  }

  syncQuantity(productId);
  updateFooterState();
  persistCart();
}

function syncQuantity(productId) {
  const qty = cartByProduct.get(productId)?.quantity || 0;
  const el = document.getElementById(`qty-${productId}`);
  if (el) el.textContent = String(qty);
}

function syncAllQuantities() {
  productsById.forEach((_value, productId) => {
    syncQuantity(productId);
  });
}

function updateFooterState() {
  const totals = getOnlineCartTotals(Array.from(cartByProduct.values()));
  document.getElementById('cartCount').textContent = String(totals.units);
  document.getElementById('finalizeFromMenuBtn').disabled = totals.units === 0;
}

document.getElementById('backBtn').addEventListener('click', () => {
  location.href = '/inicio';
});

document.getElementById('viewOrderBtn').addEventListener('click', () => {
  location.href = '/ver-pedido';
});

document.getElementById('finalizeFromMenuBtn').addEventListener('click', () => {
  location.href = '/ver-pedido?openFinalize=1';
});
