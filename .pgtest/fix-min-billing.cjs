/* Fix the live minimum-billing misconfiguration: 50 → 0 (per-minute billing,
   as the owner asked for originally). The 50-min floor made every play under
   50 min bill as 50 min (₹166.67 for a 30-min pool session). */
const fs = require('fs');
const SUPA = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const SERVICE = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
const h = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' };

(async () => {
  const before = await (await fetch(SUPA + '/rest/v1/settings?id=eq.default&select=min_billing_minutes,billing_mode', { headers: h })).json();
  console.log('before:', JSON.stringify(before[0]));
  await fetch(SUPA + '/rest/v1/settings?id=eq.default', {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ min_billing_minutes: 0 }),
  });
  const after = await (await fetch(SUPA + '/rest/v1/settings?id=eq.default&select=min_billing_minutes,billing_mode', { headers: h })).json();
  console.log('after: ', JSON.stringify(after[0]));
  console.log(after[0]?.min_billing_minutes === 0 ? 'FIXED ✓ — plays now bill by the exact minute' : 'FAILED');
})();
