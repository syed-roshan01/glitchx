/* Full header dump: is the queue route being served as a PRERENDERED (static) artifact? */
const fs = require('fs');
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const TOKEN = envLocal.match(/^WHATSAPP_RELAY_TOKEN=(.*)$/m)?.[1]?.trim();
const APP = 'https://glitchx-nu.vercel.app';

async function dump(label, url, opts) {
  const r = await fetch(url, opts);
  console.log('=== ' + label + ' -> HTTP ' + r.status);
  for (const [k, v] of r.headers) {
    if (/cache|age|etag|last-modified|x-matched|x-nextjs|x-vercel|server-timing/i.test(k)) {
      console.log('   ' + k + ': ' + v);
    }
  }
}

(async () => {
  const auth = { Authorization: 'Bearer ' + TOKEN };
  await dump('relay queue (GET)', APP + '/api/relay/whatsapp/queue', { headers: auth });
  await dump('public booking resources (known dynamic GET)', APP + '/api/public/booking/resources', { headers: {} });
})();
