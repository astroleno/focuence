import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {repo, setup, until} from './cdp.mjs';

const extensionId = 'alfcejiicdbndoijbcodgbgpdpnagphl';
const candidateVersion = JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8')).version;
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const oldCrx = option('old-crx');
assert(oldCrx, 'Pass --old-crx=/path/to/the-public-1.0.0.crx');
const candidate = resolve(option('candidate') || join(repo, 'dist', `Focuence-${candidateVersion}-chrome-store.zip`));
const out = resolve(option('out') || join(repo, 'dist'));
mkdirSync(out, {recursive: true});
const reportPath = join(out, `Focuence-${candidateVersion}-store-upgrade.json`);
const screenshot = join(out, `Focuence-${candidateVersion}-chrome-store-1280x800.png`);
const archiveDigest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const report = {
  status: 'failed',
  mode: 'Same-ID unpacked replacement from the public CRX3 to the candidate ZIP across a restart of one isolated Chrome profile. No signed store installation or permission prompt.',
  extensionId,
  from: {version: '1.0.0', sha256: archiveDigest(oldCrx)},
  to: {version: candidateVersion, sha256: archiveDigest(candidate)},
  checks: [],
};
assert.equal(report.from.sha256, '0f99dac4fb93883103a6816dc3fa7a93abed709da6830f243bd174a3441c52cd',
  'The old CRX3 must match the public 1.0.0 artifact pinned by this test.');
const staging = mkdtempSync(join(tmpdir(), 'focuence-store-upgrade-'));
const extensionPath = join(staging, 'extension');
const preparedPath = join(staging, 'prepared');
const profilePath = join(staging, 'profile');
const browserOptions = {out, extensionPath, profilePath, startWorkspace: false, isolatedNetwork: true};

// Extract CRX3 public identity using Chromium's documented protobuf layout.
// The staging manifests alone receive the public key. Store metadata stays with the input CRX.
const stage = (archive, target, version) => execFileSync('python3', ['-I', '-c', String.raw`
import base64, hashlib, json, pathlib, stat, struct, sys, zipfile

crx, archive, target, expected_id, version = sys.argv[1:]
raw = pathlib.Path(crx).read_bytes()
magic, crx_version, header_size = struct.unpack_from('<4sII', raw)
assert magic == b'Cr24' and crx_version == 3 and 0 < header_size < len(raw) - 12

def varint(data, offset):
    result = 0
    for shift in range(0, 70, 7):
        part = data[offset]
        offset += 1
        result |= (part & 127) << shift
        if part < 128:
            return result, offset
    raise ValueError('Invalid CRX3 varint')

def fields(data):
    offset = 0
    while offset < len(data):
        tag, offset = varint(data, offset)
        if tag & 7 != 2:
            raise ValueError('Unexpected CRX3 field encoding')
        size, offset = varint(data, offset)
        end = offset + size
        assert end <= len(data)
        yield tag >> 3, data[offset:end]
        offset = end

header = list(fields(raw[12:12 + header_size]))
keys = [key for tag, proof in header if tag in (2, 3) for field, key in fields(proof) if field == 1]
def extension_id(key):
    return hashlib.sha256(key).hexdigest()[:32].translate(str.maketrans('0123456789abcdef', 'abcdefghijklmnop'))
key, = [key for key in keys if extension_id(key) == expected_id]
assert any(field == 1 and value == hashlib.sha256(key).digest()[:16]
           for tag, signed in header if tag == 10000 for field, value in fields(signed))
target = pathlib.Path(target)
target.mkdir()
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    seen = set()
    for entry in package.infolist():
        name = entry.filename.rstrip('/')
        path = pathlib.PurePosixPath(name)
        mode = stat.S_IFMT(entry.external_attr >> 16)
        assert (name and not path.is_absolute() and '..' not in path.parts and str(path) == name
                and '\\' not in name and ':' not in name and name not in seen
                and mode in (0, stat.S_IFREG, stat.S_IFDIR)), f'Invalid archive entry: {name}'
        seen.add(name)
        if version == '1.0.0' and path.parts[0] == '_metadata':
            continue
        if not entry.is_dir():
            output = target / path
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(package.read(entry))
manifest_path = target / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
assert manifest['version'] == version and 'key' not in manifest
manifest['key'] = base64.b64encode(key).decode('ascii')
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
`, oldCrx, archive, target, extensionId, version], {stdio: 'inherit'});

const readVersion = worker => worker.eval(async () => {
  const manifest = chrome.runtime.getManifest();
  const permissionWarnings = await new Promise((resolve, reject) => {
    chrome.management.getPermissionWarningsByManifest(JSON.stringify(manifest), warnings => {
      if (chrome.runtime.lastError) reject(Error(chrome.runtime.lastError.message));
      else resolve(warnings);
    });
  });
  const self = await chrome.management.getSelf();
  return {
    id: chrome.runtime.id, version: manifest.version, installType: self.installType,
    enabled: self.enabled, permissionWarnings, grants: await chrome.permissions.getAll(),
  };
});
const readLegacy = worker => worker.eval(async key => ({
  history: (await chrome.storage.local.get(key))[key],
  settings: (await chrome.storage.sync.get('settings')).settings,
}), legacyHistoryKey);
const legacyHistoryKey = `tab_history_${Date.now()}`;
const legacy = {
  history: {url: 'https://legacy-fixture.invalid/old', title: '旧版合成浏览记录', totalActiveTime: 1900, closedTime: Date.now()},
  settings: {
    apiEndpoint: 'https://legacy-fixture.invalid', model: 'fixture-only',
    apiKey: 'SYNTHETIC_PLACEHOLDER', autoGrouping: false, cleaningSuggestions: true,
  },
};

let env, workspacePage;
try {
  stage(oldCrx, extensionPath, '1.0.0');
  stage(candidate, preparedPath, candidateVersion);
  env = await setup(browserOptions);
  const {product} = await env.browser.send('Browser.getVersion');
  report.browser = product;
  const oldWorker = await env.findWorker('1.0.0');
  const oldInfo = await readVersion(oldWorker);
  assert.equal(oldInfo.id, extensionId);
  assert.equal(oldInfo.installType, 'development');
  assert(oldInfo.enabled);
  assert(oldInfo.grants.origins.includes('https://yunwu.zeabur.app/*'));
  Object.assign(report.from, oldInfo);
  assert(await until(() => oldWorker.eval(async () => Boolean((await chrome.storage.sync.get('settings')).settings)), 'old install wrote settings'));
  await oldWorker.eval(async ({key, history, settings}) => {
    await chrome.storage.local.set({[key]: history});
    await chrome.storage.sync.set({settings});
  }, {key: legacyHistoryKey, ...legacy});
  assert.deepEqual(await readLegacy(oldWorker), legacy);
  report.checks.push('Public 1.0.0 worker ran and kept synthetic storage in its original local and sync keys.');

  await env.close();
  env = undefined;
  renameSync(extensionPath, join(staging, 'previous'));
  renameSync(preparedPath, extensionPath);
  env = await setup(browserOptions);
  const newWorker = await env.findWorker();
  const newInfo = await readVersion(newWorker);
  const loadedWorker = await newWorker.eval(() => ({legacyBody: typeof initializeAttentionTracking === 'function'}));
  Object.assign(report.to, newInfo, {loadedWorker});
  assert.equal(newInfo.version, candidateVersion);
  assert.equal(loadedWorker.legacyBody, false);
  assert.equal(newInfo.id, extensionId);
  assert.equal(newInfo.installType, 'development');
  assert(newInfo.enabled);
  assert(newInfo.grants.origins.every(origin => oldInfo.grants.origins.includes(origin)), 'Upgrade must not grant any new origins.');
  assert.deepEqual(newInfo.grants.permissions.toSorted(),
    ['alarms', 'idle', 'offscreen', 'sidePanel', 'storage', 'tabGroups', 'tabs']);
  assert.deepEqual(await readLegacy(newWorker), legacy);
  report.checks.push('The candidate reloaded under the same store ID and profile and kept both legacy keys intact. No optional API permission or new origin was granted.');

  const {control, rpc, windowId} = await env.openWorkspace(extensionId);
  workspacePage = control;
  const state = await rpc('GET_STATE');
  assert.equal(state.version, candidateVersion);
  assert.equal(state.tasks.length, 0);
  assert(!JSON.stringify(state).includes('旧版合成浏览记录'));
  assert.deepEqual(await rpc('GET_AI_SETTINGS'), {
    enabled: false, baseUrl: '', protocol: 'openai', model: '', hasKey: false,
  });
  assert(!JSON.stringify(state).includes(legacy.settings.apiKey));
  report.checks.push('The real workspace opened with default AI settings and no legacy history or AI configuration imported.');

  const pages = ['离线/网页端本地模型与向量检索', '酵母面包发酵'];
  await control.eval(async ({base, pages, windowId}) => {
    for (const title of pages) {
      await chrome.tabs.create({windowId, url: base + '/fixture/' + encodeURIComponent(title), active: false});
    }
  }, {base: env.base, pages, windowId});
  const tabs = await until(async () => {
    const {tabs} = await rpc('LIST_WORKSPACE_TABS');
    return pages.every(title => tabs.some(tab => tab.title === title)) && tabs;
  }, 'candidate fixture tabs');
  let search = await rpc('SEARCH_MEMORY', {query: '离线运行人工智能的浏览器资料', scope: 'window', clientId: 'store-upgrade'});
  search = await until(async () => {
    const job = await rpc('GET_SEARCH_STATUS', {jobId: search.id});
    return ['done', 'failed', 'cancelled', 'stale'].includes(job.status) && job;
  }, 'bundled semantic inference', 60000);
  assert.equal(search.status, 'done');
  assert.equal(search.results[0]?.title, pages[0]);
  assert.equal(search.results[0]?.method, 'semantic');
  report.checks.push('The bundled model ranked the expected synthetic page first by semantic search.');

  const tabIds = pages.map(title => tabs.find(tab => tab.title === title).id);
  const focusTask = await rpc('SAVE_TASK', {name: '研究浏览器端的本机语义检索', goal: '比较本机模型与关键词检索的表现', tabIds: tabIds.slice(0, 1)});
  await rpc('SAVE_TASK', {name: '记录面包发酵时间', goal: '比较不同室温下的发酵条件与口感', tabIds: tabIds.slice(1)});
  const checkpoint = await rpc('SAVE_CHECKPOINT', {
    id: focusTask.id, revision: focusTask.revision,
    checkpoint: {nextStep: '核对本机模型找回的资料', pageId: focusTask.pages[0].pageId},
  });
  await rpc('SET_CURRENT_TASK', {
    id: focusTask.id, revision: checkpoint.revision,
    contextRevision: (await rpc('GET_STATE')).work.current.revision,
  });
  await control.size(1280, 800);
  await control.send('Page.reload');
  await until(() => control.eval(() => document.querySelector('.memory-current')?.innerText.includes('核对本机模型找回的资料')), 'workspace screenshot content');
  await control.eval(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
  await control.screenshot(screenshot);
  const image = readFileSync(screenshot);
  assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [1280, 800]);
  report.checks.push('Captured a 1280×800 screenshot of the candidate workspace with synthetic tasks.');
  await rpc('CLEAR_AI_SETTINGS');
  assert.deepEqual(await readLegacy(control), legacy);
  await rpc('CLEAR_ALL');
  assert.deepEqual(await readLegacy(control), legacy);
  report.checks.push('Clearing AI settings and then current extension data leaves the legacy storage keys intact.');
  report.status = 'passed';
} catch (error) {
  report.error = error.stack;
  if (env) {
    report.debugTargets = (await env.browser.send('Target.getTargets', {}, undefined, 3000).catch(() => null))?.targetInfos
      .filter(item => item.url.startsWith('chrome-extension://'))
      .map(({type, url}) => ({type, url}));
  }
  if (workspacePage) {
    report.debugTabs = await workspacePage.eval(async () => (await chrome.tabs.query({}))
      .map(({title, url, status}) => ({title, url, status}))).catch(() => null);
  }
  throw error;
} finally {
  try {
    await env?.close();
  } finally {
    rmSync(staging, {recursive: true, force: true});
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`Store upgrade ${report.status}: ${reportPath}`);
  }
}
