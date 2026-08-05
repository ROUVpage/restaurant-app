const trackPhoneInput = document.getElementById('trackPhoneInput');
const trackOrderBtn = document.getElementById('trackOrderBtn');
const trackError = document.getElementById('trackError');
const trackingResult = document.getElementById('trackingResult');

const statusLabelMap = {
  received: 'Recibido',
  preparing: 'En cocina',
  ready: 'Listo',
  on_the_way: 'En camino',
  delivered: 'Entregado'
};

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

  document.getElementById('resultCode').textContent = order.orderCode || '-';
  document.getElementById('resultStatus').textContent = statusLabelMap[order.status] || 'Recibido';

  const modeText = order.mode === 'pickup' ? 'Recoger en local' : 'A domicilio';
  const paymentText = order.paymentMethod || '-';
  const whenText = formatDate(order.createdAt);
  document.getElementById('resultMeta').textContent = `${modeText} · ${paymentText} · ${whenText}`;

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

async function runTrackingSearch() {
  const phone = normalizePhone(trackPhoneInput.value);
  if (!isValidSpanishMobile(phone)) {
    setError('Introduce un telefono valido de 9 digitos que empiece por 6 o 7.');
    trackingResult.classList.add('hidden');
    return;
  }

  setError('');

  const data = await api('GET', `/api/online-orders/track?phone=${encodeURIComponent(phone)}`);
  if (data?.error) {
    setError(data.error);
    trackingResult.classList.add('hidden');
    return;
  }

  setOnlineOrderContext({ phone });
  renderTrackingData(data);
}

trackOrderBtn.addEventListener('click', runTrackingSearch);
trackPhoneInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') runTrackingSearch();
});
