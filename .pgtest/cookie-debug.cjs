/* Debug: does a hand-built ssr cookie authenticate createServerClient.getUser? */
const { createServerClient } = require('@supabase/ssr');

const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = process.env.ANON_KEY;
const REF = 'vfonvktaqurwfapkgfuz';
const EMAIL = `cookietest-${Date.now()}@cafe.test`;
const PASSWORD = 'CookieTest#2026!x';
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');

async function main() {
  const createRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  const created = await createRes.json();
  if (!created.id) throw new Error('create failed: ' + JSON.stringify(created).slice(0, 200));

  try {
    const tokenRes = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const session = await tokenRes.json();
    console.log('session keys:', Object.keys(session).join(', '), '| expires_at:', session.expires_at);

    const variants = [
      ['plain JSON', JSON.stringify(session)],
      ['base64url(JSON)', b64url(JSON.stringify(session))],
      ['base64url(JSON array)', b64url(JSON.stringify([session]))],
      ['base64- prefixed', 'base64-' + b64url(JSON.stringify(session))],
    ];

    for (const [label, value] of variants) {
      const supabase = createServerClient(SUPA_URL, ANON, {
        cookies: {
          getAll: () => [{ name: `sb-${REF}-auth-token`, value }],
          setAll: () => {},
        },
      });
      const { data: { user }, error } = await supabase.auth.getUser();
      console.log(`  ${label}: user=${user?.id?.slice(0, 8) ?? 'null'} ${error ? 'err=' + error.message : ''}`);
      if (user) {
        // also verify the profile read works (what middleware does)
        const { data: p } = await supabase.from('profiles').select('role, name, active').eq('id', user.id).single();
        console.log(`    profile via RLS: ${JSON.stringify(p)}`);
        break;
      }
    }
  } finally {
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    console.log('cleaned up');
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
