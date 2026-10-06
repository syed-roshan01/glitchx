/* Check whether 00014 is applied to the live DB:
   - public_get_busy_slots exists? (new in 00014)
   - admin functions still executable by anon? (the hole 00014 closes) */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const ANON = process.env.ANON_KEY;

async function rpc(name, body) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 160) };
}

async function main() {
  const busy = await rpc('public_get_busy_slots', { p_date: new Date().toISOString().slice(0, 10) });
  console.log(`public_get_busy_slots (00014 RPC): HTTP ${busy.status}`);
  console.log('  ', busy.body);
  console.log(busy.status === 404 ? '  → 00014 NOT APPLIED (function missing)' : '  → 00014 appears APPLIED');

  const probe = await rpc('booking_slot_is_free', {
    p_resource_id: '00000000-0000-0000-0000-000000000000',
    p_start: new Date().toISOString(),
    p_end: new Date(Date.now() + 3600_000).toISOString(),
    p_exclude_booking: null,
  });
  console.log(`\nanon calling internal booking_slot_is_free: HTTP ${probe.status}`);
  console.log('  ', probe.body);
  console.log(probe.status === 200 ? '  → ⚠️ SECURITY HOLE OPEN (anon can execute internal functions — 00014 not applied)' : '  → blocked (good)');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
