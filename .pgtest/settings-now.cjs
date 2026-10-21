/* Verify live billing settings (min_billing_minutes suspicion). */
const fs = require('fs');
const SUPA = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const SERVICE = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
(async () => {
  const s = await (await fetch(SUPA + '/rest/v1/settings?id=eq.default&select=*', {
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE },
  })).json();
  console.log(JSON.stringify(s[0], null, 1));
})();
