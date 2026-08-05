const trackPhoneInput = document.getElementById('trackPhoneInput');
const trackOrderBtn = document.getElementById('trackOrderBtn');
const trackError = document.getElementById('trackError');
const trackingResult = document.getElementById('trackingResult');
let trackingPollTimer = null;
let activeTrackingPhone = '';

(function prefillFromQuery() {
  const phoneFromQuery = String(new URLSearchParams(location.search).get('phone') || '').trim();
  const phoneFromContext = getOnlineOrderContext().phone || '';
  const initial = phoneFromQuery || phoneFromContext;
  if (initial) {
    trackPhoneInput.value = initial;
    runTrackingSearch();
  }
})();

function setError(message) {
  if (!message) {
    trackError.textContent = '';
    trackError.classList.add('hidden');
    return;
  }
  trackError.textContent = message;
  trackError.classList.remove('hidden');
}

function formatDate(tsSeconds) {
  const ts = Number(tsSeconds || 0) * 1000;
  if (!ts) return '-';
  return new Date(ts).toLocaleString('es-ES');
}

function renderTrackingData(payload) {
  const order = payload.order || {};
  const items = Array.isArray(payload.items) ? payload.items : [];

  const codeText = order.orderCode || '-';
  const modeText = order.mode === 'pickup' ? 'Recoger en local' : 'A domicilio';
  const statusText = getTrackingStatusLabel(order.status, order.mode);
  const createdAtText = formatDate(order.createdAt);
  const etaMinutes = order.mode === 'pickup' ? 25 : 40;
  const etaTsMs = Number(order.createdAt || 0) * 1000 + etaMinutes * 60000;
  const etaText = Number.isFinite(etaTsMs) && etaTsMs > 0
    ? new Date(etaTsMs).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : '-';

  document.getElementById('resultCode').textContent = codeText;
  document.getElementById('resultEta').textContent = etaText;
  document.getElementById('resultStatusText').textContent = statusText;
  document.getElementById('resultCodeInline').textContent = codeText;
  document.getElementById('resultMeta').textContent = `${modeText} · ${createdAtText}`;

  const itemsContainer = document.getElementById('resultItems');
  itemsContainer.innerHTML = items.map((item) => {
    const subtotal = Number(item.quantity || 0) * Number(item.productPrice || 0);
    return `
      <div class="result-item">
        <span>${item.productName} x${item.quantity}</span>
        <strong>${fmt(subtotal)}</strong>
      </div>
    `;
  }).join('');

  document.getElementById('resultTotal').textContent = fmt(order.total || 0);
  trackingResult.classList.remove('hidden');
}

function getTrackingStatusLabel(status, mode) {
  const normalizedStatus = String(status || '').toLowerCase();
  const normalizedMode = String(mode || '').toLowerCase();
  const isPickup = normalizedMode === 'pickup';

  if (normalizedStatus === 'delivered') return 'Entregado';

  if (isPickup) {
    if (normalizedStatus === 'ready' || normalizedStatus === 'on_the_way') return 'Listo para recoger';
    return 'En preparacion';
  }

  if (normalizedStatus === 'ready' || normalizedStatus === 'on_the_way') return 'En camino';
  return 'En preparacion';
}

async function runTrackingSearch() {
  const phone = normalizePhone(trackPhoneInput.value);
  if (!isValidSpanishMobile(phone)) {
    setError('Introduce un telefono valido de 9 digitos que empiece por 6 o 7.');
    trackingResult.classList.add('hidden');
    stopTrackingPolling();
    return;
  }

  setError('');
  const ok = await fetchAndRenderTracking(phone, false);
  if (!ok) {
    stopTrackingPolling();
    return;
  }

  activeTrackingPhone = phone;
  startTrackingPolling();
}

async function fetchAndRenderTracking(phone, silentNotFound) {
  const data = await api('GET', `/api/online-orders/track?phone=${encodeURIComponent(phone)}`);
  if (data?.error) {
    const notFound = String(data.error || '').toLowerCase().includes('no hemos encontrado pedidos');
    if (silentNotFound && notFound) {
      trackingResult.classList.add('hidden');
      setError('');
      return false;
    }

    setError(data.error);
    trackingResult.classList.add('hidden');
    return false;
  }

  setOnlineOrderContext({ phone });
  renderTrackingData(data);
  return true;
}

function stopTrackingPolling() {
  if (!trackingPollTimer) return;
  clearInterval(trackingPollTimer);
  trackingPollTimer = null;
}

function startTrackingPolling() {
  stopTrackingPolling();
  trackingPollTimer = setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    if (!activeTrackingPhone) return;
    await fetchAndRenderTracking(activeTrackingPhone, true);
  }, 3500);
}

window.addEventListener('beforeunload', () => {
  stopTrackingPolling();
});

trackOrderBtn.addEventListener('click', runTrackingSearch);
trackPhoneInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') runTrackingSearch();
});
