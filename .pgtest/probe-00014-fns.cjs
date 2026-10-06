/* Probe which 00014 functions exist on the live DB */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_KEY;

async function probe(label, fn, body, key) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = (await r.text()).slice(0, 140);
  const exists = r.status !== 404;
  console.log(`${exists ? 'EXISTS' : 'MISSING'}  ${label} (HTTP ${r.status}) ${exists ? '— ' + text : ''}`);
  return exists;
}

async function main() {
  // service-role probes (internal functions)
  await probe('admin_record_payment    ', 'admin_record_payment', {
    p_invoice_id: '00000000-0000-0000-0000-000000000000', p_amount: 1, p_method: 'CASH',
  }, SERVICE);
  // anon probes (public functions)
  await probe('public_get_busy_slots   ', 'public_get_busy_slots', { p_from: new Date().toISOString(), p_to: new Date(Date.now() + 86400000).toISOString() }, ANON);
  await probe('public_lookup_booking   ', 'public_lookup_booking', { p_code: 'GC-0000', p_mobile: '9999999999' }, ANON);
  await probe('public_cancel_booking   ', 'public_cancel_booking', { p_code: 'GC-0000', p_mobile: '9999999999' }, ANON);
  await probe('mobile_digits           ', 'mobile_digits', { p: '+91 98765 43210' }, ANON);
  // sanity: old 00010 public RPCs still there
  await probe('public_get_availability ', 'public_get_availability', {}, ANON);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
