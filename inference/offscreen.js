// One persistent model worker per offscreen document. No page content leaves the extension.
const TARGET = 'focuence-inference';
const MODEL_NAME = 'BGE Small · 中文 · q8';
const pending = new Map();
let worker = null;
let sequence = 0;
let activeEpoch = 0;

function notify(update) {
  chrome.runtime.sendMessage({ target: 'background', type: 'MODEL_PROGRESS', name: MODEL_NAME, epoch: activeEpoch, ...update }).catch(() => {});
}

function destroyWorker(message = '本机模型进程已停止') {
  if (worker) worker.terminate();
  worker = null;
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(chrome.runtime.getURL('inference/worker.bundle.js'), { type: 'module', name: 'focuence-local-bge' });
  worker.addEventListener('message', ({ data }) => {
    if (data?.type === 'progress') { notify(data.data); return; }
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.ok) request.resolve(data.data);
    else {
      const error = data.error || '本机模型推理失败';
      request.reject(new Error(error));
      // ONNX initialization can retain a rejected internal promise; a fresh worker can recover.
      destroyWorker(error);
    }
  });
  worker.addEventListener('error', event => {
    const error = event.message || '本机模型进程无法加载';
    notify({ status: 'error', progress: 0, error });
    destroyWorker(error);
  });
  worker.addEventListener('messageerror', () => destroyWorker('无法读取本机模型进程的结果'));
  return worker;
}

function rpc(type, items, epoch) {
  activeEpoch = epoch;
  const instance = getWorker();
  const id = `infer_${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      notify({ status: 'error', progress: 0, error: '本机推理超时；规则分组仍可使用' });
      destroyWorker('本机推理超时；请减少页面数量后重试');
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    instance.postMessage({
      id, type, items, epoch,
      modelPath: chrome.runtime.getURL('models/'),
      wasmPath: chrome.runtime.getURL('vendor/'),
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== TARGET) return false;
  if (sender.id && sender.id !== chrome.runtime.id) { sendResponse({ ok: false, error: '无效的调用来源' }); return false; }
  if (message.type === 'INFERENCE_DISPOSE') {
    destroyWorker(); notify({ status: 'idle', progress: 0 });
    sendResponse({ ok: true, data: { status: 'idle' } }); return false;
  }
  if (!['INFERENCE_WARMUP', 'INFERENCE_EMBED'].includes(message.type)) {
    sendResponse({ ok: false, error: '未知的本机推理操作' }); return false;
  }
  const type = message.type === 'INFERENCE_WARMUP' ? 'load' : 'embed';
  rpc(type, message.items, message.epoch).then(data => sendResponse({ ok: true, data })).catch(error => {
    notify({ status: 'error', progress: 0, error: error.message, epoch: message.epoch });
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});
