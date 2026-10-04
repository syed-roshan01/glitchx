/* eslint-disable */
// ============================================================
// Dev server via the Next.js programmatic API — runs everything
// in-process (no forked CLI worker). Useful in restricted
// environments; on a normal machine `npm run dev` works too.
// Usage: node scripts/dev-server.cjs   (PORT optional, default 3000)
// ============================================================
const next = require('next');
const { createServer } = require('http');

const port = parseInt(process.env.PORT || '3000', 10);
const hostname = process.env.HOSTNAME || 'localhost';

const app = next({ dev: true, dir: __dirname + '/..' });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(port, hostname, () => {
    console.log(`> GlitchX Gaming Cafe ready on http://${hostname}:${port}`);
    console.log('> Public booking page: http://' + hostname + ':' + port + '/book');
    console.log('> Admin setup:         http://' + hostname + ':' + port + '/admin/setup');
  });
}).catch((err) => {
  console.error('Failed to start dev server:', err);
  process.exit(1);
});
