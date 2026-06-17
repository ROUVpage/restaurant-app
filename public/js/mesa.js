// ── MESA (CUSTOMER VIEW) ──────────────────────────────────────────────────

const token = getTableToken();
let mesaEvents = null;
let authorizationRetryInterval = null;
let authorizationEvents = null;
let currentMesaTableId = null;

const viewState = {
  activeToken: token,
  unauthorizedTable: false,
  authorizationCheckInFlight: false
};

function setViewState(patch) {
  Object.assign(viewState, patch);
}

function setFooterWaiterOnlyMode(enabled) {
  const actions = document.querySelector('.footer-actions.keep-row-mobile');
  if (!actions) return;
  actions.classList.toggle('waiter-only-mode', Boolean(enabled));
}

function clearAuthorizationWatcher() {
  if (!authorizationRetryInterval) return;
  clearInterval(authorizationRetryInterval);
  authorizationRetryInterval = null;
}

function clearAuthorizationEvents() {
  if (!authorizationEvents) return;
  try { authorizationEvents.close(); } catch (_) {}
  authorizationEvents = null;
}

async function probeAuthorizationNow() {
  if (!viewState.activeToken || viewState.authorizationCheckInFlight) return;
  setViewState({ authorizationCheckInFlight: true });

  const tableData = await api('GET', `/api/table/by-token/${viewState.activeToken}`);

  setViewState({ authorizationCheckInFlight: false });
  if (tableData.error) return;

  // Only auto-recover when the table is truly reopened and operational.
  if (tableData.status !== 'open') return;

  clearAuthorizationWatcher();
  clearAuthorizationEvents();
  const canonicalToken = tableData.token || viewState.activeToken;
  location.replace(`/mesa/${canonicalToken}`);
}

function startAuthorizationWatcher() {
  if (!viewState.activeToken || authorizationRetryInterval) return;
  authorizationRetryInterval = setInterval(probeAuthorizationNow, 2000);
}

function startAuthorizationRealtimeWatcher() {
  if (authorizationEvents) return;
  authorizationEvents = new EventSource('/api/admin/events');

  authorizationEvents.addEventListener('update', (evt) => {
    let data = {};
    try { data = JSON.parse(evt.data || '{}'); } catch (_) {}
    if (!data.type) return;
    if (data.type === 'table_created' || data.type === 'table_reopened') {
      probeAuthorizationNow();
    }
  });

  authorizationEvents.onerror = () => {
    clearAuthorizationEvents();
    setTimeout(startAuthorizationRealtimeWatcher, 2500);
  };
}

function openTableFinalizedModal() {
  setViewState({ unauthorizedTable: true });
  document.getElementById('personasInfo').textContent = '';
  document.getElementById('payBtn').classList.add('hidden');
  document.getElementById('addOrderBtn').classList.add('hidden');
  setFooterWaiterOnlyMode(true);
  document.getElementById('tableFinalizedModal').classList.remove('hidden');

  // Keep watching after finalization so the page auto-recovers when reopened.
  startAuthorizationWatcher();
  startAuthorizationRealtimeWatcher();
}

function startMesaRealtime() {
  if (!token || mesaEvents) return;
  mesaEvents = new EventSource(`/api/mesa/events/${token}`);

  mesaEvents.addEventListener('update', (evt) => {
    let data = {};
    try { data = JSON.parse(evt.data || '{}'); } catch (_) {}
    if (data.type === 'table_finalized') {
      openTableFinalizedModal();
      try { mesaEvents.close(); } catch (_) {}
      mesaEvents = null;
      return;
    }
    if (data.type === 'bill_updated') {
      if (currentMesaTableId) updatePayTotal(currentMesaTableId);
      return;
    }
    if (data.type === 'table_reopened' || data.type === 'table_created') {
      location.replace(`/mesa/${token}`);
      return;
    }
  });

  mesaEvents.addEventListener('connected', () => {
    if (currentMesaTableId) updatePayTotal(currentMesaTableId);
  });

  mesaEvents.onerror = () => {
    try { mesaEvents.close(); } catch (_) {}
    mesaEvents = null;
    setTimeout(startMesaRealtime, 2500);
  };
}

(async function init() {
  if (!token) { document.body.innerHTML = '<p style="padding:2rem;color:#999">Mesa no encontrada</p>'; return; }

  const tablePromise = api('GET', `/api/table/by-token/${token}`);
  const productsPromise = apiCached('/api/products', { ttlMs: 120000 });

  const tableData = await tablePromise;
  startMesaRealtime();

  if (tableData.error) {
    setViewState({ unauthorizedTable: true });
    document.title = 'Carta — Acceso no autorizado';
    document.getElementById('mesaLabel').textContent = 'Mesa sin autorizar';
    document.getElementById('personasInfo').textContent = '';
    document.getElementById('payBtn').classList.add('hidden');
    const products = await productsPromise;
    renderProducts(products);
    setupNav();
    startAuthorizationWatcher();
    startAuthorizationRealtimeWatcher();
    return;
  }

  clearAuthorizationWatcher();
  clearAuthorizationEvents();
  setViewState({ unauthorizedTable: false, activeToken: tableData.token || token });
  setFooterWaiterOnlyMode(false);

  document.title = `Carta — Mesa ${tableData.number}`;
  document.getElementById('mesaLabel').textContent = `Mesa ${tableData.number}`;
  document.getElementById('personasInfo').textContent = `${tableData.persons} personas`;

  if (tableData.status === 'paid') {
    const products = await productsPromise;
    renderProducts(products);
    setupNav();
    openTableFinalizedModal();
    return;
  }

  await updatePayTotal(tableData.id);
  currentMesaTableId = tableData.id;

  const products = await productsPromise;
  renderProducts(products);
  setupNav();
})();

async function updatePayTotal(tableId) {
  const bill = await api('GET', `/api/tables/${tableId}/bill`);
  const payTotalEl = document.getElementById('payTotal');
  if (payTotalEl && !bill.error) {
    payTotalEl.textContent = fmt(bill.total || 0);
  }
}

function renderProducts(products) {
  for (const [cat, items] of Object.entries(products)) {
    const grid = document.getElementById(`grid-${cat}`);
    if (!grid) continue;
    grid.innerHTML = items.map(p => `
      <div class="product-card">
        <div class="product-name">${p.name}</div>
        <div class="product-price">${fmt(p.price)}</div>
        <div class="product-desc">${p.description}</div>
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

// Footer actions
document.getElementById('callWaiterBtn').addEventListener('click', () => {
  (async () => {
    const result = await api('POST', '/api/waiter-calls', { tableToken: token, source: 'mesa' });
    if (result.error) {
      alert(result.error);
      return;
    }
    showToast('waiterToast');
  })();
});

document.getElementById('addOrderBtn').addEventListener('click', () => {
  if (viewState.unauthorizedTable) {
    document.getElementById('unauthorizedModal').classList.remove('hidden');
    return;
  }
  window.location.href = `/mesa/${viewState.activeToken}/pedido`;
});

document.getElementById('payBtn').addEventListener('click', () => {
  window.location.href = `/mesa/${viewState.activeToken}/pagar`;
});

document.getElementById('unauthorizedCallWaiterBtn').addEventListener('click', async () => {
  document.getElementById('unauthorizedModal').classList.add('hidden');
  const result = await api('POST', '/api/waiter-calls', { tableToken: token, source: 'mesa_no_autorizada' });
  if (result.error) {
    alert(result.error);
    return;
  }
  showToast('waiterToast');
});

document.getElementById('closeUnauthorizedModal').addEventListener('click', () => {
  document.getElementById('unauthorizedModal').classList.add('hidden');
});

document.getElementById('unauthorizedCloseTabBtn').addEventListener('click', () => {
  window.close();
  // Fallback when browser blocks window.close for tabs not opened by script.
  history.back();
});

document.getElementById('unauthorizedModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('unauthorizedModal')) {
    document.getElementById('unauthorizedModal').classList.add('hidden');
  }
});

document.getElementById('finalizedCallWaiterBtn').addEventListener('click', () => {
  (async () => {
    const result = await api('POST', '/api/waiter-calls', { tableToken: token, source: 'mesa_finalizada' });
    if (result.error) {
      alert('No se pudo avisar al camarero desde esta mesa finalizada.');
      return;
    }
    showToast('waiterToast');
  })();
});

document.getElementById('finalizedCloseBtn').addEventListener('click', () => {
  document.getElementById('tableFinalizedModal').classList.add('hidden');
});

document.getElementById('tableFinalizedModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('tableFinalizedModal')) {
    document.getElementById('tableFinalizedModal').classList.add('hidden');
  }
});

window.addEventListener('beforeunload', () => {
  clearAuthorizationWatcher();
  clearAuthorizationEvents();
});
