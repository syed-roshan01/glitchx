/* Live Supabase connectivity check — light-touch, read-only */
const URL_BASE = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmb252a3RhcXVyd2ZhcGtnZnV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwOTQ4NzAsImV4cCI6MjEwNjY3MDg3MH0.MLzv3IDfub107X4wbvIM762tCHdS-pQLwOJFnOThWZM';

async function rpc(name, key, body = '{}') {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body,
  });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  const setup = await rpc('public_setup_status', ANON);
  console.log('setup_status:', JSON.stringify(setup));

  const avail = await rpc('public_get_availability', ANON);
  console.log('availability:');
  for (const a of avail) console.log(`  ${a.name.padEnd(12)} ${String(a.status).padEnd(11)} ${a.rate_label}`);

  const users = await rpc('public_setup_status', SERVICE); // service role path works too
  console.log('service-role RPC access: OK', JSON.stringify(users).slice(0, 80));

  const res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  if (!res.ok) throw new Error(`admin users: HTTP ${res.status}`);
  const usersList = await res.json();
  console.log('auth users so far:', usersList.users.length);

  console.log('\nLIVE DATABASE VERIFIED ✓');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
