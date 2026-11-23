import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
await mkdir(new URL('lib/', output), { recursive: true });
await mkdir(new URL('pages/', output), { recursive: true });
for (const file of ['public/favicon.svg', 'public/app.js', 'public/styles.css', 'lib/engine.mjs', 'lib/emr-adapter.mjs', 'pages/demo.mjs']) {
  await copyFile(new URL('../' + file, import.meta.url), new URL(file.replace(/^public\//, ''), output));
}
const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
await writeFile(new URL('index.html', output), index.replace('<html lang="ko">', '<html lang="ko" data-static-demo>'));

// Direct Upload deploys this bundle through the Pages deployment API.
const files = {};
for (const name of ['index.html','favicon.svg','app.js','styles.css','lib/engine.mjs','lib/emr-adapter.mjs','pages/demo.mjs']) {
  const type = name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript';
  files['/' + name] = [type, await readFile(new URL(name, output), 'utf8')];
}
const worker = await readFile(new URL('../pages/klat-worker.mjs', import.meta.url), 'utf8');
await writeFile(new URL('_worker.js', output), 'const files = ' + JSON.stringify(files) + ';\n' + worker);
