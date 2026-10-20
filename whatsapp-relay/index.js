#!/usr/bin/env node
/* =============================================================
 * GlitchX WhatsApp receipt relay
 *
 * Runs on the shop PC (keep it running whenever the cafe is open).
 *   1. Links YOUR WhatsApp via a QR shown in Admin → WhatsApp
 *      (multi-device — your phone stays the primary device).
 *   2. Drains the invoice queue in the app and sends each invoice
 *      as a PDF document to the customer's number.
 *
 * Queued messages live in the database: after a power cut or crash
 * nothing is lost — they go out once this relay is back online.
 *
 *   cp .env.example .env   (fill in APP_URL + RELAY_TOKEN)
 *   npm install
 *   npm start
 * ============================================================= */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } =
  require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const RELAY_TOKEN = process.env.RELAY_TOKEN || '';
const COUNTRY_CODE = process.env.COUNTRY_CODE || '91';
const SESSION_DIR = path.join(__dirname, 'session');

let sock = null;
let connected = false;
let phone = null;
let currentQr = null;
let lastError = null;
let sending = false;

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

/* ---------- app API ---------- */

async function pushState() {
  if (!RELAY_TOKEN) return;
  try {
    await fetch(`${APP_URL}/api/relay/whatsapp/state`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RELAY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connected, phone, qr: currentQr, last_error: lastError }),
    });
  } catch (e) {
    log('heartbeat failed (app unreachable?)', e.message);
  }
}

async function getQueue() {
  const r = await fetch(`${APP_URL}/api/relay/whatsapp/queue`, {
    headers: { Authorization: `Bearer ${RELAY_TOKEN}` },
  });
  if (!r.ok) throw new Error(`queue HTTP ${r.status}`);
  return r.json();
}

async function report(id, ok, extra = {}) {
  try {
    await fetch(`${APP_URL}/api/relay/whatsapp/report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RELAY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ok, ...extra }),
    });
  } catch (e) {
    log('report failed', e.message);
  }
}

/* ---------- WhatsApp ---------- */

function toJid(mobile) {
  let d = String(mobile || '').replace(/\D/g, '');
  if (d.length === 10) d = `${COUNTRY_CODE}${d}`;
  else if (d.startsWith('0')) d = `${COUNTRY_CODE}${d.replace(/^0+/, '')}`;
  return `${d}@s.whatsapp.net`;
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      currentQr = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
      log('scan the QR in Admin → WhatsApp (WhatsApp → Linked Devices)');
      await pushState();
    }
    if (connection === 'open') {
      connected = true;
      currentQr = null;
      phone = (sock.user?.id || '').split(':')[0] || null;
      lastError = null;
      log('WhatsApp linked ✓', phone ? `(${phone})` : '');
      await pushState();
    }
    if (connection === 'close') {
      connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      lastError = code === DisconnectReason.loggedOut ? 'Logged out — scan the QR again' : 'Connection lost — reconnecting…';
      log('connection closed', lastError, `(code ${code})`);
      await pushState();
      if (code === DisconnectReason.loggedOut) {
        try {
          fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        } catch {}
      }
      setTimeout(startWhatsApp, 4000);
    }
  });
}

/* ---------- queue drain ---------- */

async function pollQueue() {
  if (sending || !RELAY_TOKEN) return;
  sending = true;
  try {
    const q = await getQueue();
    if (!q.enabled || q.messages.length === 0) return;
    if (!sock || !connected) {
      log(`${q.messages.length} message(s) waiting — WhatsApp not linked yet`);
      return;
    }
    for (const m of q.messages) {
      try {
        const pdf = await fetch(
          `${APP_URL}/api/relay/whatsapp/pdf?invoice=${encodeURIComponent(m.invoice_id)}`,
          { headers: { Authorization: `Bearer ${RELAY_TOKEN}` } }
        );
        if (!pdf.ok) throw new Error(`pdf HTTP ${pdf.status}`);
        const buf = Buffer.from(await pdf.arrayBuffer());

        const jid = toJid(m.to_mobile);
        const check = await sock.onWhatsApp(jid).catch(() => null);
        if (check && check[0] && check[0].exists === false) {
          await report(m.id, false, { error: `${m.to_mobile} is not on WhatsApp` });
          log('✗', m.filename, '→', m.to_mobile, '(not on WhatsApp)');
        } else {
          const sent = await sock.sendMessage(jid, {
            document: buf,
            mimetype: 'application/pdf',
            fileName: m.filename || 'receipt.pdf',
            caption: m.caption || undefined,
          });
          await report(m.id, true, { wa_message_id: sent?.key?.id || null });
          log('✓', m.filename, '→', m.to_mobile);
        }
      } catch (e) {
        await report(m.id, false, { error: e.message });
        log('✗', m.filename, '→', m.to_mobile, e.message);
      }
      await new Promise((r) => setTimeout(r, q.send_delay_ms ?? 2500));
    }
  } catch (e) {
    // app unreachable — try again next tick
  } finally {
    sending = false;
  }
}

/* ---------- boot ---------- */

async function main() {
  if (!RELAY_TOKEN) {
    console.error('\n  RELAY_TOKEN is missing — copy .env.example to .env and fill it in.\n');
    process.exit(1);
  }
  log('GlitchX WhatsApp relay starting…');
  log('app:', APP_URL);
  await startWhatsApp();
  await pushState();
  setInterval(pushState, 5000);
  setInterval(pollQueue, 3500);
  setInterval(() => {
    if (sock && connected) {
      // cheap keep-alive: touching the socket state avoids silent drops
      sock.sendPresenceUpdate('available').catch(() => {});
    }
  }, 60_000);
}

process.on('SIGINT', () => {
  log('bye');
  process.exit(0);
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
