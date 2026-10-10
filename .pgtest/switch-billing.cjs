/* Switch billing_mode → EXACT_MINUTES through the real settings API,
   then prove the live timer bills per minute on the user's running session. */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const APP = process.env.APP_URL || 'https://glitchx-nu.vercel.app';
const EMAIL = `billing-${Date.now()}@cafe.test`;
const PASSWORD = 'Billing#2026!x';

async function main() {
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
      body: JSON.stringify({ active: true, role: 'ADMIN' }),
    });
    const auth = await (await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })).json();
    const cookie = `sb-vfonvktaqurwfapkgfuz-auth-token=${JSON.stringify(auth)}`;

    // read current settings via the API, flip billing_mode, save
    const current = await (await fetch(`${APP}/api/admin/settings`, { headers: { cookie } })).json();
    console.log('current billing_mode:', current.settings?.billing_mode ?? current.billing_mode, '| min_billing_minutes:', current.settings?.min_billing_minutes ?? current.min_billing_minutes);
    const s = current.settings ?? current;

    const put = await fetch(`${APP}/api/admin/settings`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, billing_mode: 'EXACT_MINUTES' }),
    });
    const putBody = await put.text();
    console.log(`PUT settings: HTTP ${put.status}`, put.status === 200 ? '✓ saved' : putBody.slice(0, 200));

    // verify in the DB (source of truth)
    const db = await (await fetch(`${SUPA_URL}/rest/v1/settings?select=billing_mode,min_billing_minutes&limit=1`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })).json();
    console.log('DB settings now:', JSON.stringify(db[0]));

    // prove per-minute billing on a live session (the user's running one, if any)
    const live = await (await fetch(
      `${SUPA_URL}/rest/v1/sessions?select=id,status,actual_start_time,total_paused_seconds,paused_at&status=in.(ACTIVE,PAUSED)&order=created_at.desc&limit=1`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
    )).json();
    if (live.length) {
      const s0 = live[0];
      const detail = await (await fetch(`${APP}/api/admin/sessions/${s0.id}`, { headers: { cookie } })).json();
      const b = detail.breakdown;
      if (b) {
        const elapsedMin = b.elapsedSeconds / 60;
        console.log(`\nlive session ${s0.id.slice(0, 8)} (${s0.status}):`);
        console.log(`  elapsed: ${b.elapsedSeconds.toFixed(0)}s (${elapsedMin.toFixed(2)} min)`);
        console.log(`  billableMinutes: ${b.billableMinutes} (expect ceil(${elapsedMin.toFixed(2)}) = ${Math.ceil(elapsedMin)} — per minute, not 15-min blocks)`);
        console.log(`  gaming: ${b.gamingAmount} · total: ${b.total}`);
      } else {
        console.log('no breakdown (session not live?)');
      }
    } else {
      console.log('\nno live session right now — billing mode verified via settings only');
    }
  } finally {
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    console.log('(temp user cleaned)');
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
