/* Is Vercel caching GET responses? Compare headers on plain vs cache-busted requests. */
const fs = require('fs');
const envLocal = fs.readFileSync(__dirname + '/../.env.local', 'utf8');
const TOKEN = envLocal.match(/^WHATSAPP_RELAY_TOKEN=(.*)$/m)?.[1]?.trim();
const APP = 'https://glitchx-nu.vercel.app';

async function probe(label, url, headers) {
  const r = await fetch(url, { headers });
  const body = await r.text();
  console.log(`--- ${label}`);
  console.log('   x-vercel-cache:', r.headers.get('x-vercel-cache'), '| age:', r.headers.get('age'), '| cache-control:', r.headers.get('cache-control'));
  console.log('   body:', body.slice(0, 140));
}

(async () => {
  const auth = { Authorization: 'Bearer ' + TOKEN };
  await probe('plain GET (as the relay does)', APP + '/api/relay/whatsapp/queue', auth);
  await probe('GET with nonce', APP + '/api/relay/whatsapp/queue?t=' + Date.now(), auth);
  await probe('GET with Cache-Control: no-cache', APP + '/api/relay/whatsapp/queue', { ...auth, 'Cache-Control': 'no-cache' });
})();
