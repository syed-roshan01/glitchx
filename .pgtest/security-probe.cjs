/* Empirically verify the two security questions against the LIVE project:
   1. Can anon execute admin functions? (probe with a dummy resource — fails safely on FK lookup)
   2. Does self-signup produce an ACTIVE staff profile? (the real hole 00014 fixes)
   Cleans up the test user afterwards. */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_KEY;

async function main() {
  // ---- 1. admin function execution by anon ----
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/admin_start_session`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_customer_id: '00000000-0000-0000-0000-000000000000',
      p_resource_id: '00000000-0000-0000-0000-000000000000',
      p_pricing_plan_id: '00000000-0000-0000-0000-000000000000',
    }),
  });
  const body = (await r.text()).slice(0, 180);
  console.log(`anon → admin_start_session: HTTP ${r.status}`);
  console.log('  ', body);
  console.log(
    r.status === 404
      ? '  ✓ NOT executable by anon (blocked)'
      : r.status === 400 || r.status === 500
        ? '  ⚠️ EXECUTABLE by anon — function ran and raised a business error = HOLE OPEN'
        : '  ? unexpected'
  );

  // ---- 2. self-signup → active staff profile? ----
  const email = `secprobe-${Date.now()}@cafe.test`;
  const signup = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'SecProbe#2026!x' }),
  });
  const su = await signup.json();
  console.log(`\nself-signup via public API: HTTP ${signup.status}`, su.user ? `(user ${su.user.id.slice(0, 8)}…)` : JSON.stringify(su).slice(0, 120));

  if (su.user?.id) {
    try {
      const profRes = await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${su.user.id}&select=id,role,active,created_at`, {
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
      const profiles = await profRes.json();
      console.log('  profile created by trigger:', JSON.stringify(profiles[0] ?? null));
      if (profiles[0]?.active === true) {
        console.log('  ⚠️⚠️ SELF-SIGNUP HOLE CONFIRMED — anyone can sign up and instantly count as active STAFF (RLS staff access).');
      } else {
        console.log('  ✓ profile inactive (00014-style behavior present)');
      }
    } finally {
      // cleanup
      await fetch(`${SUPA_URL}/auth/v1/admin/users/${su.user.id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
      await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${su.user.id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
      console.log('  (probe user cleaned up)');
    }
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
