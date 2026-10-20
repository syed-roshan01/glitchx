/* Full WhatsApp chain test against the running dev server + relay:
   heartbeat state → admin status → manual send → queue → PDF → report */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const APP = 'http://localhost:3000';
const RELAY = process.env.RELAY_TOKEN;
const EMAIL = `watest-${Date.now()}@cafe.test`;
const PASSWORD = 'WaTest#2026!x';

async function main() {
  // temp ADMIN user for the admin routes
  const created = await (await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  })).json();
  let messageId = null;
  try {
    await new Promise((r) => setTimeout(r, 1200));
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active: true, role: 'ADMIN' }),
    });
    const auth = await (await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })).json();
    const adminHeaders = { cookie: `sb-vfonvktaqurwfapkgfuz-auth-token=${JSON.stringify(auth)}` };

    // 1) relay heartbeat visible in admin status
    await new Promise((r) => setTimeout(r, 6000)); // let a heartbeat land
    const status = await (await fetch(`${APP}/api/admin/whatsapp`, { headers: adminHeaders })).json();
    console.log('1. admin status:');
    console.log('   relay last_seen:', status.state?.last_seen ? '✓ fresh' : '✗ MISSING');
    console.log('   qr present:', status.state?.qr ? `✓ (${status.state.qr.slice(0, 30)}…)` : '✗ none');
    console.log('   connected:', status.state?.connected, '| enabled:', status.state?.enabled);

    // 2) enable the pipeline
    const put = await fetch(`${APP}/api/admin/whatsapp`, {
      method: 'PUT',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, auto_send: true }),
    });
    console.log('2. enable pipeline: HTTP', put.status);

    // 3) pick a real invoice with a mobile → manual send
    const invoices = await (await fetch(
      `${SUPA_URL}/rest/v1/invoices?select=id,invoice_number,customer_mobile&order=issued_at.desc&limit=5`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
    )).json();
    const target = invoices.find((i) => (i.customer_mobile || '').replace(/\D/g, '').length >= 7);
    if (!target) { console.log('3. no invoice with a mobile — skipping send/queue'); return; }
    const send = await fetch(`${APP}/api/admin/whatsapp/send`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId: target.id }),
    });
    const sendBody = await send.json();
    messageId = sendBody.messageId;
    console.log(`3. manual send ${target.invoice_number} → +${String(target.customer_mobile).replace(/\D/g, '').slice(-10)}: HTTP ${send.status}`, JSON.stringify(sendBody));

    // 4) the queue endpoint (relay view)
    const queue = await (await fetch(`${APP}/api/relay/whatsapp/queue`, {
      headers: { Authorization: `Bearer ${RELAY}` },
    })).json();
    const qm = queue.messages.find((m) => m.id === messageId);
    console.log('4. relay queue:');
    console.log('   enabled:', queue.enabled, '| delay:', queue.send_delay_ms, '| pending:', queue.messages.length);
    console.log('   our message in queue:', qm ? `✓ filename=${qm.filename} caption=${JSON.stringify(qm.caption ?? '').slice(0, 60)}` : '✗ missing');

    // 5) PDF endpoint
    const pdf = await fetch(`${APP}/api/relay/whatsapp/pdf?invoice=${target.id}`, {
      headers: { Authorization: `Bearer ${RELAY}` },
    });
    const head = Buffer.from((await pdf.arrayBuffer()).slice(0, 5)).toString();
    console.log(`5. PDF endpoint: HTTP ${pdf.status} magic=${JSON.stringify(head)} ${head === '%PDF-' ? '✓ valid PDF' : '✗'}`);

    // 6) relay token enforcement
    const bad = await fetch(`${APP}/api/relay/whatsapp/queue`, { headers: { Authorization: 'Bearer wrong' } });
    console.log('6. wrong relay token rejected:', bad.status === 401 ? '✓ 401' : `✗ ${bad.status}`);

    // 7) report delivery
    const rep = await fetch(`${APP}/api/relay/whatsapp/report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RELAY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: messageId, ok: true, wa_message_id: 'TEST-MSG-ID' }),
    });
    console.log('7. report SENT: HTTP', rep.status);

    // 8) back through the admin log
    const log = await (await fetch(`${APP}/api/admin/whatsapp`, { headers: adminHeaders })).json();
    const lm = (log.messages ?? []).find((m) => m.id === messageId);
    console.log('8. admin log shows:', lm ? `status=${lm.status} wa_id=${lm.wa_message_id} ✓` : '✗ missing');

    // leave the test message visible? clean it up:
    if (messageId) {
      await fetch(`${SUPA_URL}/rest/v1/whatsapp_messages?id=eq.${messageId}`, {
        method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
      console.log('(test message removed from the log)');
    }
  } finally {
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    console.log('(temp user cleaned)');
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
