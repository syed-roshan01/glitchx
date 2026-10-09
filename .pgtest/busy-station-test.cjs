/* Try to create a session on the station held by the paused session —
   reproduce the exact error the user would see */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const APP = process.env.APP_URL || 'http://localhost:3000';
const EMAIL = `busytest-${Date.now()}@cafe.test`;
const PASSWORD = 'BusyTest#2026!x';

async function main() {
  // the paused session's resource
  const paused = await (await fetch(
    `${SUPA_URL}/rest/v1/sessions?select=id,resource_id,status&status=eq.PAUSED&order=created_at.desc&limit=1`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  )).json();
  if (!paused.length) { console.log('no paused session — nothing holding a station'); return; }
  const busyResource = paused[0].resource_id;
  const resourceRow = await (await fetch(
    `${SUPA_URL}/rest/v1/resources?id=eq.${busyResource}&select=name,type,current_status`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  )).json();
  console.log(`station held by paused session: ${resourceRow[0]?.name} (${resourceRow[0]?.current_status})`);

  // find a plan for that station type
  const plans = await (await fetch(
    `${SUPA_URL}/rest/v1/pricing_plans?select=id,name,resource_type,price&active=eq.true`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  )).json();
  const plan = plans.find((p) => p.resource_type === resourceRow[0].type || (resourceRow[0].type.startsWith('PLAYSTATION') && p.resource_type === 'PLAYSTATION'));
  console.log(`plan: ${plan?.name}`);

  // temp user → try to start a session on the busy station
  const created = await (await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  })).json();
  try {
    await new Promise((r) => setTimeout(r, 1200));
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active: true }),
    });
    const session = await (await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })).json();
    const headers = { cookie: `sb-vfonvktaqurwfapkgfuz-auth-token=${JSON.stringify(session)}`, 'Content-Type': 'application/json' };

    const res = await fetch(`${APP}/api/admin/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ resourceId: busyResource, pricingPlanId: plan.id, guestName: 'Busy Probe' }),
    });
    const body = await res.text();
    console.log(`\nPOST on busy station: HTTP ${res.status}`);
    console.log('  body:', body.slice(0, 300));
    console.log(res.status >= 400
      ? '\n→ CONFIRMED: starting a session on a station held by a (paused) live session FAILS — this is what the user hit'
      : '\n→ session created (station was free)');
    if (res.ok) {
      const id = JSON.parse(body).id;
      const end = await fetch(`${APP}/api/admin/sessions/${id}/end`, { method: 'POST', headers, body: JSON.stringify({ paymentMethod: 'CASH', billing: { duration_seconds: 60, gaming_amount: 100 } }) });
      console.log('cleanup:', end.status);
    }
  } finally {
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    console.log('(temp user cleaned)');
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
