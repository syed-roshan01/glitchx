/* Enable the WhatsApp automation toggles + confirm the relay heartbeat/QR */
const fs = require('fs');
const SUPA = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const SERVICE = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
const ANON = envLocal.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)?.[1]?.trim();
const APP = 'https://glitchx-nu.vercel.app';

(async () => {
  // temp ADMIN (self-signups are inactive by design — activate + role via service key)
  const email = 'wa-enable-' + Date.now() + '@cafe.test';
  const created = await (await fetch(SUPA + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'WaEnable#2026!x', email_confirm: true }),
  })).json();
  try {
    await new Promise((r) => setTimeout(r, 1200));
    await fetch(SUPA + '/rest/v1/profiles?id=eq.' + created.id, {
      method: 'PATCH',
      headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active: true, role: 'ADMIN' }),
    });
    const auth = await (await fetch(SUPA + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WaEnable#2026!x' }),
    })).json();
    const headers = { cookie: 'sb-vfonvktaqurwfapkgfuz-auth-token=' + JSON.stringify(auth), 'Content-Type': 'application/json' };

    const put = await fetch(APP + '/api/admin/whatsapp', {
      method: 'PUT', headers,
      body: JSON.stringify({ enabled: true, auto_send: true }),
    });
    console.log('toggles enabled:', put.status === 200 ? '✓ (auto-send ON)' : '✗ HTTP ' + put.status);

    const status = await (await fetch(APP + '/api/admin/whatsapp', { headers })).json();
    const s = status.state || {};
    console.log('relay heartbeat:', s.last_seen ? '✓ online' : '✗ none yet');
    console.log('QR ready to scan:', s.qr ? '✓ YES' : (s.connected ? '(already linked)' : '✗ not yet'));
    console.log('connected:', s.connected, s.phone ? '(' + s.phone + ')' : '');
    console.log('enabled:', s.enabled, '| auto_send:', s.auto_send);
  } finally {
    await fetch(SUPA + '/rest/v1/profiles?id=eq.' + created.id, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE } });
    await fetch(SUPA + '/auth/v1/admin/users/' + created.id, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE } });
  }
})();
