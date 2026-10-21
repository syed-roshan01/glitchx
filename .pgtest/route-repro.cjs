/* Reproduce the queue route's exact supabase-js calls and print the ERRORS. */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const SERVICE = envLocal.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();

const admin = createClient('https://vfonvktaqurwfapkgfuz.supabase.co', SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

(async () => {
  const [msgs, state] = await Promise.all([
    admin
      .from('whatsapp_messages')
      .select('id, invoice_id, to_mobile, caption, invoices(invoice_number)')
      .eq('status', 'PENDING')
      .order('created_at')
      .limit(5),
    admin.from('whatsapp_state').select('send_delay_ms, enabled').eq('id', 'default').single(),
  ]);
  console.log('msgs error:', JSON.stringify(msgs.error));
  console.log('msgs data:', JSON.stringify(msgs.data));
  console.log('state error:', JSON.stringify(state.error));
  console.log('state data:', JSON.stringify(state.data));
})();
