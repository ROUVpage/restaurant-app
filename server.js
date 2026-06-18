const express = require('express');
const compression = require('compression');
const initSqlJs = require('sql.js');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'restaurant.db');
const RESERVATION_TIMEZONE = 'Europe/Madrid';
const RESERVATION_SLOTS = {
  lunch: { label: 'Comida', hour: 14 },
  dinner: { label: 'Cena', hour: 21 }
};
const DEFAULT_SLOT_CAPACITY = 20;
const RESERVATION_NOTIFICATION_EMAIL = 'padelstats0@gmail.com';
let googleCalendarClient = null;
let googleCalendarEnabled = false;
let mailTransporter = null;
let mailTransporterReady = false;
const PAYPAL_ENV = String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
const PAYPAL_CLIENT_ID = String(process.env.PAYPAL_CLIENT_ID || '').trim();
const PAYPAL_CLIENT_SECRET = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
const PAYPAL_CURRENCY = String(process.env.PAYPAL_CURRENCY || 'EUR').toUpperCase();
const PAYPAL_CONNECT_REDIRECT_PATH = '/api/paypal/connect/callback';
const PAYPAL_CONNECT_SCOPE = process.env.PAYPAL_CONNECT_SCOPE || 'openid';
const PAYPAL_TOKEN_ENCRYPTION_KEY = String(process.env.PAYPAL_TOKEN_ENCRYPTION_KEY || '').trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || PAYPAL_TOKEN_ENCRYPTION_KEY || 'restaurant-default-secret-change-me').trim();
const PAYPAL_STATE_TTL_MS = 10 * 60 * 1000;
let paypalTokenCache = { token: null, expiresAt: 0 };
const paypalOAuthStates = new Map();

// ── SESSION TOKEN HELPERS (HMAC-signed, survive server restarts) ────────────
function signDeviceId(uuid) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(uuid).digest('hex');
  return `${uuid}.${sig}`;
}

function verifyDeviceId(deviceId) {
  if (!deviceId || typeof deviceId !== 'string') return false;
  const dotIdx = deviceId.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const uuid = deviceId.slice(0, dotIdx);
  const sig = deviceId.slice(dotIdx + 1);
  if (!uuid || !sig) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(uuid).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
}

function getFirstLanIPv4() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}

function parseHostHeader(hostHeader) {
  const fallback = { hostname: 'localhost', port: '' };
  if (!hostHeader || typeof hostHeader !== 'string') return fallback;

  const raw = hostHeader.split(',')[0].trim();
  if (!raw) return fallback;

  // IPv6 host format: [::1]:3000
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end !== -1) {
      const hostname = raw.slice(1, end);
      const rest = raw.slice(end + 1);
      const port = rest.startsWith(':') ? rest.slice(1) : '';
      return { hostname, port };
    }
  }

  const firstColon = raw.indexOf(':');
  const lastColon = raw.lastIndexOf(':');
  if (firstColon !== -1 && firstColon === lastColon) {
    return {
      hostname: raw.slice(0, firstColon),
      port: raw.slice(firstColon + 1) || ''
    };
  }

  return { hostname: raw, port: '' };
}

function isLoopbackOrLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}

function normalizeBaseUrl(url) {
  if (!url) return null;
  const trimmed = String(url).trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function getPublicBaseUrl(req) {
  const configured = normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
  if (configured) return configured;

  return getRequestBaseUrl(req);
}

function getRequestBaseUrl(req) {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const proto = protoHeader || req.protocol || 'http';
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.headers.host || `localhost:${PORT}`;
  const parsed = parseHostHeader(host);

  let hostname = parsed.hostname;
  const defaultPort = proto === 'https' ? '443' : '80';
  const port = parsed.port || defaultPort;

  if (isLoopbackOrLocalHost(hostname)) {
    const lanIp = getFirstLanIPv4();
    if (lanIp) hostname = lanIp;
  }

  const omitPort = (proto === 'http' && port === '80') || (proto === 'https' && port === '443');
  return `${proto}://${hostname}${omitPort ? '' : `:${port}`}`;
}

function getTableBaseUrl(req) {
  const configured = normalizeBaseUrl(process.env.TABLE_PUBLIC_BASE_URL);
  if (configured) return configured;

  return getRequestBaseUrl(req);
}

function toIsoDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeDate(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (toIsoDate(parsed) !== trimmed) return null;
  return trimmed;
}

function getDateRangeForMonth(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(monthValue || '')) return null;
  const [year, month] = monthValue.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return null;
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return {
    start: toIsoDate(first),
    end: toIsoDate(last)
  };
}

function slotDateTime(date, slot) {
  const slotInfo = RESERVATION_SLOTS[slot];
  if (!slotInfo) return null;
  const hour = String(slotInfo.hour).padStart(2, '0');
  const start = `${date}T${hour}:00:00`;
  const endHour = String(slotInfo.hour + 2).padStart(2, '0');
  const end = `${date}T${endHour}:00:00`;
  return { start, end, label: slotInfo.label };
}

function getGoogleCalendarConfig() {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) return null;

  let credentials = null;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      console.error('GOOGLE_SERVICE_ACCOUNT_JSON no es JSON válido');
      return null;
    }
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    try {
      credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8'));
    } catch (e) {
      console.error('No se pudo leer GOOGLE_SERVICE_ACCOUNT_FILE:', e.message);
      return null;
    }
  }

  if (!credentials) return null;
  return { calendarId, credentials };
}

function initGoogleCalendarIfConfigured() {
  const cfg = getGoogleCalendarConfig();
  if (!cfg) {
    googleCalendarEnabled = false;
    return;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: cfg.credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
  googleCalendarClient = {
    calendarId: cfg.calendarId,
    api: google.calendar({ version: 'v3', auth })
  };
  googleCalendarEnabled = true;
}

function initMailTransporterIfConfigured() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    mailTransporterReady = false;
    return;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  mailTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });
  mailTransporterReady = true;
}

async function sendReservationWebhook(reservation) {
  const webhookUrl = process.env.RESERVATION_WEBHOOK_URL;
  if (!webhookUrl) return false;

  const slotLabel = reservation.slot === 'lunch' ? 'Comida - 14:00' : 'Cena - 21:00';
  const payload = {
    targetEmail: RESERVATION_NOTIFICATION_EMAIL,
    reservation: {
      date: reservation.reservation_date,
      slot: reservation.slot,
      slotLabel,
      name: reservation.name,
      phone: reservation.phone,
      persons: reservation.persons,
      source: reservation.source,
      createdAt: reservation.created_at
    }
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Webhook respondio con estado ${response.status}`);
    }

    return true;
  } catch (e) {
    console.error('No se pudo enviar la notificacion por webhook:', e.message);
    return false;
  }
}

async function sendReservationEmail(reservation) {
  if (!mailTransporterReady || !mailTransporter) return false;

  const slotLabel = reservation.slot === 'lunch' ? 'Comida - 14:00' : 'Cena - 21:00';
  const subject = `Nueva reserva - ${reservation.name}`;
  const text = [
    'Nueva reserva recibida',
    `Fecha: ${reservation.reservation_date}`,
    `Turno: ${slotLabel}`,
    `Nombre: ${reservation.name}`,
    `Telefono: ${reservation.phone}`,
    `Personas: ${reservation.persons}`,
    `Origen: ${reservation.source}`
  ].join('\n');

  const html = `
    <h2>Nueva reserva recibida</h2>
    <ul>
      <li><strong>Fecha:</strong> ${reservation.reservation_date}</li>
      <li><strong>Turno:</strong> ${slotLabel}</li>
      <li><strong>Nombre:</strong> ${reservation.name}</li>
      <li><strong>Telefono:</strong> ${reservation.phone}</li>
      <li><strong>Personas:</strong> ${reservation.persons}</li>
      <li><strong>Origen:</strong> ${reservation.source}</li>
    </ul>
  `;

  try {
    await mailTransporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: RESERVATION_NOTIFICATION_EMAIL,
      subject,
      text,
      html
    });
    return true;
  } catch (e) {
    console.error('No se pudo enviar el correo de reserva:', e.message);
    return false;
  }
}

async function sendReservationNotification(reservation) {
  const webhookSent = await sendReservationWebhook(reservation);
  if (webhookSent) return true;

  if (mailTransporterReady && mailTransporter) {
    return sendReservationEmail(reservation);
  }

  return false;
}

async function createGoogleCalendarEvent(reservation) {
  if (!googleCalendarEnabled || !googleCalendarClient) return null;

  const slot = slotDateTime(reservation.reservation_date, reservation.slot);
  if (!slot) return null;

  try {
    const response = await googleCalendarClient.api.events.insert({
      calendarId: googleCalendarClient.calendarId,
      requestBody: {
        summary: `Reserva ${slot.label} - ${reservation.name}`,
        description: `Telefono: ${reservation.phone}\nPersonas: ${reservation.persons}\nOrigen: ${reservation.source}`,
        start: { dateTime: slot.start, timeZone: RESERVATION_TIMEZONE },
        end: { dateTime: slot.end, timeZone: RESERVATION_TIMEZONE }
      }
    });
    return response.data.id || null;
  } catch (e) {
    console.error('No se pudo crear evento en Google Calendar:', e.message);
    return null;
  }
}

async function deleteGoogleCalendarEvent(eventId) {
  if (!eventId || !googleCalendarEnabled || !googleCalendarClient) return;
  try {
    await googleCalendarClient.api.events.delete({
      calendarId: googleCalendarClient.calendarId,
      eventId
    });
  } catch (e) {
    console.error('No se pudo eliminar evento en Google Calendar:', e.message);
  }
}

// ── PRODUCTS CATALOG ─────────────────────────────────────────────────────────
const PRODUCTS = {
  tapas: [
    { id: 'tap1', name: 'Patatas Bravas', price: 4.50, description: 'Con salsa brava y alioli' },
    { id: 'tap2', name: 'Croquetas de Jamón', price: 5.00, description: '6 unidades, caseras' },
    { id: 'tap3', name: 'Jamón Ibérico', price: 9.00, description: 'D.O. Guijuelo, 80g' },
    { id: 'tap4', name: 'Boquerones en Vinagre', price: 5.50, description: 'Marinados con ajo y perejil' },
    { id: 'tap5', name: 'Gambas al Ajillo', price: 7.00, description: 'Gambas frescas, aceite y guindilla' },
  ],
  raciones: [
    { id: 'rac1', name: 'Pulpo a la Gallega', price: 14.00, description: 'Con pimentón y aceite de oliva' },
    { id: 'rac2', name: 'Calamares a la Romana', price: 10.00, description: 'Rebozados, con limón' },
    { id: 'rac3', name: 'Tabla de Quesos', price: 12.00, description: 'Selección de quesos artesanos' },
    { id: 'rac4', name: 'Pimientos del Padrón', price: 7.50, description: 'Fritos con sal gruesa' },
    { id: 'rac5', name: 'Chorizo a la Sidra', price: 8.00, description: 'Chorizo asturiano' },
  ],
  bebidas: [
    { id: 'beb1', name: 'Cerveza Artesana', price: 3.50, description: 'Rubia, 33cl' },
    { id: 'beb2', name: 'Vino Tinto Rioja', price: 3.00, description: 'Copa, crianza' },
    { id: 'beb3', name: 'Agua Mineral', price: 1.50, description: '50cl, con o sin gas' },
    { id: 'beb4', name: 'Refresco', price: 2.50, description: 'Cola, naranja, limón' },
    { id: 'beb5', name: 'Zumo Natural', price: 3.50, description: 'Naranja o limón' },
    { id: 'beb6', name: 'Café Espresso', price: 1.80, description: 'Solo, cortado o con leche' },
  ],
  postres: [
    { id: 'pos1', name: 'Tarta de Queso', price: 5.00, description: 'Casera, con mermelada de frutos rojos' },
    { id: 'pos2', name: 'Crema Catalana', price: 4.50, description: 'Con azúcar quemado' },
    { id: 'pos3', name: 'Brownie con Helado', price: 5.50, description: 'Chocolate belga, helado de vainilla' },
    { id: 'pos4', name: 'Flan Casero', price: 4.00, description: 'Con caramelo líquido' },
  ]
};

// ── DB HELPERS ───────────────────────────────────────────────────────────────
let db;
const adminSseClients = new Set();
const tableSseClients = new Map();
const reservationsSseClients = new Set();

function emitAdminUpdate(type, payload = {}) {
  const message = `event: update\ndata: ${JSON.stringify({ type, ts: Date.now(), ...payload })}\n\n`;
  adminSseClients.forEach((res) => {
    try {
      res.write(message);
    } catch (_) {
      adminSseClients.delete(res);
    }
  });
}

function emitTableUpdateByToken(token, type, payload = {}) {
  if (!token) return;
  const clients = tableSseClients.get(token);
  if (!clients || clients.size === 0) return;
  const message = `event: update\ndata: ${JSON.stringify({ type, ts: Date.now(), ...payload })}\n\n`;
  clients.forEach((res) => {
    try {
      res.write(message);
    } catch (_) {
      clients.delete(res);
    }
  });
  if (clients.size === 0) tableSseClients.delete(token);
}

// Emits bill_updated with the current bill embedded so clients can render
// immediately without an extra HTTP round-trip.
function emitBillUpdated(tableId, token) {
  if (!token) return;
  const bill = getTableBillData(tableId);
  const payload = bill
    ? { bill: { items: bill.items, total: bill.total, tableStatus: bill.table ? bill.table.status : null } }
    : {};
  emitTableUpdateByToken(token, 'bill_updated', payload);
}

function emitReservationUpdate(type, payload = {}) {
  const message = `event: update\ndata: ${JSON.stringify({ type, ts: Date.now(), ...payload })}\n\n`;
  reservationsSseClients.forEach((res) => {
    try {
      res.write(message);
    } catch (_) {
      reservationsSseClients.delete(res);
    }
  });
}

function saveDb() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
  } catch (e) {
    console.error('Error saving DB:', e.message);
  }
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbGet(sql, params = []) {
  return dbAll(sql, params)[0] || null;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  const lastId = dbGet('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: lastId ? lastId.id : null };
}

function toMoney(value) {
  return Number(value || 0).toFixed(2);
}

function getTableBillData(tableId) {
  const table = dbGet('SELECT * FROM tables WHERE id = ?', [tableId]);
  if (!table) return null;

  const items = dbAll(`
    SELECT oi.product_id, oi.product_name, oi.product_price, SUM(oi.quantity) as quantity
    FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.table_id = ?
    GROUP BY oi.product_id, oi.product_name, oi.product_price
    HAVING SUM(oi.quantity) > 0
  `, [tableId]);

  const total = items.reduce((sum, item) => sum + Number(item.product_price) * Number(item.quantity), 0);
  return { table, items, total };
}

function markTableAsPaid(tableId) {
  const table = dbGet('SELECT token, number FROM tables WHERE id = ?', [tableId]);
  if (!table) return null;
  dbRun('UPDATE tables SET status = ? WHERE id = ?', ['paid', tableId]);
  saveDb();
  emitAdminUpdate('table_paid');
  emitTableUpdateByToken(table.token, 'table_paid', { tableNumber: table.number });
  return table;
}

function isPayPalConfigured() {
  return Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
}

function hasTokenEncryptionKey() {
  return Boolean(PAYPAL_TOKEN_ENCRYPTION_KEY);
}

function getTokenEncryptionKey() {
  if (!PAYPAL_TOKEN_ENCRYPTION_KEY) return null;
  return crypto.createHash('sha256').update(String(PAYPAL_TOKEN_ENCRYPTION_KEY)).digest();
}

function encryptSecret(plainText) {
  if (!plainText) return null;
  const key = getTokenEncryptionKey();
  if (!key) throw new Error('Falta PAYPAL_TOKEN_ENCRYPTION_KEY para cifrar tokens');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptSecret(payload) {
  if (!payload) return null;
  const key = getTokenEncryptionKey();
  if (!key) throw new Error('Falta PAYPAL_TOKEN_ENCRYPTION_KEY para descifrar tokens');
  const [ivB64, tagB64, dataB64] = String(payload).split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Token cifrado inválido');

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

function getPayPalAuthBase() {
  return PAYPAL_ENV === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';
}

function getPayPalApiBase() {
  return PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

function buildPayPalRedirectUri(req) {
  return `${getPublicBaseUrl(req)}${PAYPAL_CONNECT_REDIRECT_PATH}`;
}

function buildPayPalConnectUrl(req, state) {
  const redirectUri = buildPayPalRedirectUri(req);
  const params = new URLSearchParams({
    client_id: PAYPAL_CLIENT_ID,
    response_type: 'code',
    scope: PAYPAL_CONNECT_SCOPE,
    redirect_uri: redirectUri,
    state
  });
  return `${getPayPalAuthBase()}/signin/authorize?${params.toString()}`;
}

function cleanupPayPalStates() {
  const now = Date.now();
  for (const [state, meta] of paypalOAuthStates.entries()) {
    if (!meta || meta.expiresAt <= now) paypalOAuthStates.delete(state);
  }
}

function createPayPalState(deviceId) {
  cleanupPayPalStates();
  const state = crypto.randomBytes(24).toString('hex');
  paypalOAuthStates.set(state, {
    deviceId,
    createdAt: Date.now(),
    expiresAt: Date.now() + PAYPAL_STATE_TTL_MS
  });
  return state;
}

function consumePayPalState(state) {
  cleanupPayPalStates();
  const meta = paypalOAuthStates.get(state);
  paypalOAuthStates.delete(state);
  if (!meta) return null;
  return meta;
}

function getPayPalConnection() {
  return dbGet('SELECT * FROM paypal_connections WHERE id = 1');
}

function savePayPalConnection(data = {}) {
  const current = getPayPalConnection() || {};
  const next = {
    id: 1,
    merchant_payer_id: data.merchant_payer_id ?? current.merchant_payer_id ?? null,
    merchant_email: data.merchant_email ?? current.merchant_email ?? null,
    merchant_name: data.merchant_name ?? current.merchant_name ?? null,
    access_token_enc: data.access_token_enc ?? current.access_token_enc ?? null,
    refresh_token_enc: data.refresh_token_enc ?? current.refresh_token_enc ?? null,
    token_expires_at: data.token_expires_at ?? current.token_expires_at ?? null,
    scope: data.scope ?? current.scope ?? null,
    status: data.status ?? current.status ?? 'disconnected'
  };

  dbRun(
    `INSERT INTO paypal_connections
      (id, merchant_payer_id, merchant_email, merchant_name, access_token_enc, refresh_token_enc, token_expires_at, scope, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
     ON CONFLICT(id) DO UPDATE SET
      merchant_payer_id = excluded.merchant_payer_id,
      merchant_email = excluded.merchant_email,
      merchant_name = excluded.merchant_name,
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      token_expires_at = excluded.token_expires_at,
      scope = excluded.scope,
      status = excluded.status,
      updated_at = excluded.updated_at`,
    [
      next.id,
      next.merchant_payer_id,
      next.merchant_email,
      next.merchant_name,
      next.access_token_enc,
      next.refresh_token_enc,
      next.token_expires_at,
      next.scope,
      next.status
    ]
  );

  return getPayPalConnection();
}

function disconnectPayPalConnection() {
  return savePayPalConnection({
    merchant_payer_id: null,
    merchant_email: null,
    merchant_name: null,
    access_token_enc: null,
    refresh_token_enc: null,
    token_expires_at: null,
    scope: null,
    status: 'disconnected'
  });
}

function isPayPalConnected() {
  const conn = getPayPalConnection();
  return Boolean(conn && conn.status === 'connected' && conn.access_token_enc);
}

function buildPayPalBasicAuth() {
  return Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
}

async function requestPayPalToken(formBody) {
  const response = await fetch(`${getPayPalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${buildPayPalBasicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formBody
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const detail = payload?.error_description || payload?.error || `status ${response.status}`;
    throw new Error(`No se pudo obtener token PayPal (${detail})`);
  }

  return payload;
}

async function getPayPalAccessToken() {
  if (!isPayPalConfigured()) {
    throw new Error('PayPal no configurado');
  }

  const now = Math.floor(Date.now() / 1000);
  if (paypalTokenCache.token && paypalTokenCache.expiresAt > now + 60) {
    return paypalTokenCache.token;
  }

  const payload = await requestPayPalToken('grant_type=client_credentials');

  paypalTokenCache = {
    token: payload.access_token,
    expiresAt: now + Number(payload.expires_in || 300)
  };
  return paypalTokenCache.token;
}

async function exchangePayPalAuthorizationCode(code, redirectUri) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  return requestPayPalToken(params.toString());
}

async function refreshPayPalMerchantAccessToken(refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  return requestPayPalToken(params.toString());
}

async function fetchPayPalUserInfo(accessToken) {
  const response = await fetch(`${getPayPalApiBase()}/v1/identity/openidconnect/userinfo/?schema=openid`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`No se pudo leer perfil PayPal (${response.status})`);
  }
  return payload;
}

async function getConnectedMerchantAccessToken() {
  const conn = getPayPalConnection();
  if (!conn || conn.status !== 'connected' || !conn.access_token_enc) {
    throw new Error('No hay una cuenta PayPal conectada');
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number(conn.token_expires_at || 0) > now + 60) {
    return decryptSecret(conn.access_token_enc);
  }

  if (!conn.refresh_token_enc) {
    throw new Error('Token de PayPal expirado; reconecta la cuenta PayPal');
  }

  const refreshToken = decryptSecret(conn.refresh_token_enc);
  const tokenPayload = await refreshPayPalMerchantAccessToken(refreshToken);
  const nextAccess = tokenPayload.access_token;
  const nextRefresh = tokenPayload.refresh_token || refreshToken;

  savePayPalConnection({
    access_token_enc: encryptSecret(nextAccess),
    refresh_token_enc: encryptSecret(nextRefresh),
    token_expires_at: now + Number(tokenPayload.expires_in || 300),
    scope: tokenPayload.scope || conn.scope,
    status: 'connected'
  });
  saveDb();
  return nextAccess;
}

async function paypalApiRequest(pathname, { method = 'GET', body, accessToken, requestId } = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
  if (requestId) headers['PayPal-Request-Id'] = requestId;

  const response = await fetch(`${getPayPalApiBase()}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data?.details?.[0]?.issue || data?.message || `HTTP ${response.status}`;
    throw new Error(`PayPal error: ${details}`);
  }

  return data;
}

function isPayPalNotAuthorizedError(error) {
  const msg = String(error?.message || '');
  return /NOT_AUTHORIZED/i.test(msg);
}

async function paypalApiRequestWithTokenFallback(pathname, { method = 'GET', body, requestId } = {}) {
  let merchantError = null;

  if (isPayPalConnected()) {
    try {
      const merchantAccessToken = await getConnectedMerchantAccessToken();
      return await paypalApiRequest(pathname, {
        method,
        body,
        requestId,
        accessToken: merchantAccessToken
      });
    } catch (error) {
      merchantError = error;
      if (!isPayPalNotAuthorizedError(error)) {
        throw error;
      }
      console.warn('Token PayPal conectado sin permisos de cobro; usando fallback de app:', error.message);
    }
  }

  const appAccessToken = await getPayPalAccessToken();
  try {
    return await paypalApiRequest(pathname, {
      method,
      body,
      requestId,
      accessToken: appAccessToken
    });
  } catch (fallbackError) {
    if (merchantError) {
      throw new Error(`${merchantError.message}; fallback app: ${fallbackError.message}`);
    }
    throw fallbackError;
  }
}

// ── BOOTSTRAP ────────────────────────────────────────────────────────────────
async function startServer() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL,
    persons INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'open',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS table_tokens (
    table_number INTEGER PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    client_request_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_price REAL NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    fulfilled INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS waiter_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL,
    source TEXT DEFAULT 'mesa',
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_date TEXT NOT NULL,
    slot TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    persons INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    source TEXT DEFAULT 'public',
    google_event_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    cancelled_at INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS reservation_day_settings (
    reservation_date TEXT PRIMARY KEY,
    lunch_open INTEGER NOT NULL DEFAULT 1,
    dinner_open INTEGER NOT NULL DEFAULT 1,
    lunch_capacity INTEGER NOT NULL DEFAULT ${DEFAULT_SLOT_CAPACITY},
    dinner_capacity INTEGER NOT NULL DEFAULT ${DEFAULT_SLOT_CAPACITY}
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS paypal_connections (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    merchant_payer_id TEXT,
    merchant_email TEXT,
    merchant_name TEXT,
    access_token_enc TEXT,
    refresh_token_enc TEXT,
    token_expires_at INTEGER,
    scope TEXT,
    status TEXT DEFAULT 'disconnected',
    updated_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // Backward-compatible schema upgrades for waiter calls metadata.
  const waiterCallsColumns = dbAll('PRAGMA table_info(waiter_calls)');
  if (!waiterCallsColumns.some(c => c.name === 'table_token')) {
    db.run('ALTER TABLE waiter_calls ADD COLUMN table_token TEXT');
  }
  if (!waiterCallsColumns.some(c => c.name === 'table_number')) {
    db.run('ALTER TABLE waiter_calls ADD COLUMN table_number INTEGER');
  }

  const reservationColumns = dbAll('PRAGMA table_info(reservations)');
  if (!reservationColumns.some(c => c.name === 'source')) {
    db.run("ALTER TABLE reservations ADD COLUMN source TEXT DEFAULT 'public'");
  }
  if (!reservationColumns.some(c => c.name === 'google_event_id')) {
    db.run('ALTER TABLE reservations ADD COLUMN google_event_id TEXT');
  }
  if (!reservationColumns.some(c => c.name === 'cancelled_at')) {
    db.run('ALTER TABLE reservations ADD COLUMN cancelled_at INTEGER');
  }

  const orderColumns = dbAll('PRAGMA table_info(orders)');
  if (!orderColumns.some(c => c.name === 'client_request_id')) {
    db.run('ALTER TABLE orders ADD COLUMN client_request_id TEXT');
  }

  // Performance indexes for high volume traffic (tables, orders, waiter calls, reservations).
  db.run('CREATE INDEX IF NOT EXISTS idx_tables_status_number ON tables(status, number)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tables_token ON tables(token)');
  db.run('CREATE INDEX IF NOT EXISTS idx_orders_status_table_created ON orders(status, table_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_orders_table_id ON orders(table_id)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_table_request_id ON orders(table_id, client_request_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_waiter_calls_status_table_created ON waiter_calls(status, table_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_waiter_calls_token_status_created ON waiter_calls(table_token, status, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_reservations_date_slot_status ON reservations(reservation_date, slot, status)');

  function getDaySettings(date) {
    const row = dbGet('SELECT * FROM reservation_day_settings WHERE reservation_date = ?', [date]);
    if (!row) {
      return {
        reservation_date: date,
        lunch_open: 1,
        dinner_open: 1,
        lunch_capacity: DEFAULT_SLOT_CAPACITY,
        dinner_capacity: DEFAULT_SLOT_CAPACITY
      };
    }
    return {
      reservation_date: date,
      lunch_open: Number(row.lunch_open) ? 1 : 0,
      dinner_open: Number(row.dinner_open) ? 1 : 0,
      lunch_capacity: Number(row.lunch_capacity) || DEFAULT_SLOT_CAPACITY,
      dinner_capacity: Number(row.dinner_capacity) || DEFAULT_SLOT_CAPACITY
    };
  }

  function saveDaySettings(date, patch = {}) {
    const current = getDaySettings(date);
    const next = {
      reservation_date: date,
      lunch_open: patch.lunch_open ?? current.lunch_open,
      dinner_open: patch.dinner_open ?? current.dinner_open,
      lunch_capacity: patch.lunch_capacity ?? current.lunch_capacity,
      dinner_capacity: patch.dinner_capacity ?? current.dinner_capacity
    };
    dbRun(
      `INSERT INTO reservation_day_settings (reservation_date, lunch_open, dinner_open, lunch_capacity, dinner_capacity)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(reservation_date) DO UPDATE SET
         lunch_open = excluded.lunch_open,
         dinner_open = excluded.dinner_open,
         lunch_capacity = excluded.lunch_capacity,
         dinner_capacity = excluded.dinner_capacity`,
      [date, next.lunch_open, next.dinner_open, next.lunch_capacity, next.dinner_capacity]
    );
    return next;
  }

  function getSlotBookedPersons(date, slot) {
    const row = dbGet(
      'SELECT COALESCE(SUM(persons), 0) as booked FROM reservations WHERE reservation_date = ? AND slot = ? AND status = ?',
      [date, slot, 'active']
    );
    return row ? Number(row.booked) : 0;
  }

  function getSlotActiveReservationCount(date, slot) {
    const row = dbGet(
      'SELECT COUNT(*) as total FROM reservations WHERE reservation_date = ? AND slot = ? AND status = ?',
      [date, slot, 'active']
    );
    return row ? Number(row.total) : 0;
  }

  function getAvailabilityForDate(date) {
    const settings = getDaySettings(date);
    const lunchBookedPersons = getSlotBookedPersons(date, 'lunch');
    const dinnerBookedPersons = getSlotBookedPersons(date, 'dinner');
    const lunchReservations = getSlotActiveReservationCount(date, 'lunch');
    const dinnerReservations = getSlotActiveReservationCount(date, 'dinner');

    return {
      date,
      slots: {
        lunch: {
          key: 'lunch',
          label: RESERVATION_SLOTS.lunch.label,
          hour: RESERVATION_SLOTS.lunch.hour,
          open: !!settings.lunch_open,
          capacity: settings.lunch_capacity,
          booked: lunchReservations,
          bookedPersons: lunchBookedPersons,
          available: Math.max(0, settings.lunch_capacity - lunchReservations)
        },
        dinner: {
          key: 'dinner',
          label: RESERVATION_SLOTS.dinner.label,
          hour: RESERVATION_SLOTS.dinner.hour,
          open: !!settings.dinner_open,
          capacity: settings.dinner_capacity,
          booked: dinnerReservations,
          bookedPersons: dinnerBookedPersons,
          available: Math.max(0, settings.dinner_capacity - dinnerReservations)
        }
      },
      settings
    };
  }

  function validateReservationInput({ reservationDate, slot, name, phone, persons }) {
    if (!reservationDate) return { ok: false, error: 'Fecha inválida' };
    if (!RESERVATION_SLOTS[slot]) return { ok: false, error: 'Turno inválido' };

    const cleanName = String(name || '').trim();
    const cleanPhone = String(phone || '').replace(/\s+/g, '').trim();
    const parsedPersons = Number(persons);

    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,79}$/.test(cleanName)) {
      return { ok: false, error: 'Nombre inválido (2-80 caracteres)' };
    }

    if (!/^\d+$/.test(cleanPhone)) {
      return { ok: false, error: 'Teléfono inválido: solo puede contener números' };
    }

    if (cleanPhone.length !== 9) {
      return { ok: false, error: 'Teléfono inválido: debe tener exactamente 9 dígitos' };
    }

    if (!/^[67]/.test(cleanPhone)) {
      return { ok: false, error: 'Teléfono inválido: debe empezar por 6 o 7' };
    }

    if (!Number.isInteger(parsedPersons) || parsedPersons < 1 || parsedPersons > 30) {
      return { ok: false, error: 'Número de personas inválido (1-30)' };
    }

    return {
      ok: true,
      value: {
        reservationDate,
        slot,
        name: cleanName,
        phone: cleanPhone,
        persons: parsedPersons
      }
    };
  }

  async function createReservation({ reservationDate, slot, name, phone, persons, source }) {
    const availability = getAvailabilityForDate(reservationDate);
    const slotData = availability.slots[slot];
    if (!slotData) return { error: 'Turno no válido', code: 400 };
    if (!slotData.open) return { error: 'Este turno está marcado como ocupado', code: 409 };
    if (slotData.available <= 0) {
      return { error: 'No hay hueco disponible para este turno', code: 409 };
    }

    const info = dbRun(
      'INSERT INTO reservations (reservation_date, slot, name, phone, persons, status, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [reservationDate, slot, name, phone, persons, 'active', source || 'public']
    );
    const reservation = dbGet('SELECT * FROM reservations WHERE id = ?', [info.lastInsertRowid]);
    const googleEventId = await createGoogleCalendarEvent(reservation);
    if (googleEventId) {
      dbRun('UPDATE reservations SET google_event_id = ? WHERE id = ?', [googleEventId, reservation.id]);
      reservation.google_event_id = googleEventId;
    }
    sendReservationNotification(reservation).catch((e) => {
      console.error('No se pudo procesar la notificacion de reserva:', e.message);
    });
    saveDb();
    emitAdminUpdate('reservation_created', { reservationId: reservation.id, date: reservationDate, slot });
    emitReservationUpdate('reservation_created', { reservationId: reservation.id, date: reservationDate, slot });
    return { reservation, availability: getAvailabilityForDate(reservationDate) };
  }

  saveDb();

  initGoogleCalendarIfConfigured();
  initMailTransporterIfConfigured();

  app.use(compression());
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (/\.html?$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return;
      }

      if (/\.(css|js)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return;
      }

      if (/\.(svg|png|jpg|jpeg|webp|gif|ico|woff2?)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    }
  }));

  // ── REALTIME (SSE) ───────────────────────────────────────────────────────
  app.get('/api/admin/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);
    adminSseClients.add(res);

    const heartbeat = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      adminSseClients.delete(res);
    });
  });

  app.get('/api/mesa/events/:token', (req, res) => {
    const { token } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!tableSseClients.has(token)) tableSseClients.set(token, new Set());
    const clients = tableSseClients.get(token);
    clients.add(res);

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, token, ts: Date.now() })}\n\n`);

    const heartbeat = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      const list = tableSseClients.get(token);
      if (!list) return;
      list.delete(res);
      if (list.size === 0) tableSseClients.delete(token);
    });
  });

  app.get('/api/reservations/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);
    reservationsSseClients.add(res);

    const heartbeat = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      reservationsSseClients.delete(res);
    });
  });

  function getAdminDeviceIdFromRequest(req) {
    return String(
      req.headers['x-device-id'] ||
      req.body?.deviceId ||
      req.query?.deviceId ||
      ''
    ).trim();
  }

  function requireAdminDevice(req, res) {
    const deviceId = getAdminDeviceIdFromRequest(req);
    if (!deviceId) {
      res.status(401).json({ error: 'Sesión no válida' });
      return null;
    }

    // New format: uuid.hmacSig — verified without DB (survives restarts)
    if (deviceId.includes('.') && verifyDeviceId(deviceId)) {
      return deviceId;
    }

    // Legacy format: bare UUID stored in devices table
    const device = dbGet('SELECT id FROM devices WHERE id = ?', [deviceId]);
    if (!device) {
      res.status(401).json({ error: 'Sesión no válida' });
      return null;
    }

    return deviceId;
  }

  // ── AUTH ──────────────────────────────────────────────────────────────────
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const adminPassword = String(process.env.ADMIN_PASSWORD || 'admin');
    if (username === 'admin' && password === adminPassword) {
      const id = signDeviceId(uuidv4());
      return res.json({ success: true, deviceId: id });
    }
    res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
  });

  app.post('/api/auth/check', (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) return res.json({ authenticated: false });
    // New signed format
    if (deviceId.includes('.') && verifyDeviceId(deviceId)) {
      return res.json({ authenticated: true });
    }
    // Legacy: check DB
    const device = dbGet('SELECT id FROM devices WHERE id = ?', [deviceId]);
    res.json({ authenticated: !!device });
  });

  app.post('/api/auth/logout', (req, res) => {
    const { deviceId } = req.body;
    // Legacy cleanup
    if (deviceId && !deviceId.includes('.')) {
      dbRun('DELETE FROM devices WHERE id = ?', [deviceId]); saveDb();
    }
    res.json({ success: true });
  });

  // ── PRODUCTS ──────────────────────────────────────────────────────────────
  app.get('/api/products', (req, res) => res.json(PRODUCTS));

  // ── WEBHOOK TEST (diagnóstico) ───────────────────────────────────────────
  app.get('/api/test-webhook', async (req, res) => {
    const webhookUrl = process.env.RESERVATION_WEBHOOK_URL;
    if (!webhookUrl) {
      return res.json({ ok: false, error: 'RESERVATION_WEBHOOK_URL no está configurado en las variables de entorno' });
    }
    const testPayload = {
      targetEmail: RESERVATION_NOTIFICATION_EMAIL,
      reservation: {
        date: '2026-06-20', slot: 'dinner', slotLabel: 'Cena - 21:00',
        name: 'Test desde Render', phone: '612345678', persons: 2,
        source: 'test', createdAt: Math.floor(Date.now() / 1000)
      }
    };
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload)
      });
      const text = await response.text();
      res.json({ ok: response.ok, status: response.status, body: text, webhookUrl });
    } catch (e) {
      res.json({ ok: false, error: e.message, webhookUrl });
    }
  });

  // ── PAYPAL CONNECT + CHECKOUT ────────────────────────────────────────────
  app.get('/api/paypal/config', (req, res) => {
    const connection = getPayPalConnection();
    res.json({
      enabled: isPayPalConfigured() && isPayPalConnected(),
      configured: isPayPalConfigured(),
      connected: isPayPalConnected(),
      clientId: isPayPalConfigured() ? PAYPAL_CLIENT_ID : null,
      currency: PAYPAL_CURRENCY,
      environment: PAYPAL_ENV,
      merchant: connection && connection.status === 'connected'
        ? {
            payerId: connection.merchant_payer_id,
            email: connection.merchant_email,
            name: connection.merchant_name
          }
        : null
    });
  });

  app.post('/api/paypal/connect/status', (req, res) => {
    const deviceId = requireAdminDevice(req, res);
    if (!deviceId) return;

    const connection = getPayPalConnection();
    res.json({
      success: true,
      configured: isPayPalConfigured(),
      canConnect: isPayPalConfigured() && hasTokenEncryptionKey(),
      connected: Boolean(connection && connection.status === 'connected' && connection.access_token_enc),
      merchant: connection && connection.status === 'connected'
        ? {
            payerId: connection.merchant_payer_id,
            email: connection.merchant_email,
            name: connection.merchant_name
          }
        : null
    });
  });

  app.post('/api/paypal/connect/start', (req, res) => {
    const deviceId = requireAdminDevice(req, res);
    if (!deviceId) return;

    if (!isPayPalConfigured()) {
      return res.status(503).json({ error: 'Configura PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET' });
    }
    if (!hasTokenEncryptionKey()) {
      return res.status(503).json({ error: 'Configura PAYPAL_TOKEN_ENCRYPTION_KEY para almacenar tokens de forma segura' });
    }

    const state = createPayPalState(deviceId);
    const authUrl = buildPayPalConnectUrl(req, state);
    res.json({ success: true, authUrl });
  });

  app.get('/api/paypal/connect/callback', async (req, res) => {
    const state = String(req.query.state || '');
    const code = String(req.query.code || '');
    const error = String(req.query.error || '');

    const closeWindow = (ok, message) => {
      const safeMessage = String(message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const payload = JSON.stringify({ source: 'paypal-connect', ok, message: safeMessage });
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PayPal</title></head><body style="font-family:Segoe UI,Arial,sans-serif;padding:1rem;background:#111;color:#eee"><p>${safeMessage}</p><script>try{window.opener&&window.opener.postMessage(${payload},'*')}catch(e){}setTimeout(function(){window.close()},400);</script></body></html>`;
    };

    if (!state) {
      return res.status(400).send(closeWindow(false, 'Estado OAuth inválido'));
    }

    const stateMeta = consumePayPalState(state);
    if (!stateMeta) {
      return res.status(400).send(closeWindow(false, 'Sesión de conexión expirada; vuelve a intentarlo'));
    }

    if (error) {
      return res.status(400).send(closeWindow(false, `Conexión cancelada: ${error}`));
    }

    if (!code) {
      return res.status(400).send(closeWindow(false, 'No se recibió código de autorización'));
    }

    try {
      const redirectUri = buildPayPalRedirectUri(req);
      const tokenData = await exchangePayPalAuthorizationCode(code, redirectUri);
      let profile = {};
      try {
        profile = await fetchPayPalUserInfo(tokenData.access_token);
      } catch (profileError) {
        console.warn('PayPal userinfo no disponible; se guardará conexión sin perfil:', profileError.message);
      }
      const now = Math.floor(Date.now() / 1000);

      savePayPalConnection({
        merchant_payer_id: profile.payer_id || null,
        merchant_email: profile.email || null,
        merchant_name: profile.name || profile.given_name || 'Cuenta PayPal',
        access_token_enc: encryptSecret(tokenData.access_token),
        refresh_token_enc: tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : null,
        token_expires_at: now + Number(tokenData.expires_in || 300),
        scope: tokenData.scope || null,
        status: 'connected'
      });
      saveDb();

      return res.send(closeWindow(true, 'Cuenta PayPal conectada correctamente'));
    } catch (e) {
      return res.status(500).send(closeWindow(false, `No se pudo completar la conexión: ${e.message}`));
    }
  });

  app.post('/api/paypal/connect/disconnect', (req, res) => {
    const deviceId = requireAdminDevice(req, res);
    if (!deviceId) return;

    disconnectPayPalConnection();
    saveDb();
    res.json({ success: true, connected: false });
  });

  app.post('/api/paypal/orders/create', async (req, res) => {
    if (!isPayPalConfigured()) {
      return res.status(503).json({ error: 'PayPal no está configurado en el servidor' });
    }

    const { tableToken } = req.body || {};
    if (!tableToken) return res.status(400).json({ error: 'Falta token de mesa' });

    const table = dbGet('SELECT * FROM tables WHERE token = ? AND status = ?', [tableToken, 'open']);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada o cerrada' });

    const bill = getTableBillData(table.id);
    if (!bill || Number(bill.total) <= 0) {
      return res.status(400).json({ error: 'No hay importe para cobrar en esta mesa' });
    }

    try {
      const order = await paypalApiRequestWithTokenFallback('/v2/checkout/orders', {
        method: 'POST',
        requestId: `table-${table.id}-${Date.now()}`,
        body: {
          intent: 'CAPTURE',
          purchase_units: [{
            custom_id: `table:${table.id}`,
            amount: {
              currency_code: PAYPAL_CURRENCY,
              value: toMoney(bill.total)
            }
          }],
          application_context: {
            shipping_preference: 'NO_SHIPPING'
          }
        }
      });

      return res.json({ success: true, orderId: order.id });
    } catch (error) {
      return res.status(502).json({ error: error.message || 'No se pudo crear la orden PayPal' });
    }
  });

  app.post('/api/paypal/orders/:orderId/capture', async (req, res) => {
    if (!isPayPalConfigured()) {
      return res.status(503).json({ error: 'PayPal no está configurado en el servidor' });
    }

    const { tableToken } = req.body || {};
    const { orderId } = req.params;
    if (!tableToken) return res.status(400).json({ error: 'Falta token de mesa' });
    if (!orderId) return res.status(400).json({ error: 'Falta orderId de PayPal' });

    const table = dbGet('SELECT * FROM tables WHERE token = ? AND status IN (?, ?)', [tableToken, 'open', 'paid']);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (table.status === 'paid') return res.json({ success: true, alreadyPaid: true });

    const bill = getTableBillData(table.id);
    if (!bill || Number(bill.total) <= 0) {
      return res.status(400).json({ error: 'No hay importe para cobrar en esta mesa' });
    }

    try {
      const capture = await paypalApiRequestWithTokenFallback(`/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        requestId: `capture-${table.id}-${orderId}`,
        body: {}
      });

      const purchaseUnit = capture?.purchase_units?.[0];
      const captureInfo = purchaseUnit?.payments?.captures?.[0];
      const paidAmount = captureInfo?.amount?.value;
      const paidCurrency = captureInfo?.amount?.currency_code;
      const isCompleted = String(captureInfo?.status || '').toUpperCase() === 'COMPLETED';

      if (!isCompleted) {
        return res.status(409).json({ error: 'El pago PayPal no se completó correctamente' });
      }

      if (paidCurrency !== PAYPAL_CURRENCY || Number(paidAmount) !== Number(toMoney(bill.total))) {
        return res.status(409).json({ error: 'El importe capturado no coincide con la cuenta de la mesa' });
      }

      // Remove all previous pending waiter calls for this table so only the payment notification remains.
      dbRun('DELETE FROM waiter_calls WHERE table_id = ? AND status = ?', [table.id, 'pending']);
      dbRun('DELETE FROM waiter_calls WHERE table_token = ? AND status = ?', [tableToken, 'pending']);

      // Mark table as paid
      markTableAsPaid(table.id);

      // Create waiter call for payment notification
      const callInfo = dbRun(
        'INSERT INTO waiter_calls (table_id, source, status, table_token, table_number) VALUES (?, ?, ?, ?, ?)',
        [table.id, 'paypal', 'pending', tableToken, table.number]
      );
      saveDb();
      emitAdminUpdate('waiter_call_created', { callId: callInfo.lastInsertRowid });

      return res.json({ success: true, captureId: captureInfo.id, amount: paidAmount, currency: paidCurrency });
    } catch (error) {
      return res.status(502).json({ error: error.message || 'No se pudo capturar el pago PayPal' });
    }
  });

  // ── RESERVATIONS (PUBLIC) ────────────────────────────────────────────────
  app.get('/api/reservations/config', (req, res) => {
    res.json({
      timezone: RESERVATION_TIMEZONE,
      slots: {
        lunch: RESERVATION_SLOTS.lunch,
        dinner: RESERVATION_SLOTS.dinner
      },
      googleCalendarSync: googleCalendarEnabled
    });
  });

  app.get('/api/reservations/availability', (req, res) => {
    const date = normalizeDate(req.query.date);
    if (!date) return res.status(400).json({ error: 'Fecha inválida (usa YYYY-MM-DD)' });
    res.json(getAvailabilityForDate(date));
  });

  app.post('/api/reservations', async (req, res) => {
    const reservationDate = normalizeDate(req.body.date);
    const validation = validateReservationInput({
      reservationDate,
      slot: req.body.slot,
      name: req.body.name,
      phone: req.body.phone,
      persons: req.body.persons
    });
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const result = await createReservation({ ...validation.value, source: 'public' });
    if (result.error) return res.status(result.code || 400).json({ error: result.error });
    res.json({ success: true, reservation: result.reservation, availability: result.availability });
  });

  // ── RESERVATIONS (ADMIN) ─────────────────────────────────────────────────
  app.get('/api/admin/reservations/month', (req, res) => {
    const range = getDateRangeForMonth(String(req.query.month || ''));
    if (!range) return res.status(400).json({ error: 'Mes inválido (usa YYYY-MM)' });

    const rows = dbAll(
      `SELECT reservation_date, slot, COUNT(*) as booked
       FROM reservations
       WHERE status = 'active' AND reservation_date BETWEEN ? AND ?
       GROUP BY reservation_date, slot`,
      [range.start, range.end]
    );

    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.reservation_date)) {
        map.set(row.reservation_date, { lunchBooked: 0, dinnerBooked: 0 });
      }
      const day = map.get(row.reservation_date);
      if (row.slot === 'lunch') day.lunchBooked = Number(row.booked);
      if (row.slot === 'dinner') day.dinnerBooked = Number(row.booked);
    });

    const result = [];
    let current = new Date(`${range.start}T00:00:00`);
    const end = new Date(`${range.end}T00:00:00`);
    while (current <= end) {
      const date = toIsoDate(current);
      const settings = getDaySettings(date);
      const booked = map.get(date) || { lunchBooked: 0, dinnerBooked: 0 };
      result.push({
        date,
        lunch_open: !!settings.lunch_open,
        dinner_open: !!settings.dinner_open,
        lunch_capacity: settings.lunch_capacity,
        dinner_capacity: settings.dinner_capacity,
        lunch_booked: booked.lunchBooked,
        dinner_booked: booked.dinnerBooked,
        lunch_available: Math.max(0, settings.lunch_capacity - booked.lunchBooked),
        dinner_available: Math.max(0, settings.dinner_capacity - booked.dinnerBooked)
      });
      current.setDate(current.getDate() + 1);
    }

    res.json(result);
  });

  app.get('/api/admin/reservations/day', (req, res) => {
    const date = normalizeDate(req.query.date);
    if (!date) return res.status(400).json({ error: 'Fecha inválida (usa YYYY-MM-DD)' });

    const reservations = dbAll(
      `SELECT id, reservation_date, slot, name, phone, persons, status, source, created_at
       FROM reservations
       WHERE reservation_date = ? AND status = 'active'
       ORDER BY slot ASC, created_at ASC`,
      [date]
    );

    res.json({
      date,
      settings: getDaySettings(date),
      availability: getAvailabilityForDate(date),
      reservations
    });
  });

  app.patch('/api/admin/reservations/day', (req, res) => {
    const date = normalizeDate(req.body.date);
    if (!date) return res.status(400).json({ error: 'Fecha inválida' });

    const slot = req.body.slot;
    if (!RESERVATION_SLOTS[slot]) return res.status(400).json({ error: 'Turno inválido' });

    const patch = {};
    if (typeof req.body.open === 'boolean') {
      patch[`${slot}_open`] = req.body.open ? 1 : 0;
    }

    if (Number.isFinite(Number(req.body.capacity))) {
      patch[`${slot}_capacity`] = Math.max(1, Number(req.body.capacity));
    }

    if (Number.isFinite(Number(req.body.capacityDelta))) {
      const current = getDaySettings(date);
      const key = `${slot}_capacity`;
      patch[key] = Math.max(1, Number(current[key]) + Number(req.body.capacityDelta));
    }

    const updated = saveDaySettings(date, patch);
    saveDb();
    emitAdminUpdate('reservation_day_settings_updated', { date, slot });
    emitReservationUpdate('reservation_day_settings_updated', { date, slot });
    res.json({ success: true, settings: updated, availability: getAvailabilityForDate(date) });
  });

  app.post('/api/admin/reservations', async (req, res) => {
    const reservationDate = normalizeDate(req.body.date);
    const validation = validateReservationInput({
      reservationDate,
      slot: req.body.slot,
      name: req.body.name,
      phone: req.body.phone,
      persons: req.body.persons
    });
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const result = await createReservation({ ...validation.value, source: 'admin' });
    if (result.error) return res.status(result.code || 400).json({ error: result.error });
    res.json({ success: true, reservation: result.reservation, availability: result.availability });
  });

  app.patch('/api/admin/reservations/:id/cancel', async (req, res) => {
    const reservation = dbGet('SELECT * FROM reservations WHERE id = ?', [req.params.id]);
    if (!reservation) return res.status(404).json({ error: 'Reserva no encontrada' });

    dbRun('DELETE FROM reservations WHERE id = ?', [req.params.id]);
    await deleteGoogleCalendarEvent(reservation.google_event_id);
    saveDb();
    emitAdminUpdate('reservation_deleted', { reservationId: reservation.id, date: reservation.reservation_date, slot: reservation.slot });
    emitReservationUpdate('reservation_deleted', { reservationId: reservation.id, date: reservation.reservation_date, slot: reservation.slot });

    res.json({
      success: true,
      deletedReservationId: reservation.id,
      availability: getAvailabilityForDate(reservation.reservation_date)
    });
  });

  // ── TABLES ────────────────────────────────────────────────────────────────
  app.get('/api/tables', (req, res) => {
    const rows = dbAll(`
      SELECT
        t.id,
        t.number,
        t.persons,
        t.token,
        t.status,
        t.created_at,
        COALESCE(SUM(oi.product_price * oi.quantity), 0) as total
      FROM tables t
      LEFT JOIN orders o ON o.table_id = t.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      GROUP BY t.id
      ORDER BY t.number ASC
    `);
    res.json(rows);
  });

  app.post('/api/tables', (req, res) => {
    const { number, persons } = req.body;
    if (!number || !persons) return res.status(400).json({ error: 'Faltan campos' });

    const existing = dbGet('SELECT id FROM tables WHERE number = ? AND status = ?', [number, 'open']);
    if (existing) return res.status(409).json({ error: 'Mesa ya existe y está abierta' });

    // Reuse the same QR token for the same table number.
    let persistedToken = dbGet('SELECT token FROM table_tokens WHERE table_number = ?', [number]);
    if (!persistedToken) {
      const generatedToken = uuidv4();
      dbRun('INSERT INTO table_tokens (table_number, token) VALUES (?, ?)', [number, generatedToken]);
      persistedToken = { token: generatedToken };
    }

    const reusableTable = dbGet('SELECT * FROM tables WHERE number = ? ORDER BY id DESC LIMIT 1', [number]);

    if (reusableTable) {
      // Reset previous session data for this table and reopen with the same token.
      dbRun('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE table_id = ?)', [reusableTable.id]);
      dbRun('DELETE FROM orders WHERE table_id = ?', [reusableTable.id]);
      dbRun('DELETE FROM waiter_calls WHERE table_id = ?', [reusableTable.id]);
      dbRun(
        'UPDATE tables SET persons = ?, token = ?, status = ?, created_at = (strftime(\'%s\',\'now\')) WHERE id = ?',
        [persons, persistedToken.token, 'open', reusableTable.id]
      );
      saveDb();
      emitAdminUpdate('table_created');
      emitTableUpdateByToken(persistedToken.token, 'table_reopened', { tableNumber: number });
      return res.json(dbGet('SELECT * FROM tables WHERE id = ?', [reusableTable.id]));
    }

    const info = dbRun('INSERT INTO tables (number, persons, token, status) VALUES (?, ?, ?, ?)', [
      number,
      persons,
      persistedToken.token,
      'open'
    ]);
    saveDb();
    emitAdminUpdate('table_created');
    emitTableUpdateByToken(persistedToken.token, 'table_created', { tableNumber: number });
    res.json(dbGet('SELECT * FROM tables WHERE id = ?', [info.lastInsertRowid]));
  });

  // Deletes only the orders for a table (keeps the table row intact).
  app.delete('/api/tables/:id/orders', (req, res) => {
    const table = dbGet('SELECT id FROM tables WHERE id = ?', [req.params.id]);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    dbRun('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE table_id = ?)', [req.params.id]);
    dbRun('DELETE FROM orders WHERE table_id = ?', [req.params.id]);
    saveDb();
    emitAdminUpdate('order_completed');
    res.json({ success: true });
  });

  app.delete('/api/tables/:id', (req, res) => {
    const table = dbGet('SELECT token, number, status FROM tables WHERE id = ?', [req.params.id]);
    dbRun('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE table_id = ?)', [req.params.id]);
    dbRun('DELETE FROM orders WHERE table_id = ?', [req.params.id]);
    dbRun('UPDATE waiter_calls SET status = ? WHERE table_id = ? AND status = ?', ['resolved', req.params.id, 'pending']);
    if (table?.token) {
      dbRun('UPDATE waiter_calls SET status = ? WHERE table_token = ? AND status = ?', ['resolved', table.token, 'pending']);
    }
    dbRun('DELETE FROM tables WHERE id = ?', [req.params.id]);
    saveDb();
    emitAdminUpdate('table_deleted');
    emitAdminUpdate('waiter_call_resolved');
    // If table was already paid, customer pages are already in finalized state; avoid duplicate close notification.
    if (table && table.status !== 'paid') {
      emitTableUpdateByToken(table.token, 'table_finalized', { tableNumber: table.number });
    }
    res.json({ success: true });
  });

  app.get('/api/table/by-token/:token', (req, res) => {
    const { token } = req.params;
    let table = dbGet('SELECT * FROM tables WHERE token = ?', [token]);

    // Fallback: allow numeric table URLs like /mesa/12 before token QR exists.
    if (!table && /^\d+$/.test(token)) {
      table = dbGet(
        'SELECT * FROM tables WHERE number = ? AND status IN (?, ?) ORDER BY id DESC LIMIT 1',
        [Number(token), 'open', 'paid']
      );
    }

    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    res.json(table);
  });

  app.get('/api/tables/:id/bill', (req, res) => {
    const bill = getTableBillData(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Mesa no encontrada' });
    res.json(bill);
  });

  app.patch('/api/tables/:tableId/items/:productId', (req, res) => {
    const { delta } = req.body;
    const { tableId, productId } = req.params;
    const item = dbGet(`
      SELECT oi.* FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.table_id = ? AND oi.product_id = ?
      ORDER BY oi.id DESC LIMIT 1
    `, [tableId, productId]);
    if (!item) return res.status(404).json({ error: 'Producto no encontrado' });
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      dbRun('DELETE FROM order_items WHERE id = ?', [item.id]);
      // Auto-delete the order if it has no items left
      const remaining = dbGet('SELECT COUNT(*) as c FROM order_items WHERE order_id = ?', [item.order_id]);
      if (remaining && remaining.c === 0) {
        dbRun('DELETE FROM orders WHERE id = ?', [item.order_id]);
      }
    } else {
      dbRun('UPDATE order_items SET quantity = ? WHERE id = ?', [newQty, item.id]);
    }
    saveDb();
    const tableForBill = dbGet('SELECT id, token FROM tables WHERE id = ?', [tableId]);
    emitAdminUpdate('bill_item_updated', { tableId: Number(tableId) });
    if (tableForBill) emitBillUpdated(tableForBill.id, tableForBill.token);
    res.json({ success: true });
  });

  app.patch('/api/tables/:id/mark-paid', (req, res) => {
    const table = markTableAsPaid(req.params.id);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    res.json({ success: true });
  });

  app.post('/api/payments/cash/confirm', (req, res) => {
    const { tableToken } = req.body || {};
    if (!tableToken) return res.status(400).json({ error: 'Falta token de mesa' });

    const table = dbGet('SELECT * FROM tables WHERE token = ? AND status IN (?, ?)', [tableToken, 'open', 'paid']);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });

    const bill = getTableBillData(table.id);
    if (!bill || Number(bill.total) <= 0) {
      return res.status(400).json({ error: 'No hay importe para cobrar en esta mesa' });
    }

    // Remove all previous pending waiter calls for this table so only the payment notification remains.
    dbRun('DELETE FROM waiter_calls WHERE table_id = ? AND status = ?', [table.id, 'pending']);
    if (table.token) {
      dbRun('DELETE FROM waiter_calls WHERE table_token = ? AND status = ?', [table.token, 'pending']);
    }

    const info = dbRun(
      'INSERT INTO waiter_calls (table_id, source, status, table_token, table_number) VALUES (?, ?, ?, ?, ?)',
      [table.id, 'pagar', 'pending', tableToken, table.number]
    );
    const callId = info.lastInsertRowid;

    if (table.status !== 'paid') {
      markTableAsPaid(table.id);
    } else {
      saveDb();
    }

    emitAdminUpdate('waiter_call_created', { callId });
    return res.json({ success: true, callId });
  });

  // ── ORDERS ────────────────────────────────────────────────────────────────
  app.get('/api/orders/pending', (req, res) => {
    const rows = dbAll(`
      SELECT
        o.id as order_id,
        o.table_id,
        t.number as table_number,
        o.created_at,
        oi.id as item_id,
        oi.product_id,
        oi.product_name,
        oi.product_price,
        oi.quantity,
        oi.fulfilled
      FROM orders o
      JOIN tables t ON t.id = o.table_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE (o.status = 'pending' AND t.status = 'open')
         OR t.status = 'paid'
      ORDER BY o.created_at ASC, oi.id ASC
    `);

    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.order_id)) {
        map.set(row.order_id, {
          id: row.order_id,
          table_id: row.table_id,
          table_number: row.table_number,
          created_at: row.created_at,
          items: []
        });
      }

      if (row.item_id != null) {
        map.get(row.order_id).items.push({
          id: row.item_id,
          product_id: row.product_id,
          product_name: row.product_name,
          product_price: row.product_price,
          quantity: row.quantity,
          fulfilled: row.fulfilled
        });
      }
    });

    res.json(Array.from(map.values()));
  });

  app.post('/api/orders', (req, res) => {
    const { tableToken, items, clientRequestId } = req.body;
    const table = dbGet('SELECT * FROM tables WHERE token = ? AND status = ?', [tableToken, 'open']);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada o cerrada' });
    if (!items || items.length === 0) return res.status(400).json({ error: 'Pedido vacío' });
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Formato de pedido inválido' });
    if (items.length > 120) return res.status(400).json({ error: 'Demasiados productos en un solo pedido' });

    const sanitizedItems = [];
    for (const rawItem of items) {
      const productId = String(rawItem?.productId || '').trim();
      const productName = String(rawItem?.productName || '').trim();
      const productPrice = Number(rawItem?.productPrice);
      const quantity = Number(rawItem?.quantity);

      if (!productId || !productName) {
        return res.status(400).json({ error: 'Producto inválido en el pedido' });
      }
      if (!Number.isFinite(productPrice) || productPrice < 0) {
        return res.status(400).json({ error: 'Precio inválido en el pedido' });
      }
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100) {
        return res.status(400).json({ error: 'Cantidad inválida en el pedido' });
      }

      sanitizedItems.push({
        productId,
        productName,
        productPrice,
        quantity
      });
    }

    const normalizedRequestId = typeof clientRequestId === 'string' ? clientRequestId.trim() : '';
    if (normalizedRequestId) {
      const existingOrder = dbGet(
        'SELECT id FROM orders WHERE table_id = ? AND client_request_id = ? LIMIT 1',
        [table.id, normalizedRequestId]
      );
      if (existingOrder) {
        return res.json({ success: true, orderId: existingOrder.id, duplicate: true });
      }
    }

    try {
      db.run('BEGIN');
      const orderInfo = dbRun(
        'INSERT INTO orders (table_id, status, client_request_id) VALUES (?, ?, ?)',
        [table.id, 'pending', normalizedRequestId || null]
      );
      const orderId = orderInfo.lastInsertRowid;
      for (const item of sanitizedItems) {
        dbRun('INSERT INTO order_items (order_id, product_id, product_name, product_price, quantity) VALUES (?, ?, ?, ?, ?)',
          [orderId, item.productId, item.productName, item.productPrice, item.quantity]);
      }
      db.run('COMMIT');

      saveDb();
      emitAdminUpdate('order_created', { orderId, tableId: table.id });
      emitBillUpdated(table.id, table.token);
      return res.json({ success: true, orderId });
    } catch (error) {
      try { db.run('ROLLBACK'); } catch (_) {}
      if (normalizedRequestId && String(error?.message || '').includes('UNIQUE constraint failed: orders.table_id, orders.client_request_id')) {
        const existingOrder = dbGet(
          'SELECT id FROM orders WHERE table_id = ? AND client_request_id = ? LIMIT 1',
          [table.id, normalizedRequestId]
        );
        if (existingOrder) {
          return res.json({ success: true, orderId: existingOrder.id, duplicate: true });
        }
      }
      return res.status(500).json({ error: 'No se pudo registrar el pedido' });
    }
  });

  app.patch('/api/order-items/:id/fulfill', (req, res) => {
    const item = dbGet('SELECT order_id FROM order_items WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    dbRun('UPDATE order_items SET fulfilled = 1 WHERE id = ?', [req.params.id]);
    const pending = dbGet('SELECT COUNT(*) as c FROM order_items WHERE order_id = ? AND fulfilled = 0', [item.order_id]);
    if (pending && pending.c === 0) dbRun('UPDATE orders SET status = ? WHERE id = ?', ['fulfilled', item.order_id]);
    saveDb();
    emitAdminUpdate('order_item_fulfilled');
    res.json({ success: true });
  });

  app.patch('/api/orders/:id/complete', (req, res) => {
    const orderRow = dbGet('SELECT table_id FROM orders WHERE id = ?', [req.params.id]);
    dbRun('UPDATE orders SET status = ? WHERE id = ?', ['fulfilled', req.params.id]);
    saveDb();
    emitAdminUpdate('order_completed');
    if (orderRow) {
      const tableForOrder = dbGet('SELECT id, token FROM tables WHERE id = ?', [orderRow.table_id]);
      if (tableForOrder) emitBillUpdated(tableForOrder.id, tableForOrder.token);
    }
    res.json({ success: true });
  });

  // ── WAITER CALLS ─────────────────────────────────────────────────────────
  app.post('/api/waiter-calls', (req, res) => {
    const { tableToken, source } = req.body;
    if (!tableToken) return res.status(400).json({ error: 'Falta token de mesa' });

    const sourceValue = String(source || '').trim().toLowerCase();
    const isPaymentSource = sourceValue === 'pagar' || sourceValue === 'paypal';
    const finalizedSources = [
      'mesa_finalizada',
      'mesa_finalizado',
      'pedido_finalizado',
      'pagar_finalizado',
      'pedido_finalizada',
      'pagar_finalizada',
      'mesa_cerrada'
    ];
    const isFinalizedSource = finalizedSources.includes(sourceValue) || sourceValue.includes('finalizad');

    const paidTable = dbGet('SELECT id, number FROM tables WHERE token = ? AND status = ?', [tableToken, 'paid']);

    // Any waiter request coming from a paid table must be independent from payment calls.
    if (paidTable && !isPaymentSource) {
      const existingPaidNotice = dbGet(
        "SELECT id FROM waiter_calls WHERE table_token = ? AND status = ? AND source IN (?, ?, ?, ?, ?, ?, ?) ORDER BY id DESC LIMIT 1",
        [tableToken, 'pending', ...finalizedSources]
      );
      if (existingPaidNotice) {
        dbRun(
          "UPDATE waiter_calls SET created_at = strftime('%s','now') WHERE id = ?",
          [existingPaidNotice.id]
        );
        saveDb();
        emitAdminUpdate('waiter_call_created', { callId: existingPaidNotice.id, paidClosedNotice: true });
        return res.json({ success: true, callId: existingPaidNotice.id, paidClosedNotice: true, alreadyPending: true });
      }

      const paidNoticeInfo = dbRun(
        'INSERT INTO waiter_calls (table_id, source, status, table_token, table_number) VALUES (?, ?, ?, ?, ?)',
        [-1, sourceValue || 'mesa_cerrada', 'pending', tableToken, paidTable.number]
      );
      saveDb();
      emitAdminUpdate('waiter_call_created', { callId: paidNoticeInfo.lastInsertRowid, paidClosedNotice: true });
      return res.json({ success: true, callId: paidNoticeInfo.lastInsertRowid, paidClosedNotice: true });
    }

    // Dedicated path: calls from paid/finalized customer views must never overwrite
    // payment calls. They are treated as an independent pending notice.
    if (isFinalizedSource) {
      const existingFinalized = dbGet(
        "SELECT id FROM waiter_calls WHERE table_token = ? AND status = ? AND (source IN (?, ?, ?, ?, ?, ?, ?) OR source LIKE '%finalizad%') ORDER BY id DESC LIMIT 1",
        [tableToken, 'pending', ...finalizedSources]
      );
      if (existingFinalized) {
        return res.json({ success: true, callId: existingFinalized.id, alreadyFinalizedNotice: true });
      }

      const anyTable = dbGet('SELECT id, number FROM tables WHERE token = ? ORDER BY id DESC LIMIT 1', [tableToken]);
      const knownToken = anyTable ? null : dbGet('SELECT table_number FROM table_tokens WHERE token = ?', [tableToken]);
      if (!anyTable && !knownToken) return res.status(404).json({ error: 'Mesa no encontrada' });

      const info = dbRun(
        'INSERT INTO waiter_calls (table_id, source, status, table_token, table_number) VALUES (?, ?, ?, ?, ?)',
        [-1, sourceValue || 'mesa_finalizada', 'pending', tableToken, anyTable ? anyTable.number : knownToken.table_number]
      );
      saveDb();
      emitAdminUpdate('waiter_call_created', { callId: info.lastInsertRowid, finalizedNotice: true });
      return res.json({ success: true, callId: info.lastInsertRowid, finalizedNotice: true });
    }

    const table = dbGet('SELECT * FROM tables WHERE token = ? AND status = ?', [tableToken, 'open']);

    let existing;
    let info;

    if (table) {
      if (!isFinalizedSource) {
        existing = dbGet(
          'SELECT id FROM waiter_calls WHERE table_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
          [table.id, 'pending']
        );
        if (existing) {
          dbRun(
            "UPDATE waiter_calls SET created_at = strftime('%s','now'), source = COALESCE(?, source) WHERE id = ?",
            [sourceValue || null, existing.id]
          );
          saveDb();
          emitAdminUpdate('waiter_call_created', { callId: existing.id, alreadyPending: true });
          return res.json({ success: true, callId: existing.id, alreadyPending: true });
        }
      }

      info = dbRun(
        'INSERT INTO waiter_calls (table_id, source, status, table_token, table_number) VALUES (?, ?, ?, ?, ?)',
        [table.id, sourceValue || 'mesa', 'pending', tableToken, table.number]
      );
    } else {
      const knownToken = dbGet('SELECT table_number FROM table_tokens WHERE token = ?', [tableToken]);
      if (!knownToken) return res.status(404).json({ error: 'Mesa no encontrada' });

      if (!isFinalizedSource) {
        existing = dbGet(
          'SELECT id FROM waiter_calls WHERE table_token = ? AND status = ? ORDER BY id DESC LIMIT 1',
          [tableToken, 'pending']
        );
        if (existing) {
          dbRun(
            "UPDATE waiter_calls SET created_at = strftime('%s','now'), source = COALESCE(?, source) WHERE id = ?",
            [sourceValue || null, existing.id]
          );
          saveDb();
          emitAdminUpdate('waiter_call_created', { callId: existing.id, alreadyPending: true });
          return res.json({ success: true, callId: existing.id, alreadyPending: true });
        }
      }

      if (isFinalizedSource) {
        info = dbRun(
          'INSERT INTO waiter_calls (table_id, source, status, table_token, table_number) VALUES (?, ?, ?, ?, ?)',
          [-1, sourceValue || 'mesa_finalizada', 'pending', tableToken, knownToken.table_number]
        );
      } else {
        info = dbRun(
          'INSERT INTO waiter_calls (table_id, source, status, table_token, table_number) VALUES (?, ?, ?, ?, ?)',
          [-1, sourceValue || 'mesa_no_autorizada', 'pending', tableToken, knownToken.table_number]
        );
      }
    }

    saveDb();
    emitAdminUpdate('waiter_call_created', { callId: info.lastInsertRowid });
    res.json({ success: true, callId: info.lastInsertRowid });
  });

  app.get('/api/waiter-calls/pending', (req, res) => {
    const calls = dbAll(`
      SELECT wc.id, wc.table_id, wc.table_token, wc.source, wc.status, wc.created_at,
             COALESCE(t.number, wc.table_number) as table_number,
             COALESCE(bt.total, 0) as table_total
      FROM waiter_calls wc
      LEFT JOIN tables t ON t.id = wc.table_id
      LEFT JOIN (
        SELECT o.table_id, COALESCE(SUM(oi.product_price * oi.quantity), 0) as total
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        GROUP BY o.table_id
      ) bt ON bt.table_id = wc.table_id
      WHERE wc.status = 'pending'
        AND (
          t.id IS NULL
          OR t.status = 'open'
          OR t.status = 'paid'
          OR wc.source IN ('pagar', 'paypal', 'mesa_finalizada', 'mesa_finalizado', 'mesa_cerrada', 'pedido_finalizada', 'pagar_finalizada', 'pedido_finalizado', 'pagar_finalizado')
        )
      ORDER BY wc.created_at ASC
    `);
    res.json(calls);
  });

  app.patch('/api/waiter-calls/:id/resolve', (req, res) => {
    dbRun('UPDATE waiter_calls SET status = ? WHERE id = ?', ['resolved', req.params.id]);
    saveDb();
    emitAdminUpdate('waiter_call_resolved');
    res.json({ success: true });
  });

  // ── QR CODE ───────────────────────────────────────────────────────────────
  app.get('/api/tables/:id/qr', async (req, res) => {
    const table = dbGet('SELECT * FROM tables WHERE id = ?', [req.params.id]);
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    const baseUrl = getTableBaseUrl(req);
    const url = `${baseUrl}/mesa/${table.token}`;
    try {
      const qr = await QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } });
      res.json({ qr, url });
    } catch (e) {
      res.status(500).json({ error: 'Error generando QR' });
    }
  });

  // ── SPA ROUTES ────────────────────────────────────────────────────────────
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
  app.get('/admin/reservas', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-reservas.html')));
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
  app.get('/reservas', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reservas.html')));
  app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
  app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
  app.get('/mesa/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mesa.html')));
  app.get('/mesa/:token/pedido', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pedido.html')));
  app.get('/mesa/:token/pagar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pagar.html')));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  app.listen(PORT, () => {
    const lanIp = getFirstLanIPv4();
    console.log(`\n🍽️  Restaurant App corriendo en http://localhost:${PORT}`);
    if (lanIp) {
      console.log(`   Red local: http://${lanIp}:${PORT}`);
    }
    console.log(`   Panel admin: http://localhost:${PORT}/admin`);
    console.log(`   Usuario: admin  |  Contraseña: admin\n`);

    if (!isPayPalConfigured()) {
      console.warn('   [PayPal] Faltan PAYPAL_CLIENT_ID y/o PAYPAL_CLIENT_SECRET en .env');
    } else {
      console.log(`   [PayPal] Entorno: ${PAYPAL_ENV.toUpperCase()} | Moneda: ${PAYPAL_CURRENCY}`);
      console.log(`   [PayPal] OAuth callback esperado: http://localhost:${PORT}${PAYPAL_CONNECT_REDIRECT_PATH}`);
      if (lanIp) {
        console.log(`   [PayPal] OAuth callback red local: http://${lanIp}:${PORT}${PAYPAL_CONNECT_REDIRECT_PATH}`);
      }
    }

    if (!hasTokenEncryptionKey()) {
      console.warn('   [PayPal] Falta PAYPAL_TOKEN_ENCRYPTION_KEY para conectar cuentas PayPal de forma segura');
    }
  });
}

startServer().catch(console.error);

// Keep-alive ping so Render free tier doesn't spin down (every 14 min)
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    fetch(`${process.env.RENDER_EXTERNAL_URL}/api/products`)
      .catch(() => {});
  }, 14 * 60 * 1000);
}
