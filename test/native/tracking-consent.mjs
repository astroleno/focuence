import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {acceptTracking, setup, until} from './cdp.mjs';

const out = process.argv.find(value => value.startsWith('--out='))?.slice(6) || resolve(tmpdir(), 'focuence-tracking-consent');
const env = await setup({out, startWorkspace: false});
const {browser, base} = env;
const consent = '#tracking-consent';
const initialWorker = await env.findWorker();
const extensionId = await initialWorker.eval(() => chrome.runtime.id);
const extensionUrl = path => 'chrome-extension://' + extensionId + '/' + path;

const snapshot = page => page.eval(async () => {
  const {openStore} = await import(chrome.runtime.getURL('src/store.js'));
  const store = await openStore();
  try {
    const [settings, pages, segments, workspace, activity] = await Promise.all([
      store.getSettings(), store.getPages(), store.listSegments(), store.getWorkspace(), store.getActivity()
    ]);
    return {settings, pages, segments, drafts: workspace.drafts, activity};
  } finally { store.close(); }
});

try {
  const first = await browser.page(base + '/fixture/consent-before-first');
  const second = await browser.page(base + '/fixture/consent-before-second');
  await first.send('Page.bringToFront');
  await first.send('Page.navigate', {url: base + '/fixture/consent-before-navigation'});
  await until(() => first.eval(() => document.title === 'consent-before-navigation'), 'fixture navigation');
  const fresh = await initialWorker.eval(async () => {
    const result = request => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await result(indexedDB.open('focuence-local-v2'));
    try {
      const tx = db.transaction(['meta', 'pages', 'segments'], 'readonly');
      const meta = tx.objectStore('meta');
      const [settings, marker, activity, workspace, pages, segments] = await Promise.all([
        result(meta.get('settings')), result(meta.get('foregroundTrackingConsent')), result(meta.get('activity')),
        result(meta.get('workspace')), result(tx.objectStore('pages').count()), result(tx.objectStore('segments').count())
      ]);
      return {tracking: settings?.value?.tracking ?? false, marker: marker?.value ?? null, activity: activity?.value ?? null,
        drafts: workspace?.value?.drafts ?? {}, pages, segments};
    } finally { db.close(); }
  });
  assert.deepEqual(fresh, {tracking: false, marker: null, activity: null, drafts: {}, pages: 0, segments: 0});
  console.log('Fresh installation leaves background ledger empty before opening Focuence');

  const {control, rpc} = await env.openWorkspace(extensionId);
  const state = () => rpc('GET_STATE');
  const expectTracking = async (tracking, granted) => {
    const current = (await state()).settings;
    assert.equal(current.tracking, tracking);
    assert.equal(current.trackingConsentGranted, granted);
  };
  const backup = await rpc('EXPORT_DATA');
  assert.equal(Object.hasOwn(backup.settings, 'trackingConsentGranted'), false);
  const legacyBackup = {...backup, schemaVersion: 3, settings: {...backup.settings, tracking: true, trackingConsentGranted: true}};
  const replace = await rpc('PREVIEW_IMPORT', {data: legacyBackup, mode: 'replace'});
  await rpc('APPLY_IMPORT', {token: replace.token});
  const restore = await rpc('PREVIEW_IMPORT', {restorePoint: true, mode: 'replace'});
  await rpc('APPLY_IMPORT', {token: restore.token});
  await expectTracking(false, false);
  await assert.rejects(rpc('UPDATE_SETTINGS', {patch: {tracking: true, trackingConsentGranted: true}}), {code: 'TRACKING_CONSENT_REQUIRED'});
  const forbidden = await browser.page(extensionUrl('inference/offscreen.html'));
  await until(() => forbidden.eval(() => location.pathname === '/inference/offscreen.html'), 'other extension document');
  const rejected = await forbidden.eval(() => chrome.runtime.sendMessage({target: 'background', type: 'ACCEPT_TRACKING'}));
  assert.equal(rejected.ok, false);
  await forbidden.close();
  await control.send('Page.bringToFront');
  const tab = (await state()).tabs.find(item => item.title === 'consent-before-navigation');
  assert(tab);
  const task = await rpc('SAVE_TASK', {tabIds: [tab.id], name: '手动接续验收'});
  const result = await rpc('RESTORE_TASK', {id: task.id, revision: task.revision, contextRevision: (await state()).work.current.revision, mode: 'page'});
  assert.equal(result.reused, 1);
  await rpc('FLUSH_ACTIVITY');
  const afterRestore = await snapshot(control);
  assert.deepEqual(afterRestore.pages, []);
  assert.deepEqual(afterRestore.segments, []);
  assert.deepEqual(afterRestore.drafts, {});
  console.log('Legacy backup, restore point and ordinary settings cannot grant tracking consent; task restore still works');

  await control.eval(async () => {
    const [{openStore}, {createActivityState, reduceActivity}, {pageIdForUrl}] = await Promise.all([
      import(chrome.runtime.getURL('src/store.js')), import(chrome.runtime.getURL('src/activity.js')), import(chrome.runtime.getURL('src/text.js'))
    ]);
    const store = await openStore();
    try {
      const at = Date.now() - 5000;
      const url = 'https://legacy.invalid/existing';
      const pageId = pageIdForUrl(url);
      const activity = createActivityState({now: at, sessionId: 'legacy-session'});
      const observation = reduceActivity(activity, {type: 'context', at, context: {pageId, url, title: '旧记录', tabId: 1, windowId: 1}});
      await store.setMeta('settings', {tracking: true, semantic: false});
      await store.putPages([{id: pageId, url, title: '旧记录', lastSeen: at}]);
      await store.saveActivity(observation.state, observation.segments);
    } finally { store.close(); }
  });
  const legacyBefore = await snapshot(control);
  assert.equal(legacyBefore.activity.tracking, true);
  assert.equal(legacyBefore.segments.length, 1);
  await browser.send('Target.closeTarget', {targetId: initialWorker.targetId});
  await first.send('Page.bringToFront');
  await expectTracking(false, false);
  let saved = await snapshot(control);
  assert.deepEqual(saved.pages, legacyBefore.pages);
  assert.deepEqual(saved.segments, legacyBefore.segments);
  assert.equal(saved.activity.tracking, false);
  assert.equal(saved.activity.context, null);
  assert.equal(saved.activity.open, null);
  await rpc('CLEAR_ALL');
  await control.send('Page.bringToFront');
  console.log('Upgrade with old enabled settings and open activity retains history without extending it');

  await control.click('#nav-map');
  const mapStart = '.empty-state [data-action="toggle-tracking"]';
  await control.click(mapStart);
  const disclosure = await control.eval(selector => document.querySelector(selector).innerText, consent);
  for (const term of ['网址', '标题', '停留时间', '切换', '本机', '注意力地图', '找回', '接续任务', '暂停', '删除']) assert(disclosure.includes(term), term);
  await control.eval(() => document.querySelector('#tracking-consent-accept').click());
  assert(await control.eval(selector => document.querySelector(selector)?.open, consent));
  await control.click('#tracking-consent-cancel');
  await until(() => control.eval(selector => !document.querySelector(selector), consent), 'cancel closed');
  await expectTracking(false, false);

  const panel = await browser.page(extensionUrl('panel/index.html'), 392, 820);
  await panel.click('#tracking-toggle');
  await panel.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
  await panel.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
  await until(() => panel.eval(selector => !document.querySelector(selector), consent), 'Escape closed');
  await expectTracking(false, false);
  await panel.close();

  await control.send('Page.bringToFront');
  await control.click('#nav-settings');
  await control.fill('#setting-excluded', 'localhost');
  await control.click('#setting-tracking');
  const save = '[data-action="save-settings"]';
  await control.click(save);
  await control.click('#tracking-consent-cancel');
  await until(() => control.eval(selector => !document.querySelector(selector), consent), 'settings cancel closed');
  assert(await control.eval(() => document.querySelector('#setting-tracking').checked));
  await expectTracking(false, false);
  await acceptTracking(control, save);
  await until(async () => (await state()).settings.tracking, 'settings enabled recording');
  await expectTracking(true, true);
  assert.deepEqual((await state()).settings.excludedDomains, ['localhost']);
  console.log('Map cancel, panel Escape and settings cancellation leave tracking off; confirmation starts it');

  await first.send('Page.navigate', {url: base.replace('127.0.0.1', 'localhost') + '/fixture/consent-excluded'});
  await first.send('Page.bringToFront');
  await until(() => first.eval(() => document.title === 'consent-excluded'), 'excluded fixture loaded');
  await rpc('FLUSH_ACTIVITY');
  assert((await snapshot(control)).pages.every(item => item.title !== 'consent-excluded'));
  await first.send('Page.navigate', {url: base + '/fixture/consent-after-first'});
  await first.send('Page.bringToFront');
  await until(async () => (await snapshot(control)).segments.some(item => item.title === 'consent-after-first'), 'first supported page recorded');
  const worker = await env.findWorker();
  await browser.send('Target.closeTarget', {targetId: worker.targetId});
  await second.send('Page.navigate', {url: base + '/fixture/consent-after-restart'});
  await second.send('Page.bringToFront');
  await until(async () => (await snapshot(control)).segments.some(item => item.title === 'consent-after-restart'), 'new worker records second page');
  await expectTracking(true, true);
  saved = await snapshot(control);
  assert(saved.pages.every(item => !item.title.startsWith('consent-before-')));
  assert(saved.segments.every(item => !item.title.startsWith('consent-before-')));
  assert.equal(Object.hasOwn((await rpc('EXPORT_DATA')).settings, 'trackingConsentGranted'), false);
  console.log('Foreground records start after consent and persist through worker restart');

  await rpc('UPDATE_SETTINGS', {patch: {tracking: false}});
  await expectTracking(false, true);
  await second.send('Page.navigate', {url: base + '/fixture/consent-paused'});
  await until(() => second.eval(() => document.title === 'consent-paused'), 'paused fixture loaded');
  await rpc('FLUSH_ACTIVITY');
  assert((await snapshot(control)).segments.every(item => item.title !== 'consent-paused'));
  await rpc('UPDATE_SETTINGS', {patch: {tracking: true}});
  await expectTracking(true, true);
  await rpc('CLEAR_ALL');
  await expectTracking(false, false);
  await assert.rejects(rpc('UPDATE_SETTINGS', {patch: {tracking: true}}), {code: 'TRACKING_CONSENT_REQUIRED'});
  assert.deepEqual((await snapshot(control)).segments, []);
  await control.send('Page.bringToFront');
  await control.eval(() => chrome.action.openPopup());
  const target = await until(async () => (await browser.send('Target.getTargets')).targetInfos.find(info => info.url === extensionUrl('popup/index.html')), 'real action popup');
  const popup = await browser.attach(target.targetId);
  await acceptTracking(popup, '#toggle-tracking');
  await until(async () => (await state()).settings.tracking, 'real popup enabled recording');
  await expectTracking(true, true);
  console.log('Pause retains consent, clear-all revokes it, and the real Chrome action popup can grant it again');
} finally {
  await env.close();
}
