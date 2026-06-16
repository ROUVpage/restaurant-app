const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

let selectedDate = isoToday();
let selectedSlot = 'lunch';
let currentMonthDate = new Date(`${selectedDate}T00:00:00`);
let monthAvailability = new Map();
let reservationsSource = null;
let realtimeDebounceTimer = null;
let fallbackPollInterval = null;
let pendingReservation = null;

const monthSelect = document.getElementById('monthSelect');
const yearSelect = document.getElementById('yearSelect');
const calendarGrid = document.getElementById('calendarGrid');
const selectedDateLabel = document.getElementById('selectedDateLabel');
const slotMetaLunch = document.getElementById('slotMetaLunch');
const slotMetaDinner = document.getElementById('slotMetaDinner');
const slotCards = document.querySelectorAll('.slot-card');
const errorEl = document.getElementById('publicReservationError');
const successEl = document.getElementById('publicReservationSuccess');
const formEl = document.getElementById('reservationForm');
const submitBtn = document.getElementById('submitReservationBtn');
const confirmationOverlay = document.getElementById('confirmationOverlay');
const acceptConfirmBtn = document.getElementById('acceptConfirmBtn');
const cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
const closeConfirmModalBtn = document.getElementById('closeConfirmModalBtn');
const backToPreviousBtn = document.getElementById('backToPreviousBtn');
const cancelReservationInfoBtn = document.getElementById('cancelReservationInfoBtn');
const cancelInfoOverlay = document.getElementById('cancelInfoOverlay');
const closeCancelInfoBtn = document.getElementById('closeCancelInfoBtn');
const acceptCancelInfoBtn = document.getElementById('acceptCancelInfoBtn');

(async function init() {
  initMonthYearPicker();
  wireEvents();
  await loadMonth();
  await loadDay(selectedDate);
  startRealtimeUpdates();
  startFallbackPolling();
})();

function wireEvents() {
  document.getElementById('prevMonthBtn').addEventListener('click', async () => {
    currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1);
    syncMonthYearPicker();
    await loadMonth();
  });

  document.getElementById('nextMonthBtn').addEventListener('click', async () => {
    currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1);
    syncMonthYearPicker();
    await loadMonth();
  });

  monthSelect.addEventListener('change', async () => {
    const nextMonth = Number(monthSelect.value);
    const nextYear = Number(yearSelect.value);
    currentMonthDate = new Date(nextYear, nextMonth, 1);
    await loadMonth();
  });

  yearSelect.addEventListener('change', async () => {
    const nextMonth = Number(monthSelect.value);
    const nextYear = Number(yearSelect.value);
    currentMonthDate = new Date(nextYear, nextMonth, 1);
    await loadMonth();
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      await loadMonth();
      await loadDay(selectedDate);
    }
  });

  backToPreviousBtn?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    location.href = '/';
  });

  cancelConfirmBtn.addEventListener('click', () => {
    closeConfirmationOverlay();
  });

  closeConfirmModalBtn.addEventListener('click', () => {
    closeConfirmationOverlay();
  });

  cancelReservationInfoBtn.addEventListener('click', () => {
    cancelInfoOverlay.classList.remove('hidden');
  });

  closeCancelInfoBtn.addEventListener('click', () => {
    closeCancelInfoOverlay();
  });

  acceptCancelInfoBtn.addEventListener('click', () => {
    closeCancelInfoOverlay();
  });

  cancelInfoOverlay.addEventListener('click', (e) => {
    if (e.target === cancelInfoOverlay) closeCancelInfoOverlay();
  });

  confirmationOverlay.addEventListener('click', (e) => {
    if (e.target === confirmationOverlay) closeConfirmationOverlay();
  });

  acceptConfirmBtn.addEventListener('click', async () => {
    if (!pendingReservation) return;
    await createReservationFromPending();
  });

  slotCards.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('closed')) return;
      selectedSlot = btn.dataset.slot;
      renderSelectedSlot();
    });
  });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();

    const candidate = {
      date: selectedDate,
      slot: selectedSlot,
      name: document.getElementById('resName').value.trim(),
      phone: document.getElementById('resPhone').value.trim(),
      persons: Number(document.getElementById('resPersons').value)
    };

    const validated = validateReservationCandidate(candidate);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    pendingReservation = validated.payload;
    renderConfirmationTab(pendingReservation);
    confirmationOverlay.classList.remove('hidden');
  });
}

function closeConfirmationOverlay() {
  pendingReservation = null;
  confirmationOverlay.classList.add('hidden');
}

function closeCancelInfoOverlay() {
  cancelInfoOverlay.classList.add('hidden');
}

async function createReservationFromPending() {
  if (!pendingReservation) return;

  submitBtn.disabled = true;
  acceptConfirmBtn.disabled = true;
  try {
    const response = await api('POST', '/api/reservations', pendingReservation);
    if (!response.success) {
      setError(response.error || 'No se pudo crear la reserva.');
      return;
    }

    setSuccess('Reserva confirmada correctamente.');
    document.getElementById('resName').value = '';
    document.getElementById('resPhone').value = '';
    document.getElementById('resPersons').value = '2';
    closeConfirmationOverlay();
    await loadMonth();
    await loadDay(selectedDate);
  } catch (_) {
    setError('Error de conexion al reservar.');
  } finally {
    submitBtn.disabled = false;
    acceptConfirmBtn.disabled = false;
  }
}

function renderConfirmationTab(payload) {
  document.getElementById('confirmDate').textContent = formatDate(payload.date);
  document.getElementById('confirmSlot').textContent = payload.slot === 'lunch' ? 'Comida - 14:00' : 'Cena - 21:00';
  document.getElementById('confirmName').textContent = payload.name;
  document.getElementById('confirmPhone').textContent = payload.phone;
  document.getElementById('confirmPersons').textContent = String(payload.persons);
}

function validateReservationCandidate(candidate) {
  const name = String(candidate.name || '').trim();
  const normalizedPhone = String(candidate.phone || '').replace(/\s+/g, '').trim();
  const persons = Number(candidate.persons);

  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,79}$/.test(name)) {
    return { ok: false, error: 'Introduce un nombre válido (2-80 caracteres).' };
  }

  if (!/^\d+$/.test(normalizedPhone)) {
    return { ok: false, error: 'El teléfono está mal: solo puede contener números.' };
  }

  if (normalizedPhone.length !== 9) {
    return { ok: false, error: 'El teléfono está mal: debe tener exactamente 9 dígitos.' };
  }

  if (!/^[67]/.test(normalizedPhone)) {
    return { ok: false, error: 'El teléfono está mal: debe empezar por 6 o 7.' };
  }

  if (!Number.isInteger(persons) || persons < 1 || persons > 30) {
    return { ok: false, error: 'Número de personas inválido (1-30).' };
  }

  return {
    ok: true,
    payload: {
      ...candidate,
      name,
      phone: normalizedPhone,
      persons
    }
  };
}

async function loadMonth() {
  const monthKey = `${currentMonthDate.getFullYear()}-${String(currentMonthDate.getMonth() + 1).padStart(2, '0')}`;
  syncMonthYearPicker();

  monthAvailability = new Map();
  try {
    const data = await api('GET', `/api/admin/reservations/month?month=${monthKey}`);
    if (Array.isArray(data)) {
      data.forEach((d) => monthAvailability.set(d.date, d));
    }
  } catch (_) {
    // Ignore and keep empty availability map
  }

  renderCalendar();
}

function initMonthYearPicker() {
  monthSelect.innerHTML = monthNames
    .map((name, idx) => `<option value="${idx}">${name}</option>`)
    .join('');

  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear - 5; y <= thisYear + 5; y += 1) years.push(y);
  yearSelect.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join('');

  syncMonthYearPicker();
}

function syncMonthYearPicker() {
  monthSelect.value = String(currentMonthDate.getMonth());
  const yearValue = String(currentMonthDate.getFullYear());
  if (![...yearSelect.options].some((opt) => opt.value === yearValue)) {
    yearSelect.innerHTML += `<option value="${yearValue}">${yearValue}</option>`;
  }
  yearSelect.value = yearValue;
}

function queueRealtimeRefresh() {
  if (realtimeDebounceTimer) return;
  realtimeDebounceTimer = setTimeout(async () => {
    realtimeDebounceTimer = null;
    await loadMonth();
    await loadDay(selectedDate);
  }, 160);
}

function startRealtimeUpdates() {
  if (reservationsSource) return;
  reservationsSource = new EventSource('/api/reservations/events');

  reservationsSource.addEventListener('update', () => {
    queueRealtimeRefresh();
  });

  reservationsSource.onerror = () => {
    try { reservationsSource.close(); } catch (_) {}
    reservationsSource = null;
    setTimeout(startRealtimeUpdates, 2000);
  };
}

function startFallbackPolling() {
  if (fallbackPollInterval) return;
  fallbackPollInterval = setInterval(async () => {
    await loadMonth();
    await loadDay(selectedDate);
  }, 15000);
}

function renderCalendar() {
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = isoToday();

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push('<div></div>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayData = monthAvailability.get(date);
    const disabled = date < today;

    let dayClass = 'calendar-day';
    if (date === selectedDate) dayClass += ' selected';

    if (dayData) {
      const hasAnySpace = (dayData.lunch_open && dayData.lunch_available > 0) || (dayData.dinner_open && dayData.dinner_available > 0);
      dayClass += hasAnySpace ? ' has-space' : ' full';
    }

    cells.push(`<button type="button" class="${dayClass}" data-date="${date}" ${disabled ? 'disabled' : ''}>${day}</button>`);
  }

  calendarGrid.innerHTML = cells.join('');
  calendarGrid.querySelectorAll('[data-date]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      selectedDate = btn.dataset.date;
      await loadDay(selectedDate);
      renderCalendar();
    });
  });
}

async function loadDay(date) {
  selectedDateLabel.textContent = `Reservas para ${formatDate(date)}`;
  clearMessages();

  const data = await api('GET', `/api/reservations/availability?date=${date}`);
  const lunch = data.slots?.lunch;
  const dinner = data.slots?.dinner;

  updateSlotCard('lunch', lunch, slotMetaLunch);
  updateSlotCard('dinner', dinner, slotMetaDinner);

  if (selectedSlot === 'lunch' && (!lunch?.open || lunch.available <= 0)) {
    selectedSlot = (dinner?.open && dinner.available > 0) ? 'dinner' : 'lunch';
  }
  if (selectedSlot === 'dinner' && (!dinner?.open || dinner.available <= 0)) {
    selectedSlot = (lunch?.open && lunch.available > 0) ? 'lunch' : 'dinner';
  }

  renderSelectedSlot();
}

function updateSlotCard(slotKey, slotData, labelEl) {
  const card = document.querySelector(`.slot-card[data-slot="${slotKey}"]`);
  if (!card || !slotData) return;

  if (!slotData.open) {
    card.classList.add('closed');
    labelEl.textContent = 'Turno ocupado por el bar';
    return;
  }

  if (slotData.available <= 0) {
    card.classList.add('closed');
    labelEl.textContent = `Completo (${slotData.booked}/${slotData.capacity})`;
    return;
  }

  card.classList.remove('closed');
  labelEl.textContent = `Disponibles ${slotData.available} de ${slotData.capacity}`;
}

function renderSelectedSlot() {
  slotCards.forEach((card) => {
    card.classList.toggle('selected', card.dataset.slot === selectedSlot);
  });
  if (pendingReservation && pendingReservation.slot !== selectedSlot) {
    closeConfirmationOverlay();
  }
}

function setError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function setSuccess(msg) {
  successEl.textContent = msg;
  successEl.classList.remove('hidden');
}

function clearMessages() {
  errorEl.classList.add('hidden');
  successEl.classList.add('hidden');
}

function isoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
