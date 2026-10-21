/* Kill the WhatsApp pipeline (relay dropped) + check the pool booking estimate. */
const fs = require('fs');
const SUPA = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const SERVICE = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
const h = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' };

(async () => {
  // 1) master switch OFF — nothing queues any more
  await fetch(SUPA + '/rest/v1/whatsapp_state?id=eq.default', {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ enabled: false, auto_send: false }),
  });
  const st = await (await fetch(SUPA + '/rest/v1/whatsapp_state?id=eq.default&select=enabled,auto_send', { headers: h })).json();
  console.log('whatsapp pipeline:', JSON.stringify(st[0]));

  // 2) clear any pending queue rows (they would never send without the relay)
  await fetch(SUPA + "/rest/v1/whatsapp_messages?status=eq.PENDING", { method: 'DELETE', headers: h });
  console.log('pending queue cleared');

  // 3) what does the booking estimate say for pool 30/60/90/120 min?
  const res = await (await fetch(SUPA + '/rest/v1/resources?select=id,name,kind&order=name', { headers: h })).json();
  const pool = (res || []).find((r) => /pool|billiard|snooker/i.test(r.name));
  console.log('resources:', JSON.stringify(res));
  if (pool) {
    for (const mins of [30, 60, 90, 120]) {
      const r = await fetch(SUPA + '/rest/v1/rpc/estimate_booking_amount', {
        method: 'POST', headers: h,
        body: JSON.stringify({ p_resource_id: pool.id, p_minutes: mins }),
      });
      console.log(`estimate ${mins} min ->`, r.status, (await r.text()).slice(0, 120));
    }
  }
})();
