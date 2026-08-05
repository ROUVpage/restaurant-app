const LOCAL_PICKUP_ADDRESS = 'Calle del local - Recogida en barra';
const ONLINE_ORDER_CONTEXT_KEY = 'online_order_context_v1';

const state = {
  mode: 'delivery'
};

const modeDeliveryBtn = document.getElementById('modeDeliveryBtn');
const modePickupBtn = document.getElementById('modePickupBtn');
const orderLocationInput = document.getElementById('orderLocationInput');
const startOrderBtn = document.getElementById('startOrderBtn');
const orderHint = document.getElementById('orderHint');

function setMode(nextMode) {
  state.mode = nextMode === 'pickup' ? 'pickup' : 'delivery';
  const isPickup = state.mode === 'pickup';

  modeDeliveryBtn.classList.toggle('active', !isPickup);
  modeDeliveryBtn.setAttribute('aria-selected', String(!isPickup));
  modePickupBtn.classList.toggle('active', isPickup);
  modePickupBtn.setAttribute('aria-selected', String(isPickup));

  if (isPickup) {
    orderLocationInput.value = LOCAL_PICKUP_ADDRESS;
    orderLocationInput.placeholder = 'Direccion del local';
    orderHint.textContent = 'Recogida en local. Te avisaremos cuando este listo.';
  } else {
    if (orderLocationInput.value === LOCAL_PICKUP_ADDRESS) {
      orderLocationInput.value = '';
    }
    orderLocationInput.placeholder = 'Introduce tu direccion';
    orderHint.textContent = 'Te llevamos el pedido a la direccion indicada.';
  }
}

modeDeliveryBtn?.addEventListener('click', () => setMode('delivery'));
modePickupBtn?.addEventListener('click', () => setMode('pickup'));

startOrderBtn?.addEventListener('click', () => {
  const rawAddress = (orderLocationInput?.value || '').trim();
  if (!rawAddress) {
    orderLocationInput?.focus();
    return;
  }

  try {
    localStorage.setItem(ONLINE_ORDER_CONTEXT_KEY, JSON.stringify({
      mode: state.mode,
      address: rawAddress
    }));
  } catch (_) {}

  const params = new URLSearchParams({
    mode: state.mode,
    address: rawAddress
  });

  location.href = `/pedido-online?${params.toString()}`;
});

setMode('delivery');
