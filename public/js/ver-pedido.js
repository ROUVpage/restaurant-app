let cartItems = getOnlineOrderCart();
const context = getOnlineOrderContext();
let submitInFlight = false;
let pendingPhone = '';
let homeRedirectTimer = null;
let paypalConfig = null;
let paypalConfigPromise = null;
let paypalSdkLoaded = false;
let paypalButtonsReady = false;
let isPayPalSubmitting = false;

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

function setPayPalSubmitting(submitting) {
  isPayPalSubmitting = Boolean(submitting);

  const closeBtn = document.getElementById('closePaypalPaymentModal');
  const cancelBtn = document.getElementById('cancelPaypalPaymentBtn');
  const buttonsWrap = document.getElementById('paypalButtons');
  const note = document.getElementById('paypalPaymentNote');

  if (closeBtn) closeBtn.disabled = isPayPalSubmitting;
  if (cancelBtn) {
    cancelBtn.disabled = isPayPalSubmitting;
    cancelBtn.textContent = isPayPalSubmitting ? 'Procesando...' : 'Cancelar';
  }

  if (buttonsWrap) {
    buttonsWrap.style.pointerEvents = isPayPalSubmitting ? 'none' : '';
    buttonsWrap.style.opacity = isPayPalSubmitting ? '.65' : '';
  }

  if (note && isPayPalSubmitting) {
    note.textContent = 'Procesando pago...';
  }
}

async function getPayPalConfig() {
  if (paypalConfig) return paypalConfig;
  if (!paypalConfigPromise) {
    paypalConfigPromise = api('GET', '/api/paypal/config').then((config) => {
      paypalConfig = config;
      return config;
    }).catch((error) => {
      paypalConfigPromise = null;
      throw error;
    });
  }
  return paypalConfigPromise;
}

async function loadPayPalSdk(config) {
  if (paypalSdkLoaded && window.paypal) return;
  if (!config?.enabled || !config?.clientId) {
    throw new Error('PayPal no disponible');
  }

  await new Promise((resolve, reject) => {
    if (window.paypal) {
      resolve();
      return;
    }

    const existing = document.querySelector('script[data-paypal-sdk="true"]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar el SDK de PayPal')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=${encodeURIComponent(config.currency || 'EUR')}&intent=capture&components=buttons&enable-funding=card&disable-funding=paylater,venmo,credit`;
    script.async = true;
    script.dataset.paypalSdk = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar el SDK de PayPal'));
    document.head.appendChild(script);
  });

  if (!window.paypal) {
    throw new Error('SDK de PayPal no disponible');
  }

  paypalSdkLoaded = true;
}

function buildOnlinePayPalButtonConfig(fundingSource) {
  const isCardFunding = fundingSource === window.paypal?.FUNDING?.CARD;
  return {
    fundingSource,
    style: {
      layout: 'vertical',
      shape: 'rect',
      label: isCardFunding ? 'pay' : 'paypal'
    },
    createOrder: async () => {
      if (!cartItems.length) {
        throw new Error('Tu pedido esta vacio.');
      }

      const result = await api('POST', '/api/paypal/online-orders/create', { items: cartItems });
      if (result.error || !result.orderId) {
        throw new Error(result.error || 'No se pudo iniciar el pago PayPal');
      }
      return result.orderId;
    },
    onApprove: async (data) => {
      setPayPalSubmitting(true);
      try {
        const capture = await api('POST', `/api/paypal/online-orders/${data.orderID}/capture`, {
          items: cartItems,
          fundingSource: isCardFunding ? 'card' : 'paypal'
        }, { timeoutMs: 25000 });

        if (capture.error) {
          alert(capture.error);
          return;
        }

        const paymentMethod = isCardFunding ? 'card' : 'paypal';
        const submitted = await submitOnlineOrder(paymentMethod, {
          paypalOrderId: data.orderID,
          paypalCaptureId: capture.captureId || null
        });

        if (!submitted) {
          const note = document.getElementById('paypalPaymentNote');
          if (note) {
            note.textContent = 'Pago capturado. Si no se confirma el pedido, contacta con el local.';
          }
        }
      } finally {
        setPayPalSubmitting(false);
      }
    },
    onCancel: () => {
      setPayPalSubmitting(false);
    },
    onError: (err) => {
      setPayPalSubmitting(false);
      alert(err?.message || 'Error en el proceso de pago PayPal');
    }
  };
}

async function initPayPalButtons(config) {
  if (paypalButtonsReady) return;

  await loadPayPalSdk(config);

  const container = document.getElementById('paypalButtons');
  if (!container) throw new Error('No se encontro el contenedor de PayPal');
  container.innerHTML = '';

  const preferredSources = [window.paypal?.FUNDING?.PAYPAL, window.paypal?.FUNDING?.CARD].filter(Boolean);

  const slots = preferredSources.map((source) => {
    const mount = document.createElement('div');
    mount.className = 'paypal-button-slot';
    const instance = window.paypal.Buttons(buildOnlinePayPalButtonConfig(source));
    return { mount, instance };
  }).filter(({ instance }) => instance?.isEligible?.());

  if (slots.length === 0) {
    throw new Error('No hay metodos de pago disponibles en este momento');
  }

  slots.forEach(({ mount }) => container.appendChild(mount));
  await Promise.all(slots.map(({ instance, mount }) => instance.render(mount)));

  const note = document.getElementById('paypalPaymentNote');
  if (note) {
    note.textContent = 'Metodos disponibles: PayPal y tarjeta de debito/credito.';
  }

  paypalButtonsReady = true;
}

async function openPaypalPaymentModal() {
  const totals = getOnlineCartTotals(cartItems);
  const amountEl = document.getElementById('paypalPayAmount');
  if (amountEl) amountEl.textContent = fmt(totals.total || 0);
  const note = document.getElementById('paypalPaymentNote');
  if (note) {
    note.textContent = 'Preparando metodos de pago...';
  }
  setPayPalSubmitting(false);
  openModal('paypalPaymentModal');

  try {
    const config = await getPayPalConfig();
    if (config?.error) {
      throw new Error(config.error);
    }

    if (!config?.enabled) {
      if (!config?.configured) {
        throw new Error('PayPal no esta configurado en el servidor.');
      }
      if (!config?.connected) {
        throw new Error('El bar aun no ha conectado su cuenta PayPal en el panel admin.');
      }
      throw new Error('PayPal no esta disponible temporalmente.');
    }

    await initPayPalButtons(config);
  } catch (error) {
    if (note) {
      note.textContent = error?.message || 'No se pudo iniciar PayPal';
    }
  }
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

async function submitOnlineOrder(paymentMethod, extraPayload = {}) {
  if (submitInFlight) return false;

  if (!cartItems.length) {
    alert('Tu pedido esta vacio.');
    return false;
  }

  submitInFlight = true;
  finalizeOrderBtn.disabled = true;

  const payload = {
    phone: pendingPhone,
    mode: context.mode,
    address: context.address,
    paymentMethod,
    items: cartItems,
    ...extraPayload
  };

  const response = await api('POST', '/api/online-orders', payload, { timeoutMs: 25000 });

  submitInFlight = false;
  finalizeOrderBtn.disabled = false;

  if (response?.error) {
    alert(response.error);
    return false;
  }

  setOnlineOrderContext({ phone: pendingPhone });
  clearOnlineOrderCart();
  cartItems = [];
  renderCart();

  closeModal('phoneModal');
  closeModal('paymentChoiceModal');
  closeModal('paypalPaymentModal');
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

  return true;
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
  btn.addEventListener('click', async () => {
    const method = String(btn.dataset.method || '').trim();
    if (!method) return;
    if (method === 'paypal') {
      closeModal('paymentChoiceModal');
      await openPaypalPaymentModal();
      return;
    }
    await submitOnlineOrder(method);
  });
});

document.getElementById('closePaymentChoiceModal').addEventListener('click', () => closeModal('paymentChoiceModal'));
document.getElementById('cancelPaymentChoiceBtn').addEventListener('click', () => closeModal('paymentChoiceModal'));
document.getElementById('closePaypalPaymentModal').addEventListener('click', () => {
  if (isPayPalSubmitting) return;
  closeModal('paypalPaymentModal');
});
document.getElementById('cancelPaypalPaymentBtn').addEventListener('click', () => {
  if (isPayPalSubmitting) return;
  closeModal('paypalPaymentModal');
  openModal('paymentChoiceModal');
});

document.getElementById('closePickupInfoModal').addEventListener('click', () => closeModal('pickupInfoModal'));
document.getElementById('cancelPickupInfoBtn').addEventListener('click', () => closeModal('pickupInfoModal'));

document.getElementById('confirmPickupInfoBtn').addEventListener('click', () => {
  submitOnlineOrder('pickup_local');
});
