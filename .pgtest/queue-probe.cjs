/* What does the relay's queue endpoint return right now? */
const fs = require('fs');
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const TOKEN = envLocal.match(/^WHATSAPP_RELAY_TOKEN=(.*)$/m)?.[1]?.trim();
const APP = 'https://glitchx-nu.vercel.app';

(async () => {
  const r = await fetch(APP + '/api/relay/whatsapp/queue', { headers: { Authorization: 'Bearer ' + TOKEN } });
  console.log('queue HTTP', r.status);
  const body = await r.text();
  console.log('raw body:', body.slice(0, 600));

  // and the PDF endpoint for that invoice (does it hang?)
  const SUPA = 'https://vfonvktaqurwfapkgfuz.supabase.co';
  const SERVICE = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
  const inv = await (await fetch(SUPA + "/rest/v1/whatsapp_messages?select=invoice_id&status=eq.PENDING&limit=1", {
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE },
  })).json();
  if (inv[0]) {
    const t0 = Date.now();
    const p = await fetch(APP + '/api/relay/whatsapp/pdf?invoice=' + inv[0].invoice_id, {
      headers: { Authorization: 'Bearer ' + TOKEN },
    });
    console.log('pdf HTTP', p.status, 'in', Date.now() - t0, 'ms');
  }
})();
