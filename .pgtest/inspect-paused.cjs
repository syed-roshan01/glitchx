/* Inspect the user's actual paused session via the detail API (real flow) */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const APP = process.env.APP_URL || 'http://localhost:3000';
const REF = 'vfonvktaqurwfapkgfuz';
const EMAIL = `inspect-${Date.now()}@cafe.test`;
const PASSWORD = 'Inspect#2026!x';

async function main() {
  // find the paused session
  const list = await (await fetch(
    `${SUPA_URL}/rest/v1/sessions?select=id,status,resource_id&status=eq.PAUSED&order=created_at.desc&limit=1`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  )).json();
  if (!list.length) { console.log('no PAUSED session found'); return; }
  const target = list[0].id;
  console.log('paused session:', target.slice(0, 8));

  // temp admin-ish user to call the API
  const createRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  const created = await createRes.json();
  try {
    await new Promise((r) => setTimeout(r, 1200));
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active: true, role: 'STAFF' }),
    });
    const session = await (await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })).json();
    const headers = { cookie: `sb-${REF}-auth-token=${JSON.stringify(session)}` };

    const detail = await (await fetch(`${APP}/api/admin/sessions/${target}`, { headers })).json();
    const s = detail.session ?? {};
    console.log('status:', s.status, '| started:', s.actual_start_time, '| paused_at:', s.paused_at);
    console.log('items:', detail.items?.length, '| rules:', detail.rules?.length);
    console.log('server breakdown:', JSON.stringify(detail.breakdown)?.slice(0, 300));
    console.log('settings tz:', detail.settings?.timezone, '| billing_mode:', detail.settings?.billing_mode);
    console.log('plan snapshot:', JSON.stringify(s.pricing_plan_snapshot));
  } finally {
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    console.log('(temp user cleaned up)');
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
