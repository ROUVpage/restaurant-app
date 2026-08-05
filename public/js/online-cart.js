const ONLINE_ORDER_CONTEXT_KEY = 'online_order_context_v1';
const ONLINE_ORDER_CART_KEY = 'online_order_cart_v1';

function normalizeOnlineMode(mode) {
  return String(mode || '').toLowerCase() === 'pickup' ? 'pickup' : 'delivery';
}

function getOnlineOrderContext() {
  try {
    const raw = localStorage.getItem(ONLINE_ORDER_CONTEXT_KEY);
    if (!raw) return { mode: 'delivery', address: '' };
    const parsed = JSON.parse(raw);
    return {
      mode: normalizeOnlineMode(parsed.mode),
      address: String(parsed.address || '').trim(),
      phone: String(parsed.phone || '').trim()
    };
  } catch (_) {
    return { mode: 'delivery', address: '' };
  }
}

function setOnlineOrderContext(next) {
  const current = getOnlineOrderContext();
  const merged = {
    ...current,
    ...next,
    mode: normalizeOnlineMode((next && next.mode) || current.mode)
  };
  localStorage.setItem(ONLINE_ORDER_CONTEXT_KEY, JSON.stringify(merged));
  return merged;
}

function getOnlineOrderCart() {
  try {
    const raw = localStorage.getItem(ONLINE_ORDER_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        productId: String(item.productId || '').trim(),
        productName: String(item.productName || '').trim(),
        productPrice: Number(item.productPrice || 0),
        quantity: Number(item.quantity || 0)
      }))
      .filter((item) => item.productId && item.productName && Number.isFinite(item.productPrice) && item.quantity > 0);
  } catch (_) {
    return [];
  }
}

function setOnlineOrderCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    localStorage.removeItem(ONLINE_ORDER_CART_KEY);
    return;
  }
  localStorage.setItem(ONLINE_ORDER_CART_KEY, JSON.stringify(items));
}

function clearOnlineOrderCart() {
  localStorage.removeItem(ONLINE_ORDER_CART_KEY);
}

function getOnlineCartTotals(items) {
  const list = Array.isArray(items) ? items : [];
  const units = list.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const total = list.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.productPrice || 0), 0);
  return { units, total };
}

function normalizePhone(phone) {
  let normalized = String(phone || '').replace(/\D+/g, '');
  if (normalized.startsWith('34') && normalized.length === 11) normalized = normalized.slice(2);
  if (normalized.startsWith('0') && normalized.length === 10) normalized = normalized.slice(1);
  return normalized;
}

function isValidSpanishMobile(phone) {
  const normalized = normalizePhone(phone);
  return /^([67]\d{8})$/.test(normalized);
}
