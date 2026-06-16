// ── PEDIDO (ORDER PAGE) ───────────────────────────────────────────────────

const token = getTableToken();
const cart = {}; // productId -> { product, qty }
const productsById = Object.create(null);
let pedidoEvents = null;
const isAdminOrderFlow = new URLSearchParams(location.search).get('from') === 'admin';
let isSubmittingOrder = false;

function createClientRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openTableFinalizedModal() {
  document.getElementById('confirmModal').classList.add('hidden');
  document.getElementById('tableFinalizedModal').classList.remove('hidden');
}

function startPedidoRealtime() {
  if (!token || pedidoEvents) return;
  pedidoEvents = new EventSource(`/api/mesa/events/${token}`);

  pedidoEvents.addEventListener('update', (evt) => {
    let data = {};
    try { data = JSON.parse(evt.data || '{}'); } catch (_) {}
    if (data.type === 'table_finalized') {
      openTableFinalizedModal();
      try { pedidoEvents.close(); } catch (_) {}
      pedidoEvents = null;
    }
  });

  pedidoEvents.onerror = () => {
    try { pedidoEvents.close(); } catch (_) {}
    pedidoEvents = null;
    setTimeout(startPedidoRealtime, 2500);
  };
}

(async function init() {
  if (!token) return;

  if (isAdminOrderFlow) {
    document.body.classList.add('admin-order-flow');
    const reserveBtn = document.querySelector('.reserve-header-btn');
    reserveBtn?.remove();

    const waiterBtn = document.getElementById('callWaiterPedidoBtn');
    waiterBtn?.remove();

    const footerActions = document.querySelector('.footer-actions');
    footerActions?.classList.remove('keep-row-mobile-3');
    footerActions?.classList.add('keep-row-mobile-2');
  }

  const tablePromise = api('GET', `/api/table/by-token/${token}`);
  const productsPromise = apiCached('/api/products', { ttlMs: 120000 });

  const tableData = await tablePromise;

  if (tableData.error) {
    document.body.innerHTML = '<p style="padding:2rem;color:#999">Mesa no encontrada</p>';
    return;
  }

  document.title = `Nuevo Pedido — Mesa ${tableData.number}`;
  document.getElementById('mesaLabel').textContent = `Mesa ${tableData.number}`;

  const products = await productsPromise;
  renderProducts(products);
  setupNav();
  wireProductQtyEvents();
  startPedidoRealtime();
})();

function renderProducts(products) {
  for (const categoryItems of Object.values(products)) {
    if (!Array.isArray(categoryItems)) continue;
    categoryItems.forEach((product) => {
      productsById[String(product.id)] = product;
    });
  }

  for (const [cat, items] of Object.entries(products)) {
    const grid = document.getElementById(`grid-${cat}`);
    if (!grid) continue;
    grid.innerHTML = items.map(p => `
      <div class="product-card" data-product-id="${p.id}">
        <div class="product-name">${p.name}</div>
        <div class="product-price">${fmt(p.price)}</div>
        ${isAdminOrderFlow ? '' : `<div class="product-desc">${p.description}</div>`}
        <div class="product-qty-row">
          <div class="qty-controls">
            <button class="qty-btn" data-action="minus" data-id="${p.id}">−</button>
            <span class="qty-num" id="qty-${p.id}">0</span>
            <button class="qty-btn" data-action="plus" data-id="${p.id}">+</button>
          </div>
        </div>
      </div>
    `).join('');
  }
}

function wireProductQtyEvents() {
  const productsArea = document.getElementById('productsArea');
  if (!productsArea) return;

  productsArea.addEventListener('click', (event) => {
    const btn = event.target.closest('.qty-btn');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (!id || !action) return;

    if (action === 'plus') {
      const product = productsById[id];
      if (!product) return;
      changeCartQuantity(id, 1, product);
      return;
    }

    changeCartQuantity(id, -1);
  });
}

function changeCartQuantity(productId, delta, productData) {
  if (delta > 0 && !cart[productId]) {
    if (!productData) return;
    cart[productId] = { product: productData, qty: 0 };
  }

  if (!cart[productId]) return;

  cart[productId].qty += delta;
  if (cart[productId].qty <= 0) {
    delete cart[productId];
  }

  syncProductQtyDisplay(productId);
  updateCartUI();
}

function syncProductQtyDisplay(productId) {
  const qty = cart[productId]?.qty || 0;
  const el = document.getElementById(`qty-${productId}`);
  if (el) el.textContent = qty;
}

function updateCartUI() {
  const totalUnits = Object.values(cart).reduce((s, e) => s + e.qty, 0);
  const totalPrice = Object.values(cart).reduce((s, e) => s + (e.qty * e.product.price), 0);
  document.getElementById('cartCount').textContent = totalUnits;
  document.getElementById('pedidoTotal').textContent = fmt(totalPrice);
  const btn = document.getElementById('finalizarPedidoBtn');
  btn.disabled = totalUnits === 0;
}

function cancelCurrentOrder() {
  const ids = Object.keys(cart);
  if (ids.length === 0) return;

  ids.forEach(id => {
    delete cart[id];
    syncProductQtyDisplay(id);
  });

  updateCartUI();
  document.getElementById('confirmModal').classList.add('hidden');
}

function clearCartForNextOrder() {
  const ids = Object.keys(cart);
  ids.forEach((id) => {
    delete cart[id];
    syncProductQtyDisplay(id);
  });
  updateCartUI();
}

function resetOrderPageForNewOrder() {
  document.getElementById('confirmModal')?.classList.add('hidden');
  document.getElementById('successModal')?.classList.add('hidden');
  clearCartForNextOrder();

  const firstCategory = document.querySelector('.cat-btn');
  if (firstCategory) {
    firstCategory.click();
  }

  const productsArea = document.getElementById('productsArea');
  productsArea?.scrollTo({ top: 0, behavior: 'auto' });
}

function openConfirmModal() {
  const entries = Object.entries(cart);
  if (entries.length === 0) return;
  renderConfirmItems();
  document.getElementById('confirmModal').classList.remove('hidden');
}

function renderConfirmItems() {
  const container = document.getElementById('confirmItems');
  const entries = Object.entries(cart);
  let total = 0;

  if (entries.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.3rem">No hay productos en el pedido</p>';
    document.getElementById('confirmTotal').textContent = fmt(0);
    document.getElementById('confirmOrderBtn').disabled = true;
    return;
  }

  document.getElementById('confirmOrderBtn').disabled = false;

  container.innerHTML = entries.map(([id, e]) => {
    const subtotal = e.product.price * e.qty;
    total += subtotal;
    return `
      <div class="confirm-item-row" data-product-id="${id}">
        <span class="confirm-item-name">${e.product.name}</span>
        <div class="confirm-item-controls">
          <button class="qty-btn" data-action="minus" data-id="${id}">−</button>
          <span class="qty-num">${e.qty}</span>
          <button class="qty-btn" data-action="plus" data-id="${id}">+</button>
        </div>
        <span class="confirm-item-unit">${fmt(e.product.price)}</span>
        <span class="confirm-item-subtotal">${fmt(subtotal)}</span>
      </div>
    `;
  }).join('');

  document.getElementById('confirmTotal').textContent = fmt(total);

  container.querySelectorAll('.confirm-item-controls .qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const product = cart[id]?.product;
      if (action === 'plus') changeCartQuantity(id, 1, product);
      else changeCartQuantity(id, -1);

      if (Object.keys(cart).length === 0) {
        document.getElementById('confirmModal').classList.add('hidden');
        return;
      }

      renderConfirmItems();
    });
  });
}

function setupNav() {
  if (isAdminOrderFlow) {
    const btns = document.querySelectorAll('.cat-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.cat)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    return;
  }

  const area = document.getElementById('productsArea');
  const btns = document.querySelectorAll('.cat-btn');
  const sections = document.querySelectorAll('.products-section');

  area?.classList.add('section-paged');

  const activateSection = (cat) => {
    btns.forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
    sections.forEach(s => s.classList.toggle('active', s.id === cat));
  };

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      activateSection(btn.dataset.cat);
    });
  });

  const initiallyActive = document.querySelector('.cat-btn.active')?.dataset.cat || sections[0]?.id;
  if (initiallyActive) activateSection(initiallyActive);
}

// Back button
document.getElementById('backBtn').addEventListener('click', () => {
  history.back();
});

// Finalizar pedido → show confirmation
document.getElementById('finalizarPedidoBtn').addEventListener('click', () => {
  openConfirmModal();
});

// Cart icon does the same as "Finalizar Pedido"
document.getElementById('cartBtn').addEventListener('click', () => {
  openConfirmModal();
});

document.getElementById('callWaiterPedidoBtn')?.addEventListener('click', async () => {
  const result = await api('POST', '/api/waiter-calls', { tableToken: token, source: 'pedido' });
  if (result.error) {
    alert(result.error);
    return;
  }
  showToast('waiterToast');
});

document.getElementById('cancelarPedidoBtn').addEventListener('click', () => {
  if (isAdminOrderFlow) {
    resetOrderPageForNewOrder();
    return;
  }

  cancelCurrentOrder();
  location.replace(`/mesa/${token}`);
});

document.getElementById('closeConfirmModal').addEventListener('click', () => {
  document.getElementById('confirmModal').classList.add('hidden');
});
document.getElementById('cancelConfirmBtn').addEventListener('click', () => {
  document.getElementById('confirmModal').classList.add('hidden');
});

document.getElementById('confirmOrderBtn').addEventListener('click', async () => {
  if (isSubmittingOrder) return;

  const items = Object.values(cart).map(e => ({
    productId: e.product.id,
    productName: e.product.name,
    productPrice: e.product.price,
    quantity: e.qty
  }));

  if (items.length === 0) return;

  isSubmittingOrder = true;
  const confirmBtn = document.getElementById('confirmOrderBtn');
  const previousLabelHtml = confirmBtn.innerHTML;
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<span class="label-full">Enviando...</span><span class="label-short">Enviar</span>';

  const clientRequestId = createClientRequestId();

  let result;
  try {
    result = await api('POST', '/api/orders', { tableToken: token, items, clientRequestId });
  } finally {
    isSubmittingOrder = false;
    confirmBtn.innerHTML = previousLabelHtml;
    confirmBtn.disabled = false;
  }

  document.getElementById('confirmModal').classList.add('hidden');

  if (result.success) {
    if (isAdminOrderFlow) {
      try {
        localStorage.setItem('admin:orders-updated-at', String(Date.now()));
      } catch (_) {}

      const cta = document.getElementById('backToMenuBtn');
      if (cta) cta.textContent = 'Nuevo pedido';
      document.getElementById('successModal').classList.remove('hidden');
      return;
    }

    location.replace(`/mesa/${token}`);
  } else {
    alert('Error al enviar el pedido: ' + (result.error || 'desconocido'));
  }
});

document.getElementById('backToMenuBtn').addEventListener('click', () => {
  if (isAdminOrderFlow) {
    resetOrderPageForNewOrder();
    return;
  }
  location.replace(`/mesa/${token}`);
});

// Close on overlay
[document.getElementById('confirmModal')].forEach(m => {
  m?.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
});

document.getElementById('finalizedCallWaiterBtn').addEventListener('click', async () => {
  await api('POST', '/api/waiter-calls', { tableToken: token, source: 'pedido_finalizado' });
  showToast('waiterToast');
  setTimeout(() => location.replace(`/mesa/${token}`), 900);
});

document.getElementById('finalizedCloseBtn').addEventListener('click', () => {
  location.replace(`/mesa/${token}`);
});

document.getElementById('tableFinalizedModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('tableFinalizedModal')) {
    location.replace(`/mesa/${token}`);
  }
});
