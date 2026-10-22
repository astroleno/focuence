import { pipeline, env } from '@huggingface/transformers';

const MODEL_ID = 'bge-small-zh-v1.5';
let extractorPromise = null;
let extractor = null;
let queue = Promise.resolve();
let configured = false;
let activeEpoch = 0;

function progress(data) { self.postMessage({ type: 'progress', data: { ...data, epoch: activeEpoch } }); }

function configure(message) {
  if (configured) return;
  for (const [name, value] of [['modelPath', message.modelPath], ['wasmPath', message.wasmPath]]) {
    const local = typeof value === 'string' ? new URL(value) : null;
    if (!local || local.protocol !== self.location.protocol || local.host !== self.location.host || !value.endsWith('/')) throw new Error(`无效的本地路径：${name}`);
  }
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = message.modelPath;
  env.useFS = false;
  env.useFSCache = false;
  env.useBrowserCache = false; // Bundled extension files are already local; do not duplicate 24 MB.
  env.backends.onnx.wasm.wasmPaths = message.wasmPath;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  configured = true;
}

async function load(message) {
  configure(message);
  if (!extractorPromise) {
    progress({ status: 'loading', progress: 0 });
    let reported = 0;
    extractorPromise = pipeline('feature-extraction', MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      local_files_only: true,
      progress_callback(event) {
        // This is local file/model initialization progress, never a remote download.
        if (event.status === 'progress' && typeof event.progress === 'number') {
          reported = Math.max(reported, Math.min(.88, event.progress / 100 * .88));
        } else if (event.status === 'done') reported = Math.max(reported, .9);
        progress({ status: 'loading', progress: reported });
      },
    }).then(result => {
      // v3.8.1's feature-extraction pipeline does not forward max_length call options.
      // Its tokenizer's model_max_length is the actual truncation boundary.
      result.tokenizer.model_max_length = 128;
      extractor = result;
      progress({ status: 'ready', progress: 1 });
      return result;
    }).catch(error => {
      extractorPromise = null;
      extractor = null;
      progress({ status: 'error', progress: 0, error: error.message });
      throw error;
    });
  }
  return extractorPromise;
}

async function execute(message) {
  activeEpoch = message.epoch;
  const started = performance.now();
  if (message.type !== 'load' && message.type !== 'embed') throw new Error('未知的本机模型请求');
  const model = await load(message);
  if (message.type === 'load') return { status: 'ready', model: MODEL_ID, elapsedMs: Math.round(performance.now() - started) };
  if (!Array.isArray(message.items) || message.items.length > 500) throw new Error('每次最多处理 500 个页面');
  const items = message.items.map(item => {
    if (typeof item?.id !== 'string' || !item.id || typeof item.text !== 'string' || !item.text.trim()) throw new Error('页面缺少标识或可分析文本');
    return { id: item.id, text: item.text.slice(0, 1200) };
  });
  const vectors = [];
  // Small batches bound transient memory. The UI receives rule suggestions before this request.
  for (let offset = 0; offset < items.length; offset += 4) {
    const batch = items.slice(offset, offset + 4);
    const output = await model(batch.map(item => item.text), { pooling: 'cls', normalize: true });
    const values = output.tolist();
    for (let i = 0; i < batch.length; i++) {
      const vector = values[i];
      if (!Array.isArray(vector) || vector.length !== 512 || vector.some(value => !Number.isFinite(value))) throw new Error('本机模型返回了无效向量');
      vectors.push({ id: batch[i].id, vector });
    }
    // A ready model remains ready while it processes another small batch.
    progress({ status: 'ready', progress: 1, completed: vectors.length, total: items.length });
  }
  return { status: 'ready', model: MODEL_ID, vectors, elapsedMs: Math.round(performance.now() - started) };
}

self.addEventListener('message', ({ data: message }) => {
  if (!message || typeof message.id !== 'string') return;
  // Serial execution shares a single ONNX session and avoids peak-memory multiplication.
  const task = queue.then(() => execute(message));
  queue = task.catch(() => {});
  task.then(data => self.postMessage({ id: message.id, ok: true, data })).catch(error => {
    self.postMessage({ id: message.id, ok: false, error: error.message || String(error) });
  });
});
