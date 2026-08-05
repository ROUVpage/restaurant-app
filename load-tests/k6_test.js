import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500']
  }
};

export default function () {
  const BASE = 'https://restaurant-app-6678.onrender.com';
  const res = http.get(`${BASE}/`);
  check(res, {
    'home status 200': (r) => r.status === 200,
    'home not empty': (r) => r.body && r.body.length > 100
  });
  // Fetch reservas page
  const r2 = http.get(`${BASE}/reservas`);
  check(r2, { 'reservas status 200': (r) => r.status === 200 });
  sleep(1);
}
