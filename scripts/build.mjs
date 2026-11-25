import { build } from 'esbuild';
import { mkdir, readdir, copyFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const transformersWeb = resolve(root, 'node_modules/@huggingface/transformers/dist/transformers.web.js');
const remoteWasm = '`https://cdn.jsdelivr.net/npm/@huggingface/transformers@${_env_js__WEBPACK_IMPORTED_MODULE_0__.env.version}/dist/`';
const workerBundle = resolve(root, 'inference/worker.bundle.js');
let patchedTransformers = false;
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
  plugins: [{
    name: 'bundle-wasm-locally',
    setup(builder) {
      builder.onLoad({filter: /[\\/]transformers\.web\.js$/}, async ({path}) => {
        if (path !== transformersWeb) return;
        const source = await readFile(path, 'utf8');
        if (source.split(remoteWasm).length !== 2) {
          throw new Error('Transformers.js WASM default changed. Review the local-only replacement.');
        }
        patchedTransformers = true;
        return {
          contents: source.replace(remoteWasm, "new URL('../vendor/', import.meta.url).href"),
          loader: 'js',
          resolveDir: dirname(path),
        };
      });
    },
  }],
});
const bundle = await readFile(workerBundle, 'utf8');
if (!patchedTransformers || bundle.includes('https://cdn.jsdelivr.net/npm/@huggingface/transformers@')) {
  throw new Error('Worker bundle did not replace the remote Transformers.js WASM default.');
}
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
console.log(`Focuence ${manifest.version}: local worker and matching WASM assets ready.`);
