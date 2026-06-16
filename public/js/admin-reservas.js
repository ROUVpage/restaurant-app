const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

let selectedDate = isoToday();
let currentMonthDate = new Date(`${selectedDate}T00:00:00`);
let monthData = new Map();
let currentDaySettings = null;
let reservationsSource = null;
let realtimeDebounceTimer = null;
let fallbackPollInterval = null;

const monthSelect = document.getElementById('monthSelect');
const yearSelect = document.getElementById('yearSelect');
const calendarGrid = document.getElementById('calendarGrid');
const dayTitle = document.getElementById('dayTitle');
const dayReservations = document.getElementById('dayReservations');
const errorEl = document.getElementById('adminReservationError');

(async function init() {
  const deviceId = getDeviceId();
  if (!deviceId) {
    location.replace('/login.html');
    return;
  }

  const auth = await api('POST', '/api/auth/check', { deviceId });
  if (!auth.authenticated) {
    location.replace('/login.html');
    return;
  }

  wireEvents();
  initMonthYearPicker();
  await loadMonth();
  await loadDay(selectedDate);
  startRealtimeUpdates();
  startFallbackPolling();
})();

function wireEvents() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    stopRealtimeUpdates();
    stopFallbackPolling();
    await api('POST', '/api/auth/logout', { deviceId: getDeviceId() });
    clearDeviceId();
    location.replace('/login.html');
  });

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

  document.getElementById('saveLunchBtn').addEventListener('click', async () => {
    await saveSlotSettings('lunch');
  });
  document.getElementById('saveDinnerBtn').addEventListener('click', async () => {
    await saveSlotSettings('dinner');
  });
  document.getElementById('toggleLunchBtn').addEventListener('click', async () => {
    await toggleSlotOpen('lunch');
  });
  document.getElementById('toggleDinnerBtn').addEventListener('click', async () => {
    await toggleSlotOpen('dinner');
  });

  document.getElementById('adminReservationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');

    const payload = {
      date: selectedDate,
      slot: document.getElementById('adminResSlot').value,
      name: document.getElementById('adminResName').value.trim(),
      phone: document.getElementById('adminResPhone').value.trim(),
      persons: Number(document.getElementById('adminResPersons').value)
    };

    if (!payload.name || !payload.phone || !Number.isInteger(payload.persons) || payload.persons < 1) {
      setError('Datos invalidos para crear la reserva.');
      return;
    }

    const response = await api('POST', '/api/admin/reservations', payload);
    if (!response.success) {
      setError(response.error || 'No se pudo crear la reserva.');
      return;
    }

    document.getElementById('adminResName').value = '';
    document.getElementById('adminResPhone').value = '';
    document.getElementById('adminResPersons').value = '2';
    await loadMonth();
    await loadDay(selectedDate);
  });
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

function stopRealtimeUpdates() {
  if (!reservationsSource) return;
  try { reservationsSource.close(); } catch (_) {}
  reservationsSource = null;
}

function startFallbackPolling() {
  if (fallbackPollInterval) return;
  fallbackPollInterval = setInterval(async () => {
    await loadMonth();
    await loadDay(selectedDate);
  }, 15000);
}

function stopFallbackPolling() {
  if (!fallbackPollInterval) return;
  clearInterval(fallbackPollInterval);
  fallbackPollInterval = null;
}

async function loadMonth() {
  const monthKey = `${currentMonthDate.getFullYear()}-${String(currentMonthDate.getMonth() + 1).padStart(2, '0')}`;
  syncMonthYearPicker();

  monthData = new Map();
  const rows = await api('GET', `/api/admin/reservations/month?month=${monthKey}`);
  if (Array.isArray(rows)) {
    rows.forEach((row) => monthData.set(row.date, row));
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

function renderCalendar() {
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const html = [];
  for (let i = 0; i < firstWeekday; i += 1) html.push('<div></div>');

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const info = monthData.get(date);
    const totalBooked = info ? (Number(info.lunch_booked) + Number(info.dinner_booked)) : 0;
    const totalCapacity = info ? (Number(info.lunch_capacity) + Number(info.dinner_capacity)) : 1;

    let densityClass = 'light';
    if (totalBooked >= totalCapacity) densityClass = 'hot';
    else if (totalBooked >= totalCapacity * 0.6) densityClass = 'medium';

    let classes = `calendar-day ${densityClass}`;
    if (date === selectedDate) classes += ' selected';

    html.push(`<button type="button" class="${classes}" data-date="${date}">${day}</button>`);
  }

  calendarGrid.innerHTML = html.join('');
  calendarGrid.querySelectorAll('[data-date]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      selectedDate = btn.dataset.date;
      renderCalendar();
      await loadDay(selectedDate);
    });
  });
}

async function loadDay(date) {
  const data = await api('GET', `/api/admin/reservations/day?date=${date}`);
  dayTitle.textContent = `Reservas del ${formatDate(date)}`;

  const settings = data.settings;
  currentDaySettings = settings;
  const lunch = data.availability?.slots?.lunch;
  const dinner = data.availability?.slots?.dinner;
  const reservations = Array.isArray(data.reservations) ? data.reservations : [];

  const lunchReservationCount = reservations.filter((r) => r.slot === 'lunch' && r.status === 'active').length;
  const dinnerReservationCount = reservations.filter((r) => r.slot === 'dinner' && r.status === 'active').length;

  document.getElementById('lunchCapacity').value = settings.lunch_capacity;
  document.getElementById('dinnerCapacity').value = settings.dinner_capacity;
  updateSlotToggleButton('lunch', !!settings.lunch_open);
  updateSlotToggleButton('dinner', !!settings.dinner_open);

  document.getElementById('lunchStatus').textContent = `Reservas ${lunchReservationCount}/${lunch.capacity} - libres ${lunch.available}`;
  document.getElementById('dinnerStatus').textContent = `Reservas ${dinnerReservationCount}/${dinner.capacity} - libres ${dinner.available}`;

  renderReservations(reservations);
}

function renderReservations(reservations) {
  if (!reservations.length) {
    dayReservations.innerHTML = '<div class="empty-state">Sin reservas para este dia.</div>';
    return;
  }

  dayReservations.innerHTML = reservations.map((r) => {
    const slotLabel = r.slot === 'lunch' ? 'Comida 14:00' : 'Cena 21:00';
    return `
      <div class="reservation-row ${r.status === 'cancelled' ? 'cancelled' : ''}">
        <span class="badge-slot">${slotLabel}</span>
        <div class="res-main">
          <strong>${escapeHtml(r.name)} - ${r.persons} personas</strong>
          <span>${escapeHtml(r.phone)} | ${r.source}</span>
        </div>
        ${r.status === 'active' ? `<button class="btn-danger" data-cancel-id="${r.id}">Cancelar</button>` : '<span class="badge-slot">Cancelada</span>'}
      </div>
    `;
  }).join('');

  dayReservations.querySelectorAll('[data-cancel-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.cancelId;
      const response = await api('PATCH', `/api/admin/reservations/${id}/cancel`);
      if (!response.success) {
        setError(response.error || 'No se pudo cancelar la reserva.');
        return;
      }
      await loadMonth();
      await loadDay(selectedDate);
    });
  });
}

async function saveSlotSettings(slot) {
  if (!currentDaySettings) return;
  const open = !!currentDaySettings[`${slot}_open`];
  const capacity = Number(document.getElementById(`${slot}Capacity`).value);

  const response = await api('PATCH', '/api/admin/reservations/day', {
    date: selectedDate,
    slot,
    open,
    capacity
  });

  if (!response.success) {
    setError(response.error || 'No se pudo guardar la configuracion.');
    return;
  }

  await loadMonth();
  await loadDay(selectedDate);
}

async function toggleSlotOpen(slot) {
  if (!currentDaySettings) return;
  const isOpen = !!currentDaySettings[`${slot}_open`];
  const response = await api('PATCH', '/api/admin/reservations/day', {
    date: selectedDate,
    slot,
    open: !isOpen
  });

  if (!response.success) {
    setError(response.error || 'No se pudo cambiar el estado del turno.');
    return;
  }

  await loadMonth();
  await loadDay(selectedDate);
}

function updateSlotToggleButton(slot, isOpen) {
  const btn = document.getElementById(`toggle${slot[0].toUpperCase()}${slot.slice(1)}Btn`);
  if (!btn) return;
  btn.textContent = isOpen ? 'Cerrar turno' : 'Abrir turno';
  btn.classList.toggle('btn-danger', isOpen);
  btn.classList.toggle('btn-ghost', !isOpen);
}

function setError(msg) {
  if (!msg) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
    return;
  }
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
