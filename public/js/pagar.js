// ── PAGAR (PAYMENT PAGE) ──────────────────────────────────────────────────

const token = getTableToken();
let billTotal = 0;
let pagarEvents = null;
let currentTableId = null;
let paypalConfig = null;
let paypalConfigPromise = null;
let paypalSdkLoaded = false;
let paypalButtonsReady = false;
let isCashConfirmSubmitting = false;
let isPayPalSubmitting = false; /*PP*/

function setCashConfirmSubmitting(submitting) {
  isCashConfirmSubmitting = Boolean(submitting);
  const modal = document.getElementById('cashConfirmModal');
  if (isCashConfirmSubmitting && modal) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-busy', 'true');
  }
  if (!isCashConfirmSubmitting && modal) {
    modal.removeAttribute('aria-busy');
  }

  const closeBtn = document.getElementById('closeCashConfirmModal');
  const cancelBtn = document.getElementById('cancelCashConfirmBtn');
  const acceptBtn = document.getElementById('acceptCashConfirmBtn');
  const noteEl = document.querySelector('#cashConfirmModal .paypal-note');

  if (closeBtn) closeBtn.disabled = isCashConfirmSubmitting;
  if (cancelBtn) cancelBtn.disabled = isCashConfirmSubmitting;
  if (acceptBtn) {
    acceptBtn.disabled = isCashConfirmSubmitting;
    acceptBtn.textContent = isCashConfirmSubmitting ? 'Confirmando pago...' : 'Confirmar pago';
  }

  if (noteEl) {
    noteEl.textContent = isCashConfirmSubmitting
      ? 'El camarero está en camino.'
      : '¿Deseas confirmar este pago en efectivo y cerrar la sesión de la mesa?';
  }
}

function setPayPalSubmitting(submitting) {
  isPayPalSubmitting = Boolean(submitting);

  const modal = document.getElementById('paypalModal');
  const closeBtn = document.getElementById('closePaypalModal');
  const cancelBtn = document.getElementById('cancelPaypalBtn');
  const buttonsWrap = document.getElementById('paypalButtons');
  const note = document.getElementById('paypalNote');

  if (isPayPalSubmitting && modal) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-busy', 'true');
  }
  if (!isPayPalSubmitting && modal) {
    modal.removeAttribute('aria-busy');
  }

  if (closeBtn) closeBtn.disabled = isPayPalSubmitting;
  if (cancelBtn) {
    cancelBtn.disabled = isPayPalSubmitting;
    cancelBtn.textContent = isPayPalSubmitting ? 'Procesando...' : 'Cancelar';
  }

  if (buttonsWrap) {
    buttonsWrap.style.pointerEvents = isPayPalSubmitting ? 'none' : '';
    buttonsWrap.style.opacity = isPayPalSubmitting ? '.65' : '';
  }

  if (note) {
    if (isPayPalSubmitting) {
      note.textContent = 'El camarero está en camino.';
    } else if (!note.textContent.trim() || note.textContent.includes('en camino')) {
      note.textContent = 'Pago seguro gestionado por PayPal.';
    }
  }
}

function openCashConfirmModal() {
  document.getElementById('cashConfirmAmount').textContent = fmt(billTotal);
  setCashConfirmSubmitting(false);
  document.getElementById('cashConfirmModal').classList.remove('hidden');
}

function closeCashConfirmModal() {
  if (isCashConfirmSubmitting) return;
  document.getElementById('cashConfirmModal').classList.add('hidden');
}

function redirectToClosedTable() {
  // Keep modal visible while waiting; only transition away on navigation.
  location.replace(`/mesa/${token}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function completeCashPaymentFlow() { /*FOUND-FLOW*/
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS_MS = [450, 900];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await api('POST', '/api/payments/cash/confirm', { tableToken: token }, { timeoutMs: 25000 });
    if (!result.error) {
      return { ok: true };
    }

    const isConnectivityError = result.error === 'No se pudo conectar con el servidor';
    if (!isConnectivityError || attempt === MAX_ATTEMPTS) {
      return { ok: false, error: result.error };
    }

    const noteEl = document.querySelector('#cashConfirmModal .paypal-note');
    if (noteEl) {
      noteEl.textContent = 'Conexión inestable. Reintentando...';
    }

    await wait(RETRY_DELAYS_MS[attempt - 1] || 1200);
  }

  return { ok: false, error: 'No se pudo confirmar el pago en efectivo' };
}

function buildPayPalButtonConfig(fundingSource) {
  return {
    fundingSource,
    style: {
      layout: 'vertical',
      shape: 'rect',
      label: fundingSource === window.paypal?.FUNDING?.CARD ? 'pay' : 'paypal'
    },
    createOrder: async () => {
      const result = await api('POST', '/api/paypal/orders/create', { tableToken: token });
      if (result.error || !result.orderId) {
        throw new Error(result.error || 'No se pudo iniciar el pago PayPal');
      }
      return result.orderId;
    },
    onApprove: async (data) => {
      const result = await api('POST', `/api/paypal/orders/${data.orderID}/capture`, { tableToken: token });
      if (result.error) {
        alert(result.error);
        return;
      }

      setPayPalSubmitting(true);
      showToast('waiterToast');
      setTimeout(() => {
        location.replace(`/mesa/${token}`);
      }, 900);
    },
    onCancel: () => {
      setPayPalSubmitting(false);
    },
    onError: (err) => {
      setPayPalSubmitting(false);
      const message = err?.message || 'Error en el proceso de pago PayPal';
      alert(message);
    }
  };
}

function openTableFinalizedModal() {
  document.getElementById('paypalModal').classList.add('hidden');
  document.getElementById('tableFinalizedModal').classList.remove('hidden');
}

document.getElementById('callWaiterPagar').addEventListener('click', () => {
  openCashConfirmModal();
});

function startPagarRealtime() {
  if (!token || pagarEvents) return;
  pagarEvents = new EventSource(`/api/mesa/events/${token}`);

  pagarEvents.addEventListener('update', (evt) => {
    let data = {};
    try { data = JSON.parse(evt.data || '{}'); } catch (_) {}
    if (data.type === 'table_finalized') {
      // If a payment confirmation is already in progress the click handler
      // will redirect after the API responds — don't open a competing modal.
      if (!isCashConfirmSubmitting && !isPayPalSubmitting) {
        openTableFinalizedModal();
      }
      try { pagarEvents.close(); } catch (_) {}
      pagarEvents = null;
      return;
    }
    if (data.type === 'bill_updated' && currentTableId && !isCashConfirmSubmitting && !isPayPalSubmitting) {
      if (data.bill) {
        // Data embedded in event — apply immediately without a round-trip.
        billTotal = data.bill.total;
        renderBill(data.bill);
      } else {
        api('GET', `/api/tables/${currentTableId}/bill`).then((bill) => {
          if (!bill.error) { billTotal = bill.total; renderBill(bill); }
        });
      }
    }
  });

  pagarEvents.addEventListener('connected', () => {
    if (currentTableId && !isCashConfirmSubmitting && !isPayPalSubmitting) {
      api('GET', `/api/tables/${currentTableId}/bill`).then((bill) => {
        if (!bill.error) { billTotal = bill.total; renderBill(bill); }
      });
    }
  });

  pagarEvents.onerror = () => {
    try { pagarEvents.close(); } catch (_) {}
    pagarEvents = null;
    setTimeout(startPagarRealtime, 2500);
  };
}

async function callWaiterFromPayPage() {
  const result = await api('POST', '/api/waiter-calls', { tableToken: token, source: 'pagar' });
  if (result.error) {
    alert(result.error);
    return;
  }
  showToast('waiterToast');
}

async function loadPayPalSdk(config) {
  if (paypalSdkLoaded && window.paypal) return;
  if (!config?.enabled || !config?.clientId) {
    throw new Error('PayPal no disponible');
  }

  await new Promise((resolve, reject) => {
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

async function initPayPalButtons() {
  if (paypalButtonsReady) return;
  if (!paypalConfig?.enabled) {
    throw new Error('PayPal no está configurado');
  }

  await loadPayPalSdk(paypalConfig);

  const container = document.getElementById('paypalButtons');
  container.innerHTML = '';

  const preferredSources = [
    window.paypal?.FUNDING?.PAYPAL,
    window.paypal?.FUNDING?.CARD
  ].filter(Boolean);

  const renderedSources = [];
  for (const source of preferredSources) {
    const mount = document.createElement('div');
    mount.className = 'paypal-button-slot';
    container.appendChild(mount);

    const instance = window.paypal.Buttons(buildPayPalButtonConfig(source));
    if (!instance || !instance.isEligible || !instance.isEligible()) {
      mount.remove();
      continue;
    }

    // Render each eligible funding source in its own slot.
    await instance.render(mount);
    renderedSources.push(source);
  }

  if (renderedSources.length === 0) {
    throw new Error('No hay metodos de pago disponibles en este momento');
  }

  const note = document.getElementById('paypalNote');
  note.textContent = 'Metodos disponibles: PayPal y tarjeta de debito/credito.';

  paypalButtonsReady = true;
}

(async function init() {
  if (!token) return;

  const tableData = await api('GET', `/api/table/by-token/${token}`);

  if (tableData.error) {
    document.body.innerHTML = '<p style="padding:2rem;color:#999">Mesa no encontrada</p>';
    return;
  }

  document.title = `Cuenta — Mesa ${tableData.number}`;
  document.getElementById('mesaLabel').textContent = `Mesa ${tableData.number}`;
  document.getElementById('personasInfo').textContent = `${tableData.persons} personas`;
  currentTableId = tableData.id;

  paypalConfigPromise = apiCached('/api/paypal/config', { ttlMs: 20000, timeoutMs: 9000 })
    .then((config) => {
      paypalConfig = config;
      // Pre-load SDK immediately so buttons appear instantly when modal opens
      if (config?.enabled && config?.clientId) {
        loadPayPalSdk(config).catch(() => {});
      }
      return config;
    });

  const bill = await api('GET', `/api/tables/${tableData.id}/bill`);

  billTotal = bill.total;
  renderBill(bill);
  startPagarRealtime();

  // Poll every 3s: update bill AND detect if table was finalized from the bar
  setInterval(() => {
    if (!currentTableId || isCashConfirmSubmitting || isPayPalSubmitting) return;
    if (document.visibilityState !== 'visible') return;
    api('GET', `/api/tables/${currentTableId}/bill`).then((b) => {
      if (b.error) {
        // Table was deleted (finalized by bar)
        if (!isCashConfirmSubmitting && !isPayPalSubmitting) location.replace(`/mesa/${token}`);
        return;
      }
      billTotal = b.total;
      renderBill(b);
      if (b.table && b.table.status !== 'open') {
        location.replace(`/mesa/${token}`);
      }
    });
  }, 3000);

  // If already paid, show confirmation and hide pay button
  if (tableData.status === 'paid') {
    document.getElementById('paidConfirm').classList.remove('hidden');
    document.getElementById('payFooter').classList.add('hidden');
  }
})();

function renderBill(data) {
  const container = document.getElementById('billItems');
  if (!data.items || data.items.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem;padding:.5rem">Sin productos</p>';
    document.getElementById('billTotal').textContent = fmt(0);
    return;
  }
  container.innerHTML = data.items.map(i => `
    <div class="bill-item">
      <span class="bill-item-name">${i.product_name}</span>
      <span class="bill-item-qty">×${i.quantity}</span>
      <span class="bill-item-unit">${fmt(i.product_price)}</span>
      <span class="bill-item-price">${fmt(i.product_price * i.quantity)}</span>
    </div>
  `).join('');
  document.getElementById('billTotal').textContent = fmt(data.total);
  document.getElementById('precioTotal').textContent = fmt(data.total);
  // Keep cash confirm modal and PayPal modal amounts in sync
  const cashAmountEl = document.getElementById('cashConfirmAmount');
  if (cashAmountEl) cashAmountEl.textContent = fmt(data.total);
  const paypalAmountEl = document.getElementById('paypalAmount');
  if (paypalAmountEl) paypalAmountEl.textContent = fmt(data.total);
}

// Back
document.getElementById('backBtn').addEventListener('click', () => history.back());
document.getElementById('payBackBtn').addEventListener('click', () => history.back());

// Confirm pay → show PayPal modal
document.getElementById('confirmarPagoBtn').addEventListener('click', async () => {
  document.getElementById('paypalAmount').textContent = fmt(billTotal);
  setPayPalSubmitting(false);
  document.getElementById('paypalModal').classList.remove('hidden');

  if (!paypalConfig && paypalConfigPromise) {
    paypalConfig = await paypalConfigPromise;
  }

  if (paypalConfig?.enabled) {
    initPayPalButtons().catch((e) => {
      document.getElementById('paypalNote').textContent = e.message || 'No se pudo iniciar PayPal';
    });
    return;
  }

  if (!paypalConfig?.configured) {
    document.getElementById('paypalNote').textContent = 'PayPal no está configurado en el servidor.';
    return;
  }

  if (!paypalConfig?.connected) {
    document.getElementById('paypalNote').textContent = 'El bar aún no ha conectado su cuenta PayPal en el panel admin.';
    return;
  }

  document.getElementById('paypalNote').textContent = 'PayPal no está disponible temporalmente.';
});

document.getElementById('closePaypalModal').addEventListener('click', () => {
  if (isPayPalSubmitting) return;
  document.getElementById('paypalModal').classList.add('hidden');
});
document.getElementById('cancelPaypalBtn').addEventListener('click', () => {
  if (isPayPalSubmitting) return;
  document.getElementById('paypalModal').classList.add('hidden');
});

document.getElementById('closeCashConfirmModal').addEventListener('click', () => {
  closeCashConfirmModal();
});

document.getElementById('cancelCashConfirmBtn').addEventListener('click', () => {
  closeCashConfirmModal();
});

document.getElementById('acceptCashConfirmBtn').addEventListener('click', async () => {
  if (isCashConfirmSubmitting) return;

  setCashConfirmSubmitting(true);
  const result = await completeCashPaymentFlow();

  if (!result.ok) {
    setCashConfirmSubmitting(false);
    alert(result.error || 'No se pudo confirmar el pago en efectivo');
    return;
  }

  showToast('waiterToast');
  setTimeout(() => {
    redirectToClosedTable();
  }, 900);
});

// Close modal on overlay click
document.getElementById('paypalModal').addEventListener('click', e => {
  if (isPayPalSubmitting) return;
  if (e.target === document.getElementById('paypalModal'))
    document.getElementById('paypalModal').classList.add('hidden');
});

document.getElementById('cashConfirmModal').addEventListener('click', e => {
  if (e.target === document.getElementById('cashConfirmModal')) {
    closeCashConfirmModal();
  }
});

document.getElementById('finalizedCallWaiterBtn').addEventListener('click', async () => {
  await api('POST', '/api/waiter-calls', { tableToken: token, source: 'pagar_finalizado' });
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
