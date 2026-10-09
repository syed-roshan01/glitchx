/* FIX 2/3 verification on a TEMPORARY station (created + removed by this script):
   FIX 2: POST returns the full session object
   FIX 3: a scheduled session auto-activates on the detail GET once due */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const APP = process.env.APP_URL || 'http://localhost:3000';
const EMAIL = `fx23-${Date.now()}@cafe.test`;
const PASSWORD = 'Fx23#2026!x';

async function main() {
  // temp station (never touches the user's stations)
  const resourceRes = await fetch(`${SUPA_URL}/rest/v1/resources`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ name: 'ZZ Verify Station', type: 'PLAYSTATION', status: 'ACTIVE' }),
  });
  const resource = (await resourceRes.json())[0];
  console.log(`temp station: ${resource.name} (${resource.id.slice(0, 8)})`);

  const plan = (await (await fetch(`${SUPA_URL}/rest/v1/pricing_plans?select=id,name&active=eq.true&resource_type=eq.PLAYSTATION&order=price.asc&limit=1`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  })).json())[0];

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

    // ---- FIX 2: full session in POST response ----
    const post = await fetch(`${APP}/api/admin/sessions`, {
      method: 'POST', headers,
      body: JSON.stringify({ resourceId: resource.id, pricingPlanId: plan.id, guestName: 'Fx Probe' }),
    });
    const postBody = await post.json();
    made.push(postBody.id);
    console.log('\nFIX 2 — POST returns full session:');
    console.log(`  HTTP ${post.status}`);
    console.log(`  session.status: ${postBody.session?.status} (expect ACTIVE)`);
    console.log(`  actual_start_time: ${postBody.session?.actual_start_time ? 'present ✓' : 'MISSING ✗'}`);
    console.log(`  resource_name: ${postBody.session?.resource_name}`);
    console.log(`  guest_name: ${postBody.session?.guest_name}`);

    // ---- FIX 3: scheduled → auto-activate on GET when due ----
    const sched = await fetch(`${APP}/api/admin/sessions`, {
      method: 'POST', headers,
      body: JSON.stringify({
        resourceId: resource.id, pricingPlanId: plan.id, guestName: 'Fx Sched',
        startTime: new Date(Date.now() + 65_000).toISOString(), expectedMinutes: 30,
      }),
    });
    const schedBody = await sched.json();
    made.push(schedBody.id);
    console.log('\nFIX 3 — scheduled session:');
    console.log(`  created: HTTP ${sched.status} → status ${schedBody.session?.status} (expect SCHEDULED)`);

    const early = await (await fetch(`${APP}/api/admin/sessions/${schedBody.id}`, { headers })).json();
    console.log(`  GET before due: status ${early.session?.status} (expect SCHEDULED)`);

    console.log('  waiting 70s for due time…');
    await new Promise((r) => setTimeout(r, 70_000));
    const late = await (await fetch(`${APP}/api/admin/sessions/${schedBody.id}`, { headers })).json();
    console.log(`  GET after due:  status ${late.session?.status} (expect ACTIVE — auto-activated)`);
    console.log(`  actual_start_time: ${late.session?.actual_start_time ? 'present ✓' : 'MISSING ✗'}`);
  } finally {
    // direct-DB cleanup (leave no trace in the user's data)
    if (made.length) {
      const ids = made.map((id) => `"${id}"`).join(',');
      for (const q of [
        `invoices.session_id.in.(${made.join(',')})`,
      ]) {
        // delete payments of these invoices first
        const inv = await (await fetch(`${SUPA_URL}/rest/v1/invoices?select=id&session_id=in.(${made.join(',')})`, {
          headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
        })).json();
        if (inv.length) {
          await fetch(`${SUPA_URL}/rest/v1/payments?invoice_id=in.(${inv.map((i) => i.id).join(',')})`, {
            method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
          });
          await fetch(`${SUPA_URL}/rest/v1/invoices?id=in.(${inv.map((i) => i.id).join(',')})`, {
            method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
          });
        }
        await fetch(`${SUPA_URL}/rest/v1/session_items?session_id=in.(${made.join(',')})`, {
          method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
        });
        await fetch(`${SUPA_URL}/rest/v1/sessions?id=in.(${made.join(',')})`, {
          method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
        });
      }
      console.log(`cleanup: removed ${made.length} test sessions (+invoices/items)`);
    }
    await fetch(`${SUPA_URL}/rest/v1/resources?id=eq.${resource.id}`, {
      method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    console.log('temp station + user removed');
  }
}
main().catch(async (e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
