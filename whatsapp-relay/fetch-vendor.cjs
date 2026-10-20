// Refresh the two git-pinned Baileys dependencies into ./vendor
// (so `npm install` works on machines without git). Extract with:
//   tar -xzf vendor/libsignal.tgz -C vendor
//   tar -xzf vendor/eslint-config.tgz -C vendor
const fs = require('fs');
(async () => {
  const targets = [
    ['WhiskeySockets/libsignal-node', 'libsignal.tgz', ['master', 'main']],
    ['whiskeysockets/eslint-config', 'eslint-config.tgz', ['main', 'master']],
  ];
  for (const [repo, name, branches] of targets) {
    let ok = false;
    for (const branch of branches) {
      const r = await fetch('https://codeload.github.com/' + repo + '/tar.gz/refs/heads/' + branch);
      if (!r.ok) continue;
      fs.writeFileSync(__dirname + '/vendor/' + name, Buffer.from(await r.arrayBuffer()));
      console.log(repo, '(' + branch + ') ->', (fs.statSync(__dirname + '/vendor/' + name).size / 1024).toFixed(0) + 'KB');
      ok = true;
      break;
    }
    if (!ok) console.log(repo, 'NOT downloadable');
  }
  console.log('done');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
