let cartItems = getOnlineOrderCart();
const context = getOnlineOrderContext();
let submitInFlight = false;
let pendingPhone = '';
let homeRedirectTimer = null;

const orderItemsEl = document.getElementById('orderItems');
const orderTotalEl = document.getElementById('orderTotal');
const finalizeOrderBtn = document.getElementById('finalizeOrderBtn');
const orderContextLabel = document.getElementById('orderContextLabel');
const orderAddressLine = document.getElementById('orderAddressLine');
const phoneInput = document.getElementById('phoneInput');
const phoneError = document.getElementById('phoneError');

renderContext();
renderCart();

if (new URLSearchParams(location.search).get('openFinalize') === '1' && cartItems.length > 0) {
  openModal('phoneModal');
}

function renderContext() {
  const isPickup = context.mode === 'pickup';
  orderContextLabel.textContent = isPickup ? 'Pedido para recoger' : 'Pedido a domicilio';
  if (isPickup) {
    orderAddressLine.textContent = 'Recogida en 25 minutos en nuestro local';
  } else {
    orderAddressLine.textContent = context.address ? `Entrega en: ${context.address}` : 'Entrega a domicilio';
  }
}

function renderCart() {
  if (!cartItems.length) {
    orderItemsEl.innerHTML = '<p class="modal-lead">Tu pedido esta vacio.</p>';
    orderTotalEl.textContent = fmt(0);
    finalizeOrderBtn.disabled = true;
    return;
  }

  orderItemsEl.innerHTML = cartItems.map((item) => {
    const subtotal = Number(item.quantity) * Number(item.productPrice);
    return `
      <div class="bill-item" data-id="${item.productId}">
        <span class="bill-item-name">${item.productName}</span>
        <div class="bill-item-controls">
          <button class="qty-btn" data-action="minus" data-id="${item.productId}">-</button>
          <span class="qty-num">${item.quantity}</span>
          <button class="qty-btn" data-action="plus" data-id="${item.productId}">+</button>
        </div>
        <span class="bill-item-unit">${fmt(item.productPrice)}</span>
        <span class="bill-item-price">${fmt(subtotal)}</span>
      </div>
    `;
  }).join('');

  const totals = getOnlineCartTotals(cartItems);
  orderTotalEl.textContent = fmt(totals.total);
  finalizeOrderBtn.disabled = totals.units === 0;
}

function updateItemQuantity(productId, delta) {
  const next = [];
  for (const item of cartItems) {
    if (item.productId !== productId) {
      next.push(item);
      continue;
    }

    const quantity = Number(item.quantity) + delta;
    if (quantity > 0) {
      next.push({ ...item, quantity });
    }
  }

  cartItems = next;
  setOnlineOrderCart(cartItems);
  renderCart();
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function validatePhoneInput() {
  const value = normalizePhone(phoneInput.value);
  if (!isValidSpanishMobile(value)) {
    phoneError.textContent = 'Introduce un telefono valido de 9 digitos que empiece por 6 o 7.';
    phoneError.classList.add('show');
    return null;
  }
  phoneError.classList.remove('show');
  return value;
}

async function submitOnlineOrder(paymentMethod) {
  if (submitInFlight) return;

  if (!cartItems.length) {
    alert('Tu pedido esta vacio.');
    return;
  }

  submitInFlight = true;
  finalizeOrderBtn.disabled = true;

  const payload = {
    phone: pendingPhone,
    mode: context.mode,
    address: context.address,
    paymentMethod,
    items: cartItems
  };

  const response = await api('POST', '/api/online-orders', payload, { timeoutMs: 25000 });

  submitInFlight = false;
  finalizeOrderBtn.disabled = false;

  if (response?.error) {
    alert(response.error);
    return;
  }

  setOnlineOrderContext({ phone: pendingPhone });
  clearOnlineOrderCart();
  cartItems = [];
  renderCart();

  closeModal('phoneModal');
  closeModal('paymentChoiceModal');
  closeModal('pickupInfoModal');
  document.getElementById('orderCodeLabel').textContent = response.orderCode || '-';

  const postSubmitMessage = document.getElementById('postSubmitMessage');
  if (postSubmitMessage) {
    if (context.mode === 'pickup') {
      const pickupPoint = context.address || 'nuestro local';
      postSubmitMessage.textContent = `En 25 minutos tu pedido estara listo para recoger en ${pickupPoint}.`;
    } else {
      postSubmitMessage.textContent = 'Hemos recibido tu pedido. Te lo enviaremos lo antes posible.';
    }
  }

  openModal('postSubmitModal');
  if (homeRedirectTimer) clearTimeout(homeRedirectTimer);
  homeRedirectTimer = setTimeout(() => {
    location.replace('/inicio');
  }, 3000);
}

document.getElementById('orderItems').addEventListener('click', (event) => {
  const btn = event.target.closest('.qty-btn');
  if (!btn) return;

  const id = String(btn.dataset.id || '').trim();
  const action = String(btn.dataset.action || '').trim();
  if (!id || !action) return;

  updateItemQuantity(id, action === 'plus' ? 1 : -1);
});

document.getElementById('backBtn').addEventListener('click', () => {
  location.href = '/pedido-online';
});

document.getElementById('continueShoppingBtn').addEventListener('click', () => {
  location.href = '/pedido-online';
});

document.getElementById('finalizeOrderBtn').addEventListener('click', () => {
  if (!cartItems.length) return;
  phoneInput.value = context.phone || '';
  phoneError.classList.remove('show');
  openModal('phoneModal');
});

document.getElementById('closePhoneModal').addEventListener('click', () => closeModal('phoneModal'));
document.getElementById('cancelPhoneBtn').addEventListener('click', () => closeModal('phoneModal'));

document.getElementById('confirmPhoneBtn').addEventListener('click', () => {
  const phone = validatePhoneInput();
  if (!phone) return;

  pendingPhone = phone;
  if (context.mode === 'pickup') {
    document.getElementById('pickupAddressLine').textContent = context.address || 'Calle del local - Recogida en barra';
    closeModal('phoneModal');
    openModal('pickupInfoModal');
    return;
  }

  closeModal('phoneModal');
  openModal('paymentChoiceModal');
});

document.querySelectorAll('.pay-method-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const method = String(btn.dataset.method || '').trim();
    if (!method) return;
    submitOnlineOrder(method);
  });
});

document.getElementById('closePaymentChoiceModal').addEventListener('click', () => closeModal('paymentChoiceModal'));
document.getElementById('cancelPaymentChoiceBtn').addEventListener('click', () => closeModal('paymentChoiceModal'));

document.getElementById('closePickupInfoModal').addEventListener('click', () => closeModal('pickupInfoModal'));
document.getElementById('cancelPickupInfoBtn').addEventListener('click', () => closeModal('pickupInfoModal'));

document.getElementById('confirmPickupInfoBtn').addEventListener('click', () => {
  submitOnlineOrder('pickup_local');
});
