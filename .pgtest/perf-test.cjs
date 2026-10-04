/* End-to-end performance verification with a temporary test user.
   Creates a user, signs in, times admin API calls through the middleware,
   then removes the user again. Does NOT claim first-admin. */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const APP = process.env.APP_URL || 'http://localhost:3000';
const REF = 'vfonvktaqurwfapkgfuz';
const EMAIL = `perftest-${Date.now()}@cafe.test`;
const PASSWORD = 'PerfTest#2026!x';

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');

async function main() {
  // 1. create test user (auth admin API)
  const createRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { name: 'Perf Test' } }),
  });
  const created = await createRes.json();
  if (!created.id) throw new Error('user create failed: ' + JSON.stringify(created).slice(0, 200));
  console.log('test user:', created.id);

  try {
    // wait for the profiles trigger
    await new Promise((r) => setTimeout(r, 1500));

    // 2. sign in → session → ssr cookie
    const tokenRes = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const session = await tokenRes.json();
    if (!session.access_token) throw new Error('signin failed: ' + JSON.stringify(session).slice(0, 200));

    const raw = JSON.stringify(session);
    // @supabase/ssr reads un-prefixed cookie values as plain JSON
    const cookie = raw.length > 3180
      ? null // chunked — not expected here
      : `sb-${REF}-auth-token=${raw}`;
    if (!cookie) throw new Error('session too large for single cookie — handle chunking');
    const headers = { cookie };

    const timed = async (label, url, expect = 200, withAuth = true) => {
      const t0 = Date.now();
      const r = await fetch(url, { headers: withAuth ? headers : {} });
      const ms = Date.now() - t0;
      const ok = r.status === expect;
      console.log(`  ${ok ? '✓' : '✗'} ${label}: ${r.status} in ${ms} ms`);
      return ms;
    };

    console.log(`\nTimings against ${APP} (~100ms ≈ one Supabase round-trip):`);
    // warmup
    await fetch(`${APP}/api/admin/dashboard`, { headers }).catch(() => {});
    const t1 = await timed('dashboard API (1st)', `${APP}/api/admin/dashboard`);
    const t2 = await timed('dashboard API (2nd, settings cached)', `${APP}/api/admin/dashboard`);
    const t3 = await timed('customers API', `${APP}/api/admin/customers`);
    const t4 = await timed('sessions API', `${APP}/api/admin/sessions`);
    await timed('unauthenticated API → 401', `${APP}/api/admin/dashboard`, 401, false);
    console.log(`\ndashboard: ${t1}ms → ${t2}ms warm`);
  } finally {
    // 3. cleanup: profile row + auth user
    const delProfile = await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    });
    const delUser = await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    console.log(`cleanup: profile ${delProfile.status}, auth user ${delUser.status}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
