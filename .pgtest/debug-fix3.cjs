/* Debug FIX 3: does activate_due_sessions work at all? clock skew? */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const APP = process.env.APP_URL || 'http://localhost:3000';

async function main() {
  // temp station + scheduled session due in 65s
  const resource = (await (await fetch(`${SUPA_URL}/rest/v1/resources`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ name: 'ZZ Debug Station', type: 'PLAYSTATION', status: 'ACTIVE' }),
  })).json())[0];
  const plan = (await (await fetch(`${SUPA_URL}/rest/v1/pricing_plans?select=id&active=eq.true&resource_type=eq.PLAYSTATION&limit=1`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  })).json())[0];

  const created = await (await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `dbg-${Date.now()}@cafe.test`, password: 'Dbg#2026!x', email_confirm: true }),
  })).json();
  try {
    await new Promise((r) => setTimeout(r, 1200));
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active: true }),
    });
    const auth = await (await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `dbg-` + created.email.split('dbg-')[1], password: 'Dbg#2026!x' }),
    })).json();

    const sched = await fetch(`${APP}/api/admin/sessions`, {
      method: 'POST',
      headers: { cookie: `sb-vfonvktaqurwfapkgfuz-auth-token=${JSON.stringify(auth)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceId: resource.id, pricingPlanId: plan.id, guestName: 'Dbg Sched',
        startTime: new Date(Date.now() + 65_000).toISOString(), expectedMinutes: 30,
      }),
    });
    const schedBody = await sched.json();
    console.log(`scheduled session: ${schedBody.id?.slice(0, 8)} status=${schedBody.session?.status} sched_start=${schedBody.session?.scheduled_start_time}`);

    console.log('waiting 70s…');
    await new Promise((r) => setTimeout(r, 70_000));

    // 1) what does the DETAIL GET return (my new code path)?
    const detail = await (await fetch(`${APP}/api/admin/sessions/${schedBody.id}`, {
      headers: { cookie: `sb-vfonvktaqurwfapkgfuz-auth-token=${JSON.stringify(auth)}` },
    })).json();
    console.log(`detail GET after due: status=${detail.session?.status}`);

    // 2) call the RPC DIRECTLY — does it activate?
    const rpcRes = await fetch(`${SUPA_URL}/rest/v1/rpc/activate_due_sessions`, {
      method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    const rpcBody = await rpcRes.text();
    console.log(`direct activate_due_sessions: HTTP ${rpcRes.status} → ${rpcBody.slice(0, 120)}`);

    const after = await (await fetch(`${SUPA_URL}/rest/v1/sessions?select=id,status,actual_start_time&scheduled_start_time=lte.${new Date().toISOString()}&status=eq.SCHEDULED`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })).json();
    console.log(`still-scheduled overdue sessions after RPC: ${after.length}`, after.map((s) => s.id.slice(0, 8)));

    // cleanup
    for (const sid of [schedBody.id]) {
      if (!sid) continue;
      const inv = await (await fetch(`${SUPA_URL}/rest/v1/invoices?select=id&session_id=eq.${sid}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })).json();
      if (inv.length) {
        await fetch(`${SUPA_URL}/rest/v1/payments?invoice_id=in.(${inv.map((i) => i.id).join(',')})`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
        await fetch(`${SUPA_URL}/rest/v1/invoices?id=in.(${inv.map((i) => i.id).join(',')})`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
      }
      await fetch(`${SUPA_URL}/rest/v1/session_items?session_id=eq.${sid}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
      await fetch(`${SUPA_URL}/rest/v1/sessions?id=eq.${sid}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    }
  } finally {
    await fetch(`${SUPA_URL}/rest/v1/resources?id=eq.${resource.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    console.log('cleaned up');
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
