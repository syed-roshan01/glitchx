/* Verify the three fixes:
   1. Busy-station error → 409 + blockedBy + helpful message
   2. POST returns full session (instant timer data)
   3. Scheduled session auto-activates on detail GET when due */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const APP = process.env.APP_URL || 'http://localhost:3000';
const EMAIL = `fixtest-${Date.now()}@cafe.test`;
const PASSWORD = 'FixTest#2026!x';

async function main() {
  const created = await (await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  })).json();
  const made = [];
  try {
    await new Promise((r) => setTimeout(r, 1200));
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active: true }),
    });
    const session = await (await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })).json();
    const headers = { cookie: `sb-vfonvktaqurwfapkgfuz-auth-token=${JSON.stringify(session)}`, 'Content-Type': 'application/json' };

    const avail = await (await fetch(`${SUPA_URL}/rest/v1/rpc/public_get_availability`, {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: '{}',
    })).json();
    const plans = await (await fetch(`${SUPA_URL}/rest/v1/pricing_plans?select=id,name,resource_type&active=eq.true`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })).json();

    // FIX 1 target: the station held by the PAUSED session (never user's ACTIVE data)
    const pausedRow = (await (await fetch(
      `${SUPA_URL}/rest/v1/sessions?select=resource_id&status=eq.PAUSED&order=created_at.desc&limit=1`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
    )).json())[0];
    const pausedStation = avail.find((r) => r.resource_id === pausedRow?.resource_id);
    const ps5Plan = plans.find((p) => p.resource_type === (pausedStation?.resource_type ?? 'PLAYSTATION'));

    // ---- FIX 1: busy-station error (paused blocker) ----
    const busyRes = await fetch(`${APP}/api/admin/sessions`, {
      method: 'POST', headers,
      body: JSON.stringify({ resourceId: pausedStation.resource_id, pricingPlanId: ps5Plan.id, guestName: 'Fix Probe' }),
    });
    const busyBody = await busyRes.json();
    console.log('FIX 1 — busy station (paused blocker):');
    console.log(`  HTTP ${busyRes.status} (expect 409)`);
    console.log(`  error: ${busyBody.error}`);
    console.log(`  blockedBy: ${JSON.stringify(busyBody.blockedBy)} (expect status PAUSED)`);

    // ---- wait for a FREE station for FIX 2/3 (never touch user's live data) ----
    console.log('\nwaiting for a free station (user is testing — up to 5 min)…');
    let pool = null;
    for (let i = 0; i < 60 && !pool; i++) {
      const a = await (await fetch(`${SUPA_URL}/rest/v1/rpc/public_get_availability`, {
        method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: '{}',
      })).json();
      pool = a.find((r) => r.status === 'AVAILABLE');
      if (!pool) await new Promise((r) => setTimeout(r, 5000));
    }
    if (!pool) { console.log('  no free station appeared — skipping FIX 2/3 live check'); return; }
    const poolPlan = plans.find((p) => p.resource_type === pool.resource_type) ?? plans[0];
    console.log(`  free station: ${pool.name}`);

    // ---- FIX 2: full session in POST response ----
    const post = await fetch(`${APP}/api/admin/sessions`, {
      method: 'POST', headers,
      body: JSON.stringify({ resourceId: pool.resource_id, pricingPlanId: poolPlan.id, guestName: 'Fix Probe 2' }),
    });
    const postBody = await post.json();
    made.push(postBody.id);
    console.log('\nFIX 2 — POST response:');
    console.log(`  HTTP ${post.status}`);
    console.log(`  session.status: ${postBody.session?.status} (expect ACTIVE)`);
    console.log(`  session.actual_start_time: ${postBody.session?.actual_start_time ? 'present ✓' : 'MISSING ✗'}`);
    console.log(`  session.resource_name: ${postBody.session?.resource_name}`);

    // ---- FIX 3: scheduled session auto-activates ----
    const schedRes = await fetch(`${APP}/api/admin/sessions`, {
      method: 'POST', headers,
      body: JSON.stringify({
        resourceId: pool.resource_id, pricingPlanId: poolPlan.id, guestName: 'Fix Probe 3',
        startTime: new Date(Date.now() + 65_000).toISOString(), expectedMinutes: 30,
      }),
    });
    const schedBody = await schedRes.json();
    made.push(schedBody.id);
    console.log('\nFIX 3 — scheduled session:');
    console.log(`  created: HTTP ${schedRes.status} → status ${schedBody.session?.status} (expect SCHEDULED)`);

    const early = await (await fetch(`${APP}/api/admin/sessions/${schedBody.id}`, { headers })).json();
    console.log(`  GET before due: status ${early.session?.status} (expect SCHEDULED — not yet due)`);

    console.log('  waiting 70s for the start time to arrive…');
    await new Promise((r) => setTimeout(r, 70_000));
    const late = await (await fetch(`${APP}/api/admin/sessions/${schedBody.id}`, { headers })).json();
    console.log(`  GET after due:  status ${late.session?.status} (expect ACTIVE — auto-activated by the GET)`);
    console.log(`  actual_start_time now: ${late.session?.actual_start_time ? 'present ✓' : 'MISSING ✗'}`);
  } finally {
    for (const id of made) {
      const session = await (await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      })).json();
      const end = await fetch(`${APP}/api/admin/sessions/${id}/end`, {
        method: 'POST',
        headers: { cookie: `sb-vfonvktaqurwfapkgfuz-auth-token=${JSON.stringify(session)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethod: 'CASH', billing: { duration_seconds: 60, gaming_amount: 100 } }),
      }).catch(() => null);
      console.log(`cleanup ${id.slice(0, 8)}: ${end ? end.status : 'skipped'}`);
    }
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    console.log('(temp user cleaned)');
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
