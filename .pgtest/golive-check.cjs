/* Verify the user's go-live steps: SQL applied + Vercel env token matches */
const fs = require('fs');
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const TOKEN = envLocal.match(/^WHATSAPP_RELAY_TOKEN=(.*)$/m)?.[1]?.trim();
const SERVICE = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();

(async () => {
  // 1) SQL applied?
  const t = await fetch('https://vfonvktaqurwfapkgfuz.supabase.co/rest/v1/whatsapp_messages?select=id&limit=1', {
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE },
  });
  console.log('1. SQL applied (whatsapp tables live):', t.status === 200 ? 'YES ✓' : 'NO ✗ (HTTP ' + t.status + ')');

  // 2) Vercel env + deployed code?
  const r = await fetch('https://glitchx-nu.vercel.app/api/relay/whatsapp/queue', {
    headers: { Authorization: 'Bearer ' + TOKEN },
  });
  console.log('2. Vercel token matches .env.local:', r.status === 200 ? 'YES ✓' : r.status === 401 ? 'NO ✗ (401 — wrong value in Vercel, or env not deployed yet)' : 'HTTP ' + r.status);
  if (r.status === 200) {
    const q = await r.json();
    console.log('   queue: enabled=' + q.enabled + ' pending=' + q.messages.length);
  }
})();
