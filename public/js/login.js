// ── LOGIN ─────────────────────────────────────────────────────────────────

(async function init() {
  const deviceId = getDeviceId();
  if (deviceId) {
    const data = await api('POST', '/api/auth/check', { deviceId });
    if (data.authenticated) {
      location.replace('/admin');
      return;
    }
  }
})();

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');

  const data = await api('POST', '/api/auth/login', {
    username, password,
    deviceId: getDeviceId()
  });

  if (data.success) {
    setDeviceId(data.deviceId);
    location.replace('/admin');
  } else {
    errEl.classList.remove('hidden');
  }
});
