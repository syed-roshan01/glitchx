/* Live: pricing rules for the pool table + what estimate_booking_amount returns. */
const fs = require('fs');
const SUPA = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const SERVICE = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
const h = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' };

(async () => {
  const res = await (await fetch(SUPA + '/rest/v1/resources?select=*&order=name', { headers: h })).json();
  if (!Array.isArray(res)) { console.log('resources error:', JSON.stringify(res)); return; }
  console.log('resources:');
  for (const r of res) console.log(' ', r.id, '|', r.name, '| hourly_rate:', r.hourly_rate, '| currency:', r.currency_symbol);

  const pool = res.find((r) => /pool|billiard|snooker/i.test(r.name)) || res[0];
  const tables = ['pricing_rules', 'rate_rules', 'pricing_plans', 'plans'];
  for (const t of tables) {
    const rows = await (await fetch(SUPA + `/rest/v1/${t}?select=*&limit=20`, { headers: h })).json();
    if (Array.isArray(rows)) {
      console.log(`\n${t}:`);
      for (const row of rows) console.log(' ', JSON.stringify(row));
    }
  }

  console.log('\nestimates for', pool.name, ':');
  for (const mins of [30, 60, 90, 120]) {
    const r = await fetch(SUPA + '/rest/v1/rpc/estimate_booking_amount', {
      method: 'POST', headers: h,
      body: JSON.stringify({ p_resource_id: pool.id, p_duration_minutes: mins }),
    });
    console.log(` ${mins} min ->`, r.status, (await r.text()).slice(0, 140));
  }
})();
