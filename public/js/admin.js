// -- ADMIN PANEL ------------------------------------------------------------

let currentBillTableId = null;
let currentBillTableStatus = null;
let pollInterval = null;
let realtimeSource = null;
let realtimeDebounceTimer = null;
let currentFinalizeTableData = null;
let tablesLoadPromise = null;
let ordersLoadPromise = null;
let realtimeNeedsTables = false;
let realtimeNeedsOrders = false;
let paypalConnectPopup = null;
let paypalConnectPollTimer = null;
let lastTablesSignature = '';
let lastOrdersSignature = '';
let isFinalizingCashCall = false;

function setAdminBusyState(enabled) {
  document.body.classList.toggle('admin-busy', Boolean(enabled));
}

const MOBILE_BREAKPOINT = 700;

const adminLayout = document.querySelector('.admin-layout');
const tablesArea = document.querySelector('.tables-area');
const ordersSidebar = document.querySelector('.orders-sidebar');
const newTableBtn = document.getElementById('newTableBtn');
const mobileViewToggle = document.getElementById('mobileViewToggle');
const headerMenuToggle = document.getElementById('headerMenuToggle');
const headerMenuDropdown = document.getElementById('headerMenuDropdown');
const paypalDisconnectModal = document.getElementById('paypalDisconnectModal');

let paypalDisconnectResolver = null;

function closePayPalDisconnectModal(confirmed) {
  if (paypalDisconnectModal) paypalDisconnectModal.classList.add('hidden');
  if (paypalDisconnectResolver) {
    paypalDisconnectResolver(Boolean(confirmed));
    paypalDisconnectResolver = null;
  }
}

function askPayPalDisconnectConfirmation() {
  if (!paypalDisconnectModal) {
    return Promise.resolve(confirm('La cuenta PayPal ya esta conectada. Quieres desconectarla?'));
  }
  paypalDisconnectModal.classList.remove('hidden');
  return new Promise((resolve) => {
    paypalDisconnectResolver = resolve;
  });
}

document.getElementById('confirmPayPalDisconnectBtn')?.addEventListener('click', () => {
  closePayPalDisconnectModal(true);
});
document.getElementById('cancelPayPalDisconnectBtn')?.addEventListener('click', () => {
  closePayPalDisconnectModal(false);
});
document.getElementById('closePayPalDisconnectModal')?.addEventListener('click', () => {
  closePayPalDisconnectModal(false);
});
paypalDisconnectModal?.addEventListener('click', (e) => {
  if (e.target === paypalDisconnectModal) closePayPalDisconnectModal(false);
});

function isMobileViewport() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function getMobilePanelFromUrl() {
  const panel = (new URLSearchParams(location.search).get('panel') || '').toLowerCase();
  return panel === 'mesas' ? 'mesas' : 'pedidos';
}

function closeHeaderMenu() {
  if (!headerMenuDropdown || !headerMenuToggle) return;
  headerMenuDropdown.classList.remove('open');
  headerMenuToggle.setAttribute('aria-expanded', 'false');
}

function setMobilePanel(panel) {
  if (!isMobileViewport()) {
    adminLayout.classList.remove('mobile-only-mesas', 'mobile-only-pedidos');
    tablesArea.classList.remove('pane-hidden-mobile');
    ordersSidebar.classList.remove('pane-hidden-mobile');
    if (newTableBtn) newTableBtn.classList.remove('pane-hidden-mobile');
    return;
  }

  const activePanel = panel === 'mesas' ? 'mesas' : 'pedidos';
  const showTables = activePanel === 'mesas';

  adminLayout.classList.toggle('mobile-only-mesas', showTables);
  adminLayout.classList.toggle('mobile-only-pedidos', !showTables);
  tablesArea.classList.toggle('pane-hidden-mobile', !showTables);
  ordersSidebar.classList.toggle('pane-hidden-mobile', showTables);
  if (newTableBtn) newTableBtn.classList.toggle('pane-hidden-mobile', !showTables);

  if (mobileViewToggle) {
    mobileViewToggle.textContent = showTables ? 'Pedidos' : 'Mesas';
    mobileViewToggle.setAttribute('aria-label', showTables ? 'Ir a pedidos' : 'Ir a mesas');
  }
}

function updateMobilePanelUrl(panel) {
  const params = new URLSearchParams(location.search);
  params.set('panel', panel);
  location.assign(`${location.pathname}?${params.toString()}`);
}

function initResponsiveHeader() {
  setMobilePanel(getMobilePanelFromUrl());

  if (mobileViewToggle) {
    mobileViewToggle.addEventListener('click', () => {
      const nextPanel = getMobilePanelFromUrl() === 'mesas' ? 'pedidos' : 'mesas';
      updateMobilePanelUrl(nextPanel);
    });
  }

  if (headerMenuToggle && headerMenuDropdown) {
    headerMenuToggle.addEventListener('click', () => {
      const willOpen = !headerMenuDropdown.classList.contains('open');
      closeHeaderMenu();
      if (willOpen) {
        headerMenuDropdown.classList.add('open');
        headerMenuToggle.setAttribute('aria-expanded', 'true');
      }
    });

    document.addEventListener('click', (event) => {
      if (!headerMenuDropdown.classList.contains('open')) return;
      const clickedInsideMenu = headerMenuDropdown.contains(event.target);
      const clickedToggle = headerMenuToggle.contains(event.target);
      if (!clickedInsideMenu && !clickedToggle) closeHeaderMenu();
    });

    headerMenuDropdown.querySelectorAll('a,button').forEach((item) => {
      item.addEventListener('click', () => closeHeaderMenu());
    });
  }

  window.addEventListener('resize', () => {
    if (!isMobileViewport()) closeHeaderMenu();
    setMobilePanel(getMobilePanelFromUrl());
  });
}

// Auth guard
(async function init() {
  initResponsiveHeader();
  const deviceId = getDeviceId();
  if (!deviceId) {
    location.replace('/login.html');
    return;
  }

  const data = await api('POST', '/api/auth/check', { deviceId });
  if (!data.authenticated) {
    location.replace('/login.html');
    return;
  }

  await loadPayPalConnectStatus();
  startPolling();
  startRealtimeUpdates();
})();

// Logout
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await api('POST', '/api/auth/logout', { deviceId: getDeviceId() });
  clearDeviceId();
  location.replace('/login.html');
});

async function loadPayPalConnectStatus() {
  const btn = document.getElementById('connectPaypalBtn');
  if (!btn) return;

  const status = await api('POST', '/api/paypal/connect/status', { deviceId: getDeviceId() });
  if (status.error) {
    btn.disabled = true;
    btn.textContent = 'Conectar con PayPal';
    btn.classList.remove('connected');
    btn.title = status.error;
    return;
  }

  const connected = Boolean(status.connected);
  btn.classList.toggle('connected', connected);
  btn.textContent = connected ? 'PayPal Conectado' : 'Conectar con PayPal';

  if (!status.configured) {
    btn.disabled = true;
    btn.title = 'Falta configurar PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET en el servidor';
    return;
  }

  if (!status.canConnect && !connected) {
    btn.disabled = true;
    btn.title = 'Falta PAYPAL_TOKEN_ENCRYPTION_KEY en el servidor';
    return;
  }

  btn.disabled = false;
  btn.title = connected
    ? `Cuenta conectada${status.merchant?.email ? `: ${status.merchant.email}` : ''}`
    : 'Conecta la cuenta PayPal del bar';
}

function stopPayPalConnectPolling() {
  if (!paypalConnectPollTimer) return;
  clearInterval(paypalConnectPollTimer);
  paypalConnectPollTimer = null;
}

function startPayPalConnectPolling() {
  stopPayPalConnectPolling();
  paypalConnectPollTimer = setInterval(async () => {
    if (!paypalConnectPopup || paypalConnectPopup.closed) {
      stopPayPalConnectPolling();
      paypalConnectPopup = null;
      await loadPayPalConnectStatus();
    }
  }, 700);
}

window.addEventListener('message', async (event) => {
  const payload = event?.data;
  if (!payload || payload.source !== 'paypal-connect') return;

  stopPayPalConnectPolling();
  if (paypalConnectPopup && !paypalConnectPopup.closed) {
    try { paypalConnectPopup.close(); } catch (_) {}
  }
  paypalConnectPopup = null;

  await loadPayPalConnectStatus();
  if (!payload.ok && payload.message) {
    alert(payload.message);
  }
});

document.getElementById('connectPaypalBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('connectPaypalBtn');
  const current = await api('POST', '/api/paypal/connect/status', { deviceId: getDeviceId() });
  if (current.error) {
    alert(current.error);
    return;
  }

  if (current.connected) {
    const ok = await askPayPalDisconnectConfirmation();
    if (!ok) return;

    const result = await api('POST', '/api/paypal/connect/disconnect', { deviceId: getDeviceId() });
    if (result.error) {
      alert(result.error);
      return;
    }
    await loadPayPalConnectStatus();
    return;
  }

  btn.disabled = true;
  const start = await api('POST', '/api/paypal/connect/start', { deviceId: getDeviceId() });
  btn.disabled = false;

  if (start.error || !start.authUrl) {
    alert(start.error || 'No se pudo iniciar la conexion con PayPal');
    await loadPayPalConnectStatus();
    return;
  }

  paypalConnectPopup = window.open(start.authUrl, 'paypal_connect', 'width=520,height=760');
  if (!paypalConnectPopup) {
    alert('El navegador bloqueo la ventana de PayPal. Permite popups para continuar.');
    return;
  }

  startPayPalConnectPolling();
});

// -- DATA FETCHING ----------------------------------------------------------

function startPolling() {
  loadAll();
  pollInterval = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    loadAll();
  }, 20000);
}

function queueRealtimeRefresh(scope = 'all') {
  if (scope === 'all' || scope === 'tables') realtimeNeedsTables = true;
  if (scope === 'all' || scope === 'orders') realtimeNeedsOrders = true;

  if (realtimeDebounceTimer) return;
  realtimeDebounceTimer = setTimeout(async () => {
    realtimeDebounceTimer = null;

    const shouldLoadTables = realtimeNeedsTables;
    const shouldLoadOrders = realtimeNeedsOrders;
    realtimeNeedsTables = false;
    realtimeNeedsOrders = false;

    if (shouldLoadTables && shouldLoadOrders) {
      await loadAll();
      return;
    }
    if (shouldLoadTables) {
      await loadTables();
      return;
    }
    if (shouldLoadOrders) {
      await loadOrders();
    }
  }, 120);
}

function startRealtimeUpdates() {
  if (realtimeSource) return;
  realtimeSource = new EventSource('/api/admin/events');

  realtimeSource.addEventListener('update', (evt) => {
    let data = {};
    try { data = JSON.parse(evt.data || '{}'); } catch (_) {}
    const type = data.type || '';

    if (type === 'order_created' || type === 'order_item_fulfilled' || type === 'order_completed') {
      queueRealtimeRefresh('all');
      return;
    }

    if (type === 'waiter_call_created' || type === 'waiter_call_resolved') {
      queueRealtimeRefresh('orders');
      return;
    }

    if (type === 'bill_item_updated' || type === 'table_paid') {
      queueRealtimeRefresh('tables');
      return;
    }

    queueRealtimeRefresh('all');
  });

  realtimeSource.onerror = () => {
    try { realtimeSource.close(); } catch (_) {}
    realtimeSource = null;
    setTimeout(startRealtimeUpdates, 2000);
  };
}

async function loadAll() {
  await Promise.all([loadTables(), loadOrders()]);
}

async function loadTables() {
  if (tablesLoadPromise) return tablesLoadPromise;
  tablesLoadPromise = (async () => {
    const tables = await api('GET', '/api/tables');
    const signature = JSON.stringify(
      (tables || []).map((t) => [t.id, t.number, t.persons, t.status, Number(t.total || 0)])
    );
    if (signature === lastTablesSignature) return;
    lastTablesSignature = signature;
    renderTables(tables || []);
  })();

  try {
    await tablesLoadPromise;
  } finally {
    tablesLoadPromise = null;
  }
}

async function loadOrders() {
  if (ordersLoadPromise) return ordersLoadPromise;
  ordersLoadPromise = (async () => {
    const [orders, waiterCalls] = await Promise.all([
      api('GET', '/api/orders/pending'),
      api('GET', '/api/waiter-calls/pending')
    ]);

    const safeOrders = Array.isArray(orders) ? orders : [];
    const safeCalls = Array.isArray(waiterCalls) ? waiterCalls : [];

    const signature = JSON.stringify({
      orders: safeOrders.map((o) => [
        o.id,
        o.table_id,
        o.table_number,
        o.created_at,
        (o.items || []).map((item) => [item.id, item.quantity, item.fulfilled])
      ]),
      waiterCalls: safeCalls.map((c) => [c.id, c.table_id, c.table_number, c.source, c.status, c.created_at])
    });

    if (signature === lastOrdersSignature) return;
    lastOrdersSignature = signature;
    renderOrders(safeOrders, safeCalls);
  })();

  try {
    await ordersLoadPromise;
  } finally {
    ordersLoadPromise = null;
  }
}

// -- RENDER -----------------------------------------------------------------

function renderTables(tables) {
  const grid = document.getElementById('tablesGrid');
  const empty = document.getElementById('emptyTables');
  const count = document.getElementById('tablesCount');

  count.textContent = tables.length;

  if (tables.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = tables.map((t) => `
    <div class="table-card ${t.status}" data-id="${t.id}" data-status="${t.status}">
      <div class="table-card-header">
        <span class="table-number">Mesa ${t.number}</span>
        <span class="table-status ${t.status}">${t.status === 'paid' ? 'Pagada' : 'Abierta'}</span>
      </div>
      <div class="table-info">
        <div class="table-info-row"><span>Personas</span><span>${t.persons}</span></div>
        <div class="table-actions-row">
          <button class="btn-show-qr" data-table-id="${t.id}" data-table-number="${t.number}">Mostrar QR</button>
        </div>
      </div>
      <div class="table-total">
        <span class="table-total-label">Total</span>
        <span class="table-total-amount">${fmt(t.total)}</span>
      </div>
    </div>
  `).join('');
}

function renderOrders(orders, waiterCalls = []) {
  const queue = document.getElementById('ordersQueue');
  const empty = document.getElementById('emptyOrders');
  const count = document.getElementById('ordersCount');

  const waiterSourceLabel = (source) => {
    if (source === 'pagar') return 'pagina de pago (efectivo)';
    if (source === 'paypal') return 'pago PayPal';
    if (source === 'pedido') return 'pagina de pedido';
    if (source === 'mesa_no_autorizada') return 'mesa no autorizada';
    if (source === 'mesa_cerrada') return 'mesa cerrada tras pago';
    if (
      source === 'mesa_finalizada' || source === 'mesa_finalizado' || source === 'pedido_finalizada' || source === 'pagar_finalizada'
      || source === 'pedido_finalizado' || source === 'pagar_finalizado'
    ) return 'mesa cerrada tras pago';
    return 'mesa';
  };

  const ordersWithTotal = orders.map((o) => ({
    ...o,
    total: (o.items || []).reduce((s, item) => s + (item.product_price * item.quantity), 0)
  }));

  const queueCount = ordersWithTotal.length + waiterCalls.length;
  count.textContent = queueCount;

  if (queueCount === 0) {
    queue.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const waiterHtml = waiterCalls.map((c) => {
    const isPaymentCall = (c.source === 'pagar' || c.source === 'paypal') && Number(c.table_id) > 0;
    const isClosedTableNotice = (
      c.source === 'mesa_cerrada' || c.source === 'mesa_finalizada' || c.source === 'mesa_finalizado' || c.source === 'pedido_finalizada' || c.source === 'pagar_finalizada'
      || c.source === 'pedido_finalizado' || c.source === 'pagar_finalizado'
    );

    if (isPaymentCall) {
      const paymentTitle = c.source === 'paypal' ? 'Pago PayPal' : 'Pago en efectivo';
      return `
        <div class="order-card waiter-call-card" data-call-id="${c.id}">
          <div class="order-card-header">
            <span class="order-card-title">Mesa ${c.table_number} - ${paymentTitle}</span>
            <span class="order-card-time">${timeSince(c.created_at)}</span>
          </div>
          <div class="waiter-call-body">
            Solicitud desde ${waiterSourceLabel(c.source)}
          </div>
          <div class="order-card-footer">
            <span class="order-total">${fmt(c.table_total || 0)}</span>
            <button class="btn-complete-order btn-finalize-cash" data-call-id="${c.id}" data-table-id="${c.table_id}">Finalizar e imprimir ticket</button>
          </div>
        </div>
      `;
    }

    if (isClosedTableNotice) {
      return `
        <div class="order-card waiter-call-card" data-call-id="${c.id}">
          <div class="order-card-header">
            <span class="order-card-title">Mesa ${c.table_number} - Aviso mesa cerrada</span>
            <span class="order-card-time">${timeSince(c.created_at)}</span>
          </div>
          <div class="waiter-call-body">
            Cliente solicita ayuda desde ${waiterSourceLabel(c.source)}
          </div>
          <div class="order-card-footer">
            <span class="order-total">Aviso</span>
            <button class="btn-complete-order btn-resolve-call" data-call-id="${c.id}">Aviso atendido</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="order-card waiter-call-card" data-call-id="${c.id}">
        <div class="order-card-header">
          <span class="order-card-title">Mesa ${c.table_number} - Llamada camarero</span>
          <span class="order-card-time">${timeSince(c.created_at)}</span>
        </div>
        <div class="waiter-call-body">
          Solicitud desde ${waiterSourceLabel(c.source)}
        </div>
        <div class="order-card-footer">
          <span class="order-total">Prioridad</span>
          <button class="btn-complete-order btn-resolve-call" data-call-id="${c.id}">Llamada atendida</button>
        </div>
      </div>
    `;
  }).join('');

  const ordersHtml = ordersWithTotal.map((o) => `
    <div class="order-card" data-order-id="${o.id}">
      <div class="order-card-header">
        <span class="order-card-title">Mesa ${o.table_number} - Pedido #${o.id}</span>
        <span class="order-card-time">${timeSince(o.created_at)}</span>
      </div>
      <div class="order-items-list">
        ${(o.items || []).map((item) => `
          <div class="order-item-row ${item.fulfilled ? 'fulfilled' : ''}" data-item-id="${item.id}">
            <div class="order-item-check">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="m1.5 5 2.5 2.5 4.5-5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <span class="order-item-name">${item.product_name}</span>
            <span class="order-item-qty">x${item.quantity}</span>
            <span class="order-item-unit">${fmt(item.product_price)}</span>
            <span class="order-item-price">${fmt(item.product_price * item.quantity)}</span>
          </div>
        `).join('')}
      </div>
      <div class="order-card-footer">
        <span class="order-total">${fmt(o.total)}</span>
        <button class="btn-complete-order" data-order-id="${o.id}">Pedido finalizado</button>
      </div>
    </div>
  `).join('');

  queue.innerHTML = waiterHtml + ordersHtml;
}

// -- INTERACTIONS -----------------------------------------------------------

document.getElementById('tablesGrid')?.addEventListener('click', async (e) => {
  const qrBtn = e.target.closest('.btn-show-qr');
  if (qrBtn) {
    e.stopPropagation();
    await openTableQr(qrBtn.dataset.tableId, qrBtn.dataset.tableNumber);
    return;
  }

  const card = e.target.closest('.table-card');
  if (!card) return;
  openBill(card.dataset.id, card.dataset.status);
});

document.getElementById('ordersQueue')?.addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('.btn-complete-order');
  if (actionBtn) {
    e.stopPropagation();

    if (actionBtn.classList.contains('btn-finalize-cash')) {
      if (isFinalizingCashCall) return;
      await finalizeCashPaymentCall(actionBtn.dataset.tableId, actionBtn.dataset.callId, actionBtn);
      return;
    }

    if (actionBtn.classList.contains('btn-resolve-call')) {
      await api('PATCH', `/api/waiter-calls/${actionBtn.dataset.callId}/resolve`);
      loadOrders();
      return;
    }

    await api('PATCH', `/api/orders/${actionBtn.dataset.orderId}/complete`);
    loadOrders();
    return;
  }

  const row = e.target.closest('.order-item-row');
  if (!row || row.classList.contains('fulfilled')) return;
  await api('PATCH', `/api/order-items/${row.dataset.itemId}/fulfill`);
  loadOrders();
});

async function finalizeCashPaymentCall(tableId, callId, actionBtn = null) {
  if (isFinalizingCashCall) return;
  isFinalizingCashCall = true;

  const initialLabel = actionBtn ? actionBtn.textContent : '';
  if (actionBtn) {
    actionBtn.disabled = true;
    actionBtn.textContent = 'Procesando...';
  }

  // Open the print window NOW, synchronously while still in the user-gesture
  // context (click handler). After any await the browser would block window.open().
  const printWin = tableId ? window.open('', '_blank', 'width=380,height=600') : null;

  try {
    if (!tableId) {
      if (callId) await api('PATCH', `/api/waiter-calls/${callId}/resolve`);
      await loadOrders();
      return;
    }

    const bill = await api('GET', `/api/tables/${tableId}/bill`);
    if (bill.error) {
      if (printWin) { try { printWin.close(); } catch (_) {} }
      if (callId) await api('PATCH', `/api/waiter-calls/${callId}/resolve`);
      await loadAll();
      return;
    }

    const result = await api('DELETE', `/api/tables/${tableId}`, null, { timeoutMs: 20000 });
    if (result.error) {
      if (printWin) { try { printWin.close(); } catch (_) {} }
      alert(result.error);
      await loadAll();
      return;
    }

    if (callId) await api('PATCH', `/api/waiter-calls/${callId}/resolve`);
    await loadAll();

    // Write ticket to the pre-opened window (stays open even after awaits).
    renderTicketInWindow(printWin, bill);
  } catch (err) {
    if (printWin) { try { printWin.close(); } catch (_) {} }
    alert('No se pudo finalizar la mesa en este momento.');
    try { await loadAll(); } catch (_) {}
  } finally {
    isFinalizingCashCall = false;
    if (actionBtn) {
      actionBtn.disabled = false;
      actionBtn.textContent = initialLabel || 'Finalizar e imprimir ticket';
    }
  }
}

// -- BILL MODAL -------------------------------------------------------------

async function openBill(tableId, status) {
  currentBillTableId = tableId;
  currentBillTableStatus = status;

  const data = await api('GET', `/api/tables/${tableId}/bill`);
  if (data.error) {
    alert(data.error);
    return;
  }

  if (status === 'paid') {
    document.getElementById('paidTableNumber').textContent = data.table.number;
    renderBillItems(document.getElementById('paidBillItems'), data.items, false);
    document.getElementById('paidBillTotal').textContent = fmt(data.total);
    document.getElementById('paidModal').classList.remove('hidden');
    return;
  }

  document.getElementById('billTableNumber').textContent = data.table.number;
  renderBillItems(document.getElementById('billItems'), data.items, true);
  document.getElementById('billTotal').textContent = fmt(data.total);
  document.getElementById('billModal').classList.remove('hidden');
}

function renderBillItems(container, items, editable) {
  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem">Sin productos aun</p>';
    requestAnimationFrame(refreshBillItemWrapState);
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="bill-item" data-product-id="${item.product_id}">
      <span class="bill-item-name">${item.product_name}</span>
      ${editable ? `
        <div class="bill-item-controls">
          <button class="qty-btn" data-delta="-1">-</button>
          <span class="qty-num">${item.quantity}</span>
          <button class="qty-btn" data-delta="1">+</button>
        </div>
      ` : `<span class="bill-item-qty">x${item.quantity}</span>`}
      <span class="bill-item-unit">${fmt(item.product_price)}</span>
      <span class="bill-item-price">${fmt(item.product_price * item.quantity)}</span>
    </div>
  `).join('');

  if (editable) {
    container.querySelectorAll('.qty-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.bill-item');
        const productId = row.dataset.productId;
        const delta = Number(btn.dataset.delta);
        await api('PATCH', `/api/tables/${currentBillTableId}/items/${productId}`, { delta });
        const data = await api('GET', `/api/tables/${currentBillTableId}/bill`);
        if (data.error) return;
        renderBillItems(container, data.items, true);
        document.getElementById('billTotal').textContent = fmt(data.total);
      });
    });
  }

  requestAnimationFrame(refreshBillItemWrapState);
}

function refreshBillItemWrapState() {
  const PRICE_BREAKPOINT_WIDTH = 295;
  const PRICE_WRAP_SAFETY_GAP = 18;
  const isBreakpointActive = window.innerWidth <= PRICE_BREAKPOINT_WIDTH;

  document.querySelectorAll('.bill-item').forEach((row) => {
    const unit = row.querySelector('.bill-item-unit');
    const price = row.querySelector('.bill-item-price');
    if (!unit || !price) return;

    row.classList.remove('break-prices');

    const unitRect = unit.getBoundingClientRect();
    const priceRect = price.getBoundingClientRect();
    const hasPriceWrapped = Math.round(priceRect.top) > Math.round(unitRect.top) + 1;
    const horizontalGap = Math.round(priceRect.left - unitRect.right);
    const isNearWrap = !hasPriceWrapped && horizontalGap <= PRICE_WRAP_SAFETY_GAP;

    if (hasPriceWrapped || isNearWrap || isBreakpointActive) {
      row.classList.add('break-prices');
    }
  });
}

window.addEventListener('resize', () => requestAnimationFrame(refreshBillItemWrapState));
window.addEventListener('storage', (event) => {
  if (event.key === 'admin:orders-updated-at') queueRealtimeRefresh('all');
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') queueRealtimeRefresh('all');
});

// Modal controls

document.getElementById('closeBillModal')?.addEventListener('click', () => {
  document.getElementById('billModal').classList.add('hidden');
});
document.getElementById('closeBillBtn')?.addEventListener('click', () => {
  document.getElementById('billModal').classList.add('hidden');
});
document.getElementById('closePaidModal')?.addEventListener('click', () => {
  document.getElementById('paidModal').classList.add('hidden');
});
document.getElementById('closePaidBtn')?.addEventListener('click', () => {
  document.getElementById('paidModal').classList.add('hidden');
});

document.getElementById('newOrderBtn')?.addEventListener('click', async () => {
  if (!currentBillTableId) return;
  const data = await api('GET', `/api/tables/${currentBillTableId}/bill`);
  if (data.error) {
    alert(data.error);
    return;
  }
  window.open(`/mesa/${data.table.token}/pedido?from=admin`, '_blank');
});

function openFinalizeTableModal(data) {
  currentFinalizeTableData = data;
  document.getElementById('finalizeTableNumber').textContent = data.table.number;
  document.getElementById('finalizeTableModal').classList.remove('hidden');
}

async function finalizeTable(printTicketFirst) {
  if (!currentFinalizeTableData || !currentBillTableId) return;

  const dataToprint = printTicketFirst ? currentFinalizeTableData : null;

  // Open print window synchronously before any awaits (user-gesture context).
  const printWin = dataToprint ? window.open('', '_blank', 'width=380,height=600') : null;

  const result = await api('DELETE', `/api/tables/${currentBillTableId}`);
  if (result.error) {
    if (printWin) { try { printWin.close(); } catch (_) {} }
    alert(result.error);
    return;
  }

  document.getElementById('billModal').classList.add('hidden');
  document.getElementById('paidModal').classList.add('hidden');
  document.getElementById('finalizeTableModal').classList.add('hidden');
  currentFinalizeTableData = null;
  await loadAll();

  if (printWin) renderTicketInWindow(printWin, dataToprint);
}

document.getElementById('finalizeBillTableBtn')?.addEventListener('click', async () => {
  if (!currentBillTableId) return;
  const data = await api('GET', `/api/tables/${currentBillTableId}/bill`);
  if (!data.error) openFinalizeTableModal(data);
});

document.getElementById('finalizePaidTableBtn')?.addEventListener('click', async () => {
  if (!currentBillTableId) return;
  const data = await api('GET', `/api/tables/${currentBillTableId}/bill`);
  if (!data.error) openFinalizeTableModal(data);
});

document.getElementById('closeFinalizeTableModal')?.addEventListener('click', () => {
  document.getElementById('finalizeTableModal').classList.add('hidden');
});
document.getElementById('cancelFinalizeTableBtn')?.addEventListener('click', () => {
  document.getElementById('finalizeTableModal').classList.add('hidden');
});
document.getElementById('finalizeWithPrintBtn')?.addEventListener('click', () => finalizeTable(true));
document.getElementById('finalizeWithoutPrintBtn')?.addEventListener('click', () => finalizeTable(false));

// -- PRINT ------------------------------------------------------------------

// Writes the ticket HTML into an already-open window.
// Safe to call after async operations because the window is pre-opened
// synchronously inside the user-gesture handler (see callers below).
function renderTicketInWindow(win, data) {
  if (!win || win.closed) return false;

  const rows = (data.items || []).map((i) =>
    `<tr><td>${i.product_name}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">${fmt(i.product_price)}</td><td style="text-align:right">${fmt(i.product_price * i.quantity)}</td></tr>`
  ).join('');

  const now = new Date().toLocaleString('es-ES');

  try {
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Ticket Mesa ${data.table.number}</title>
<style>
  body{font-family:'Courier New',monospace;font-size:12px;color:#000;margin:0;padding:1rem}
  h2{text-align:center;font-size:15px;margin-bottom:4px}
  p{text-align:center;margin:2px 0;font-size:11px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{border-bottom:1px solid #000;padding:3px 2px;font-size:11px}
  td{padding:3px 2px;font-size:11px}
  .total{border-top:2px solid #000;padding-top:6px;margin-top:8px;display:flex;justify-content:space-between;font-weight:bold;font-size:14px}
  .footer{text-align:center;margin-top:12px;font-size:10px;border-top:1px dashed #000;padding-top:8px}
</style></head><body>
<h2>EL RINCON</h2>
<p>Mesa ${data.table.number} - ${data.table.persons} personas</p>
<p>${now}</p>
<table>
  <thead><tr><th align="left">Producto</th><th>Uds</th><th>P.Unit</th><th>Total</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="total"><span>TOTAL</span><span>${fmt(data.total)}</span></div>
<div class="footer">Gracias por su visita<br>IVA incluido</div>
<script>window.onload=function(){window.print();window.close()}<\/script>
</body></html>`);
    win.document.close();
    return true;
  } catch (_) {
    try { win.close(); } catch (_) {}
    return false;
  }
}

function printTicket(data) {
  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) return false;
  return renderTicketInWindow(win, data);
}

// -- NEW TABLE / QR ---------------------------------------------------------

const newTableModal = document.getElementById('newTableModal');
const qrModal = document.getElementById('qrModal');

async function openTableQr(tableId, tableNumber) {
  const qrData = await api('GET', `/api/tables/${tableId}/qr`);
  if (qrData.error) {
    alert(qrData.error);
    return;
  }

  document.getElementById('qrTableNumber').textContent = tableNumber;
  document.getElementById('qrImage').src = qrData.qr;
  document.getElementById('qrUrl').textContent = qrData.url;
  qrModal.classList.remove('hidden');
}

document.getElementById('newTableBtn')?.addEventListener('click', () => {
  document.getElementById('tableNumber').value = '';
  document.getElementById('tablePersons').value = '';
  newTableModal.classList.remove('hidden');
});

document.getElementById('closeNewTableModal')?.addEventListener('click', () => {
  newTableModal.classList.add('hidden');
});
document.getElementById('cancelNewTable')?.addEventListener('click', () => {
  newTableModal.classList.add('hidden');
});

document.getElementById('confirmNewTable')?.addEventListener('click', async () => {
  const number = parseInt(document.getElementById('tableNumber').value, 10);
  const persons = parseInt(document.getElementById('tablePersons').value, 10);

  if (!number || !persons) {
    alert('Completa todos los campos');
    return;
  }

  const result = await api('POST', '/api/tables', { number, persons });
  if (result.error) {
    alert(result.error);
    return;
  }

  newTableModal.classList.add('hidden');
  await loadAll();
  await openTableQr(result.id, result.number);
});

document.getElementById('closeQrModal')?.addEventListener('click', () => {
  qrModal.classList.add('hidden');
});
document.getElementById('closeQrBtn')?.addEventListener('click', () => {
  qrModal.classList.add('hidden');
});
document.getElementById('printQrBtn')?.addEventListener('click', () => {
  const src = document.getElementById('qrImage').src;
  const tableNum = document.getElementById('qrTableNumber').textContent;
  if (!src) return;

  const win = window.open('', '_blank', 'width=420,height=520');
  if (!win) {
    alert('No se pudo abrir la ventana de impresion');
    return;
  }

  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR Mesa ${tableNum}</title>
<style>body{font-family:Arial,sans-serif;padding:1rem;text-align:center}img{width:280px;height:280px}h2{margin-bottom:12px}</style>
</head><body>
<h2>Mesa ${tableNum}</h2>
<img src="${src}" alt="QR mesa ${tableNum}"/>
<script>window.onload=function(){window.print();window.close()}<\/script>
</body></html>`);
  win.document.close();
});

[newTableModal, qrModal, document.getElementById('billModal'), document.getElementById('paidModal'), document.getElementById('finalizeTableModal')]
  .forEach((modal) => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });
