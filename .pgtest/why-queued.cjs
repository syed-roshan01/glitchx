/* Why is a WhatsApp message stuck in queue? */
const fs = require('fs');
const SUPA = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const SERVICE = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();

(async () => {
  const h = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE };
  const [st, msgs] = await Promise.all([
    fetch(SUPA + '/rest/v1/whatsapp_state?id=eq.default&select=*', { headers: h }).then((r) => r.json()),
    fetch(SUPA + '/rest/v1/whatsapp_messages?select=*,invoices(invoice_number)&order=created_at.desc&limit=10', { headers: h }).then((r) => r.json()),
  ]);
  const s = st[0] || {};
  const seen = s.last_seen ? (Date.now() - new Date(s.last_seen).getTime()) / 1000 : null;
  console.log('== whatsapp_state ==');
  console.log('enabled:', s.enabled, '| auto_send:', s.auto_send, '| connected:', s.connected, '| phone:', s.phone);
  console.log('last_seen:', s.last_seen, seen !== null ? `(${seen.toFixed(0)}s ago)` : '(NEVER — no relay is running)');
  console.log('last_error:', s.last_error);
  console.log('\n== messages ==');
  for (const m of msgs) {
    console.log(`${m.invoices?.invoice_number || '?'} ${m.status} attempts=${m.attempts} to=+${m.to_mobile} created=${m.created_at}`);
    if (m.last_error) console.log('   error:', m.last_error);
    if (m.status === 'PENDING') {
      const age = (Date.now() - new Date(m.created_at).getTime()) / 60000;
      console.log(`   queued ${age.toFixed(0)} min ago`);
    }
  }
})();
