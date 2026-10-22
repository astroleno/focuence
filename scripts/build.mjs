import { build } from 'esbuild';
import { mkdir, readdir, copyFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'vendor'), { recursive: true });
const ort = resolve(root, 'node_modules/onnxruntime-web/dist');
for (const name of await readdir(ort)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(name)) await copyFile(resolve(ort, name), resolve(root, 'vendor', name));
}
await build({
  absWorkingDir: root,
  entryPoints: ['inference/worker.js'],
  outfile: 'inference/worker.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['browser', 'onnxruntime-web-use-extern-wasm'],
  target: ['chrome120'],
  minify: true,
  legalComments: 'eof',
  logLevel: 'info',
});
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
console.log(`Focuence ${manifest.version}: local worker and matching WASM assets ready.`);
