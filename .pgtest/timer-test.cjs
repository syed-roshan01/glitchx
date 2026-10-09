/* Reproduce the timer bug: create a session exactly like the UI does,
   then inspect what comes back. Also checks 00015 live status. */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const APP = process.env.APP_URL || 'http://localhost:3000';
const REF = 'vfonvktaqurwfapkgfuz';
const EMAIL = `timertest-${Date.now()}@cafe.test`;
const PASSWORD = 'TimerTest#2026!x';

async function main() {
  // ---- 00015 applied? ----
  const colRes = await fetch(`${SUPA_URL}/rest/v1/sessions?select=id,guest_name,guest_mobile&limit=1`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const colBody = await colRes.text();
  console.log(`sessions.guest_name column: HTTP ${colRes.status}`, colRes.status === 200 ? '(exists — 00015 applied)' : colBody.slice(0, 120));

  const ledgerRes = await fetch(`${SUPA_URL}/rest/v1/ledger_entries?select=id&limit=1`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  console.log(`ledger_entries table:      HTTP ${ledgerRes.status}`, ledgerRes.status === 200 ? '(exists)' : (await ledgerRes.text()).slice(0, 100));

  // ---- temp user + login ----
  const createRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { name: 'Timer Test' } }),
  });
  const created = await createRes.json();
  if (!created.id) throw new Error('user create failed: ' + JSON.stringify(created).slice(0, 150));
  console.log('\ntest user:', created.id.slice(0, 8));

  let sessionId = null;
  try {
    await new Promise((r) => setTimeout(r, 1200));
    const tokenRes = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const session = await tokenRes.json();
    const headers = { cookie: `sb-${REF}-auth-token=${JSON.stringify(session)}`, 'Content-Type': 'application/json' };

    // activate the profile (self-signups are inactive post-00014)
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active: true }),
    });

    // pick a free PS5 + its plan (like the wizard does)
    const avail = await (await fetch(`${SUPA_URL}/rest/v1/rpc/public_get_availability`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: '{}',
    })).json();
    const station = avail.find((r) => r.status === 'AVAILABLE');
    if (!station) throw new Error('no available station — end existing sessions first');
    const plans = await (await fetch(`${SUPA_URL}/rest/v1/pricing_plans?select=id,name,resource_type,price&active=eq.true&order=price.asc`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })).json();
    const plan = plans.find((p) => station.resource_type.startsWith('PLAYSTATION') ? p.resource_type === 'PLAYSTATION' : p.resource_type === station.resource_type);
    console.log(`station: ${station.name} (${station.status}) · plan: ${plan?.name}`);

    // ---- create session exactly like the wizard ("start now") ----
    const t0 = Date.now();
    const post = await fetch(`${APP}/api/admin/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resourceId: station.resource_id,
        pricingPlanId: plan.id,
        guestName: 'Timer Probe',
        guestMobile: '9876500111',
      }),
    });
    const postBody = await post.text();
    console.log(`\nPOST /api/admin/sessions: HTTP ${post.status} in ${Date.now() - t0}ms`);
    console.log('  ', postBody.slice(0, 200));
    const parsed = JSON.parse(postBody);
    if (!parsed.id) throw new Error('session create failed');
    sessionId = parsed.id;

    // ---- what does the detail API return? ----
    const detail = await (await fetch(`${APP}/api/admin/sessions/${sessionId}`, { headers })).json();
    const s = detail.session ?? {};
    console.log(`\nGET session detail:`);
    console.log('   status:           ', s.status);
    console.log('   actual_start_time:', s.actual_start_time);
    console.log('   scheduled_start:  ', s.scheduled_start_time);
    console.log('   paused_at:        ', s.paused_at);
    console.log('   plan snapshot:    ', JSON.stringify(s.pricing_plan_snapshot)?.slice(0, 120));
    console.log('   breakdown null?   ', detail.breakdown === null || detail.breakdown === undefined ? 'YES — timer will show "—"' : `elapsed=${detail.breakdown.elapsedSeconds}s total=${detail.breakdown.total}`);

    console.log(sessionId ? `\nSESSION LEFT RUNNING (${sessionId.slice(0, 8)}) — clean up manually or via admin` : '');
  } finally {
    // leave the session RUNNING on purpose if created — no, clean it:
    if (sessionId) {
      const headers2 = { cookie: `sb-${REF}-auth-token=${JSON.stringify(await (await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json())}`, 'Content-Type': 'application/json' };
      const end = await fetch(`${APP}/api/admin/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: headers2,
        body: JSON.stringify({ paymentMethod: 'CASH', billing: { duration_seconds: 60, gaming_amount: 100 }, discountType: null, discountValue: null }),
      });
      console.log(`cleanup end session: HTTP ${end.status}`);
    }
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    console.log('test user cleaned up');
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
